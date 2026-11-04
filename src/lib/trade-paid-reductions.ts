import {paidReductionRefundAmount} from './trade-reduction-types';
import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError,date,text} from './validation';
import {acquirePeriodReviewLock,assertPeriodsOpen} from './period-guard';
import {koreanToday} from './forecast';
import {prepareTradeReduction,prepareLaterReduction,registerTradeReduction} from './trade-reductions';
import {assertCreditBalance} from './trade-period';
import {normalizeBusinessNumber} from './business-number';
import {refreshTradeCashPlan} from './trade-cash';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function preparePaidReduction(data:FormData,fileName:string,content:Uint8Array,scope:'SAME'|'LATER'='SAME'){
 if(data.get('paidReductionConfirmed')!=='on')throw new InputError('원 지급 보존·감액 후 잔액과 별도 환급을 확인하세요.');
 const copy=new FormData();for(const[k,v]of data.entries())copy.append(k,v);copy.set('reductionConfirmed','on');copy.set('laterReductionConfirmed','on');
 const source=scope==='LATER'?await prepareLaterReduction(copy,fileName,content):await prepareTradeReduction(copy,fileName,content);
 const refundDueDate=date(text(data,'refundDueDate','환급 예정일',false,10),'환급 예정일');
 return {...source,scope,refundDueDate,fingerprint:digest({operation:'PAID_REDUCTION',source:source.fingerprint,scope,due:refundDueDate?.toISOString()??null})};
}
async function paymentState(tx:Prisma.TransactionClient,id:string,allowVoided=false){
 const d=await tx.tradeDocument.findFirst({where:{id,companyId:COMPANY_ID},include:{monthlyPayment:true,links:{where:{voidedAt:null},include:{transaction:{include:{account:true}}}},cashPlan:{include:{settlements:{where:{voidedAt:null}}}}}});
 if(!d||d.voidedAt&&!allowVoided||d.monthlyPayment||!d.proofConfirmed||d.settledAmount.lte(0)||!d.links.length||d.links.reduce((s,l)=>s+BigInt(l.amount.toFixed(0)),0n)!==BigInt(d.settledAmount.toFixed(0)))throw new InputError('원 지급의 실제 은행 연결을 먼저 대조하세요.');
 if(d.voidedAt&&!await tx.tradeCancellation.count({where:{companyId:COMPANY_ID,originalDocumentId:d.id,voidedAt:null,refundPlanId:{not:null}}}))throw new InputError('환급 원본의 취소 연결을 확인하세요.');
 const direction=d.kind==='PURCHASE'?'OUT':'IN';
 if(d.links.some(l=>l.amount.lte(0)||l.transaction.account.companyId!==COMPANY_ID||l.transaction.account.currency!=='KRW'||l.transaction.direction!==direction||l.transaction.internalTransfer||l.transaction.tradedDate.toISOString().slice(0,10)>koreanToday()))throw new InputError('원 지급의 은행·방향·원화·날짜를 확인하세요.');
 if(d.cashPlan){const p=d.cashPlan;if(p.companyId!==COMPANY_ID||p.replacedById||p.direction!==direction||!p.plannedAmount.equals(d.grossAmount)||Boolean(p.completedAt)!==d.settledAmount.gte(d.grossAmount)||p.settlements.length!==d.links.length||p.settlements.some(s=>!d.links.some(l=>s.tradeBankLinkId===l.id&&s.bankTransactionId===l.transactionId&&s.amount.equals(l.amount))))throw new InputError('원 지급 예산안과 실제 은행 합계를 먼저 대조하세요.');}
 const basis=digest({id:d.id,partner:d.partnerId,approval:d.taxApprovalNumber,cashPlanId:d.cashPlanId,paid:d.settledAmount.toFixed(0),links:d.links.map(l=>({id:l.id,bank:l.transactionId,amount:l.amount.toFixed(0),date:l.transaction.tradedDate.toISOString()})).sort((a,b)=>a.id.localeCompare(b.id))});
 return {document:d,basis,lastPaid:new Date(Math.max(...d.links.map(l=>l.transaction.tradedDate.getTime())))};
}
export async function registerPaidReduction(tx:Prisma.TransactionClient,source:Awaited<ReturnType<typeof preparePaidReduction>>){
 await acquirePeriodReviewLock(tx);
 const replay=await tx.tradeReduction.findUnique({where:{requestId:source.requestId}});if(replay){if(replay.companyId!==COMPANY_ID||replay.fingerprint!==source.fingerprint)throw new InputError('다른 내용으로 사용한 감액 요청입니다.');return{id:replay.originalDocumentId,reductionId:replay.id,replayed:true};}
 const state=await paymentState(tx,source.originalDocumentId),{document:d,lastPaid}=state;
 await assertCreditBalance(tx,d.id,new Date(source.row.date));
 if(d.voidedAt||d.version!==source.originalVersion)throw new InputError('원본 지급 또는 청구가 변경되었습니다.');
 const previous=await tx.tradeReduction.findMany({where:{companyId:COMPANY_ID,originalDocumentId:d.id,voidedAt:null,refundPlanId:{not:null}},include:{refundPlan:true}});
 const oldExcess=BigInt(d.settledAmount.toFixed(0))>BigInt(d.grossAmount.toFixed(0))?BigInt(d.settledAmount.toFixed(0))-BigInt(d.grossAmount.toFixed(0)):0n;
 if(previous.reduce((v,r)=>v+BigInt(r.refundPlan!.plannedAmount.toFixed(0)),0n)!==oldExcess)throw new InputError('선행 감액의 환급 예정액과 원 지급을 먼저 대조하세요.');
 const after=BigInt(d.grossAmount.toFixed(0))+BigInt(source.row.gross),paid=BigInt(d.settledAmount.toFixed(0)),refund=(paid>after?paid-after:0n)-oldExcess;
 if(after<=0n)throw new InputError('전액취소는 기지급 전액취소·환급으로 처리하세요.');
 if(refund>0n){if(!source.refundDueDate||source.refundDueDate<new Date(source.row.date)||source.refundDueDate<lastPaid)throw new InputError('수정증빙·원 지급일 이후의 환급 예정일을 입력하세요.');await assertPeriodsOpen(tx,source.refundDueDate);}
 const saved=await registerTradeReduction(tx,source,source.scope,{basis:state.basis,paidAmount:d.settledAmount.toFixed(0),linkIds:d.links.map(l=>l.id)});
 await refreshTradeCashPlan(tx,d.id);
 if(refund>0n){const plan=await tx.cashPlan.create({data:{companyId:COMPANY_ID,projectId:d.projectId,direction:d.kind==='PURCHASE'?'IN':'OUT',certainty:'CONFIRMED',title:`부분 감액 환급 ${d.reference} · ${d.title}`.slice(0,200),category:'기타',plannedDate:source.refundDueDate!,plannedAmount:refund.toString()}});await tx.tradeReduction.update({where:{id:saved.reductionId},data:{refundPlanId:plan.id}});}
 return saved;
}
export async function assertPaidReductionCurrent(tx:Prisma.TransactionClient,id:string,undo=false){
 const r=await tx.tradeReduction.findFirst({where:{id,companyId:COMPANY_ID},include:{refundPlan:{include:{settlements:{where:{voidedAt:null}}}}}});
 if(!r||r.voidedAt||!r.paymentBasis||!r.paidAmount)throw new InputError('사용 중인 기지급 감액 원본을 확인하세요.');
 const state=await paymentState(tx,r.originalDocumentId,!undo),d=state.document;
 if(state.basis!==r.paymentBasis||!r.paidAmount.equals(d.settledAmount)||d.grossAmount.gt(r.afterGross)||d.taxApprovalNumber!==r.originalApproval||undo&&(!d.grossAmount.equals(r.afterGross)||!d.supplyAmount.equals(r.afterSupply)||!d.taxAmount.equals(r.afterTax)))throw new InputError('감액 후 청구·원 지급 연결이 변경되었습니다. 수정증빙에서 먼저 대조하세요.');
 await assertCreditBalance(tx,d.id,new Date(koreanToday()));
 const excess=paidReductionRefundAmount(r).toString(),p=r.refundPlan;
 if(p&&(p.companyId!==COMPANY_ID||p.replacedById||!p.plannedAmount.equals(excess)||p.direction!==(d.kind==='PURCHASE'?'IN':'OUT')))throw new InputError('부분 감액 환급액·방향을 원 지급과 대조하세요.');
 if(undo&&p){if(p.settlements.length)throw new InputError('이미 환급한 은행 실적을 먼저 확인·해제하세요.');await assertPeriodsOpen(tx,p.plannedDate);}
 return {record:r,...state};
}
export async function paidReductionCandidates(db:PrismaClient|Prisma.TransactionClient,input:{kind:string;date:string;gross:string;supply:string;tax:string;businessNumber:string},scope:'SAME'|'LATER'='SAME'){
 const kind=input.kind==='PURCHASE'?'PURCHASE':input.kind==='SALE'?'SALE':null,issued=date(input.date,'감액 작성일'),business=normalizeBusinessNumber(input.businessNumber);
 if(!kind||!issued||!business||![input.gross,input.supply,input.tax].every(v=>/^-?\d{1,20}$/.test(v))||BigInt(input.gross)>=0n||BigInt(input.supply)>=0n||BigInt(input.tax)>0n||BigInt(input.gross)!==BigInt(input.supply)+BigInt(input.tax))throw new InputError('기지급 부분 감액 증빙을 확인하세요.');
 const first=new Date(Date.UTC(issued.getUTCFullYear(),issued.getUTCMonth(),1)),next=new Date(Date.UTC(issued.getUTCFullYear(),issued.getUTCMonth()+1,1));
 const rows=await db.tradeDocument.findMany({where:{companyId:COMPANY_ID,kind,voidedAt:null,proofConfirmed:true,evidence:'TAX_INVOICE',taxApprovalNumber:{not:null},monthlyPayment:null,settledAmount:{gt:0},grossAmount:{gt:(-BigInt(input.gross)).toString()},supplyAmount:{gte:(-BigInt(input.supply)).toString()},taxAmount:{gte:(-BigInt(input.tax)).toString()},issuedDate:scope==='LATER'?{lt:first}:{gte:first,lt:next},partner:{businessNumber:business}},select:{id:true,reference:true,title:true,version:true,taxApprovalNumber:true,issuedDate:true,supplyAmount:true,taxAmount:true,grossAmount:true,settledAmount:true},orderBy:[{issuedDate:'desc'},{id:'desc'}],take:101});
 if(rows.length>100)throw new InputError('후보가 많습니다. 원본 청구를 먼저 확인하세요.');
 return rows.map(r=>({...r,issuedDate:r.issuedDate.toISOString().slice(0,10),supplyAmount:r.supplyAmount.toFixed(0),taxAmount:r.taxAmount.toFixed(0),grossAmount:r.grossAmount.toFixed(0),settledAmount:r.settledAmount.toFixed(0)}));
}

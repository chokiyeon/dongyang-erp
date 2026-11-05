import {prepareUnpaidPlanCancellation,closeUnpaidPlan} from './trade-unpaid-plans';
import {assertStockCancellationMatch,writeStockCancellationMatches} from './stock-returns';
import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError,date} from './validation';
import {normalizeBusinessNumber} from './business-number';
import {prepareTradeCancellation} from './trade-cancellations';
import {acquirePeriodReviewLock,assertPeriodsOpen} from './period-guard';
import {LATER_CANCELLATION,assertCreditBalance} from './trade-period';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function prepareLaterCancellation(data:FormData,fileName:string,content:Uint8Array){
 if(data.get('laterCancellationConfirmed')!=='on')throw new InputError('이전 달 원본 보존과 수정 작성월의 미정산 전액취소를 확인하세요.');
 const copied=new FormData();for(const[k,v]of data.entries())copied.append(k,v);copied.set('cancellationConfirmed','on');
 const source=await prepareTradeCancellation(copied,fileName,content);
 return {...source,fingerprint:hash({operation:LATER_CANCELLATION,source:source.fingerprint})};
}
export async function registerLaterCancellation(tx:Prisma.TransactionClient,source:Awaited<ReturnType<typeof prepareLaterCancellation>>){
 await acquirePeriodReviewLock(tx);const replay=await tx.tradeCancellation.findUnique({where:{requestId:source.requestId}});
 if(replay){if(replay.companyId!==COMPANY_ID||replay.fingerprint!==source.fingerprint)throw new InputError('다른 수정증빙으로 사용한 요청입니다.');return {id:replay.originalDocumentId,cancellationId:replay.id,replayed:true};}
 const {row}=source;await assertPeriodsOpen(tx,row.date);
 const d=await tx.tradeDocument.findFirst({where:{id:source.originalDocumentId,companyId:COMPANY_ID},include:{partner:true,workbookSource:true,monthlyPayment:true,reductions:{where:{voidedAt:null},orderBy:{beforeGross:"desc"},take:1,select:{businessNumber:true}}}});
 if(!d||d.voidedAt||d.version!==source.originalVersion)throw new InputError('원본 청구가 변경되었거나 취소되었습니다. 다시 조회하세요.');
 if(d.issuedDate.toISOString().slice(0,7)>=row.date.slice(0,7))throw new InputError('수정 작성월보다 이전 달에 발행한 원본을 선택하세요.');
 if(d.kind!==row.kind||d.evidence!=='TAX_INVOICE'||!d.proofConfirmed||!d.taxApprovalNumber||d.taxApprovalNumber===row.approval)throw new InputError('구분·원본 확인·세금계산서 승인번호를 대조하세요.');
 if(!d.settledAmount.isZero()||d.monthlyPayment||await tx.tradeBankLink.count({where:{documentId:d.id,voidedAt:null}}))throw new InputError('은행 지급·정기 지급이 없는 미정산 원본과 기존 예산안을 대조하세요.');
 if(BigInt(d.supplyAmount.toFixed(0))!==-BigInt(row.supply)||BigInt(d.taxAmount.toFixed(0))!==-BigInt(row.tax)||BigInt(d.grossAmount.toFixed(0))!==-BigInt(row.gross))throw new InputError('원본 공급가액·세액·합계 전액의 반대 금액이어야 합니다. 부분 감액은 별도 정산입니다.');
 const cells=Array.isArray(d.workbookSource?.cells)?d.workbookSource.cells:[],business=normalizeBusinessNumber(String(cells[row.kind==='SALE'?9:4]??d.reductions[0]?.businessNumber??d.partner.businessNumber??''));
 if(!business||business!==normalizeBusinessNumber(row.raw[row.kind==='SALE'?9:4]??''))throw new InputError('원본과 수정증빙 사업자번호가 다릅니다.');
 const stockVerified=await assertStockCancellationMatch(tx,d.id,source.stockReturnIds,row.supply);
 if(await tx.tradeReduction.count({where:{companyId:COMPANY_ID,voidedAt:null,taxApprovalNumber:row.approval}})||await tx.sourceCostReview.count({where:{companyId:COMPANY_ID,sourceType:'TRADE',sourceId:d.id,active:true}})||!stockVerified&&await tx.stockMovement.count({where:{documentId:d.id,voidedAt:null}})||await tx.vehicleExpense.count({where:{documentId:d.id}}))throw new InputError('부분 감액·자재·차량·공사 원가 배부 연결은 별도 기간 정산이 필요합니다.');
 await assertCreditBalance(tx,d.id,new Date(row.date));
 if(await tx.tradeDocument.count({where:{companyId:COMPANY_ID,taxApprovalNumber:row.approval,voidedAt:null}})||await tx.tradeCancellation.count({where:{companyId:COMPANY_ID,voidedAt:null,OR:[{originalDocumentId:d.id},{originalApproval:row.approval},{taxApprovalNumber:row.approval}]}}))throw new InputError('이미 사용한 수정 승인번호 또는 취소 원본입니다.');
 const unpaidPlan=await prepareUnpaidPlanCancellation(tx,d.id);
 // Amounts and the original issue date stay intact, including a closed original month.
 const changed=await tx.tradeDocument.updateMany({where:{id:d.id,companyId:COMPANY_ID,version:d.version,settledAmount:0,cashPlanId:d.cashPlanId,voidedAt:null},data:{voidedAt:new Date(),voidReason:`다른 달 수정 · ${row.date}: ${source.reason}`.slice(0,300),version:{increment:1}}});
 if(changed.count!==1)throw new InputError('원본 청구가 변경되었습니다.');
 await closeUnpaidPlan(tx,d.id,unpaidPlan.basis);
 const file=await tx.tradeWorkbookFile.upsert({where:{companyId_checksum:{companyId:COMPANY_ID,checksum:source.checksum}},create:{companyId:COMPANY_ID,checksum:source.checksum,fileName:source.fileName,content:Buffer.from(source.content)},update:{},select:{id:true}});
 const c=await tx.tradeCancellation.create({data:{companyId:COMPANY_ID,originalDocumentId:d.id,originalApproval:d.taxApprovalNumber,taxApprovalNumber:row.approval,issuedDate:new Date(row.date),supplyAmount:row.supply,taxAmount:row.tax,grossAmount:row.gross,fileId:file.id,sheet:row.sheet,sourceRow:row.row,headers:source.headers,cells:row.raw,reason:source.reason,requestId:source.requestId,fingerprint:source.fingerprint,documentVersionAfter:d.version+1,unpaidPlanBasis:unpaidPlan.basis}});
 if(stockVerified)await writeStockCancellationMatches(tx,source.stockReturnIds,c.id,source.requestId,source.reason);
 await tx.tradeCancellationChange.create({data:{cancellationId:c.id,requestId:source.requestId,fingerprint:source.fingerprint,operation:LATER_CANCELLATION,reason:source.reason}});
 await tx.tradeDocumentChange.create({data:{documentId:d.id,requestId:source.requestId,fingerprint:source.fingerprint,previous:{voided:false},next:{voided:true,cancellationId:c.id,operation:LATER_CANCELLATION,effectiveDate:row.date,originalPeriodPreserved:true},reason:source.reason}});
 return {id:d.id,cancellationId:c.id,replayed:false};
}
export async function laterCancellationCandidates(db:PrismaClient|Prisma.TransactionClient,input:{kind:string;date:string;supply:string;tax:string;gross:string;businessNumber:string}){
 const kind=input.kind==='PURCHASE'?'PURCHASE':input.kind==='SALE'?'SALE':null,issued=date(input.date,'수정 작성일'),business=normalizeBusinessNumber(input.businessNumber);
 if(!kind||!issued||!business||![input.gross,input.supply,input.tax].every(v=>/^-?\d{1,20}$/.test(v))||BigInt(input.gross)>=0n||BigInt(input.supply)>=0n||BigInt(input.tax)>0n||BigInt(input.gross)!==BigInt(input.supply)+BigInt(input.tax))throw new InputError('음수 수정증빙의 구분·작성일·사업자·금액을 확인하세요.');
 const first=new Date(Date.UTC(issued.getUTCFullYear(),issued.getUTCMonth(),1));
 const docs=await db.tradeDocument.findMany({where:{companyId:COMPANY_ID,kind,voidedAt:null,settledAmount:0,AND:[{OR:[{cashPlanId:null},{cashPlan:{companyId:COMPANY_ID,completedAt:null,replacedById:null,settlements:{none:{voidedAt:null}}}}]}],monthlyPayment:null,proofConfirmed:true,evidence:'TAX_INVOICE',taxApprovalNumber:{not:null},issuedDate:{lt:first},partner:{businessNumber:business},grossAmount:(-BigInt(input.gross)).toString(),supplyAmount:(-BigInt(input.supply)).toString(),taxAmount:(-BigInt(input.tax)).toString()},select:{id:true,reference:true,title:true,version:true,taxApprovalNumber:true,issuedDate:true},orderBy:[{issuedDate:'desc'},{id:'desc'}],take:101});
 if(docs.length>100)throw new InputError('이전 달 일치 원본이 많습니다. 청구 원본을 먼저 확인하세요.');return docs.map(d=>({...d,issuedDate:d.issuedDate.toISOString().slice(0,10)}));
}

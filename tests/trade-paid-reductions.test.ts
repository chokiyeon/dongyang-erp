import {prepareLaterPaidCancellation,registerPaidCancellation,paidCancellationCandidates} from '../src/lib/trade-paid-cancellations';
import {undoTradeCancellation} from '../src/lib/trade-cancellations';
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {randomUUID} from 'node:crypto';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
import {saveTradeDocument,linkTradeBank,unlinkTradeBank} from '../src/lib/trades';
import {connectTradeCashPlan} from '../src/lib/trade-cash';
import {preparePaidReduction,registerPaidReduction} from '../src/lib/trade-paid-reductions';
import {undoTradeReduction} from '../src/lib/trade-reductions';
import {settleCashPlan,voidCashSettlement,cashSummary} from '../src/lib/cash';
import {captureAccounting} from '../src/lib/accounting-delivery';
import {transferPreparation} from '../src/lib/transfer-preparation';
import {tradeRemaining} from '../src/lib/trade-types';
import {amendRefundSchedule} from '../src/lib/refund-schedule';
import type {Prisma} from '../src/generated/prisma/client';
const form=(v:Record<string,string>)=>{const d=new FormData();for(const[k,x]of Object.entries(v))d.set(k,x);return d;};
const id=()=>randomUUID().replace(/-/g,'').toUpperCase();
async function workbook(kind:'SALE'|'PURCHASE',approval:string,supply='-200',tax='-20'){
 const b=new ExcelJS.Workbook(),s=b.addWorksheet(kind==='SALE'?'매 출':'매 입'),h=Array(43).fill('');h[0]='작성일자';h[1]='승인번호';h[14]='합계금액';h[15]='공급가액';h[16]='세액';s.addRow(h);const r=Array(43).fill('');r[0]='2026-10-20';r[1]=approval;r[kind==='SALE'?9:4]='0012345678';r[kind==='SALE'?11:6]='감액 합성업체';r[14]=(BigInt(supply)+BigInt(tax)).toString();r[15]=supply;r[16]=tax;r[18]='수정세금계산서';r[26]='부분 감액';s.addRow(r);return new Uint8Array(await b.xlsx.writeBuffer());
}
async function rollback(work:(tx:Prisma.TransactionClient)=>Promise<void>){const db=getDb(),marker=new Error('PAID_CREDIT_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'기지급 감액 검증 회사'},update:{}});await work(tx);throw marker;},{timeout:60000}),e=>e===marker);}finally{await db.$disconnect();}}
async function setup(tx:Prisma.TransactionClient,kind:'SALE'|'PURCHASE',scope:'SAME'|'LATER',paid='1100'){
 const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:id(),name:'감액 합성업체',type:'BOTH',businessNumber:'0012345678',payeeBank:'검증은행',payeeAccount:'001-000-000',payeeHolder:'감액 합성업체',payeeVerifiedAt:new Date()}}),project=await tx.project.create({data:{companyId:COMPANY_ID,code:id(),name:'기지급 감액 합성 공사'}}),account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:'검증은행',label:id()}}),period=scope==='LATER'?'2026-09':'2026-10';
 const documentId=await saveTradeDocument(tx,form({requestId:randomUUID(),version:'0',kind,reference:id(),title:'은행 대조한 원본 청구',partnerId:partner.id,projectId:project.id,issuedDate:`${period}-01`,dueDate:`${period}-30`,supplyAmount:'1000',taxAmount:'100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',proofConfirmed:'on',inputVatReview:'DEDUCTIBLE',taxApprovalNumber:id(),reason:'합성 원본 확인',paymentMethod:'BANK_TRANSFER',profitCategory:kind==='PURCHASE'?'MATERIAL':''}));
 await connectTradeCashPlan(tx,form({documentId,version:'0',requestId:randomUUID(),reason:'원본 지급예산 연결',mode:'NEW',noDuplicate:'on'}));
 const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date(`${period}-10`),direction:kind==='PURCHASE'?'OUT':'IN',amount:paid,description:'원 지급 실적',bankBalance:'9000'}});
 await linkTradeBank(tx,form({documentId,version:'1',requestId:randomUUID(),transactionId:bank.id,amount:paid,note:'원 은행 대조'}));
 const current=()=>tx.tradeDocument.findUniqueOrThrow({where:{id:documentId}});
 const prepare=(extra:Record<string,string>={})=>preparePaidReduction(form({requestId:randomUUID(),sheet:kind==='SALE'?'매 출':'매 입',sourceRow:'2',originalDocumentId:documentId,version:'2',paidReductionConfirmed:'on',refundDueDate:'2026-11-01',reason:'기지급 부분 감액 대조',...extra}),'감액.xlsx',workbookBytes,scope);
 const workbookBytes=await workbook(kind,id());return{partner,project,account,bank,documentId,current,prepare,period,workbookBytes};
}
for(const kind of ['PURCHASE','SALE'] as const)for(const scope of ['SAME','LATER'] as const)test(`${kind} ${scope} 기지급 부분 감액은 원 지급을 보존하고 초과분만 환급·회계·송금에 연결한다`,async()=>rollback(async tx=>{
 const x=await setup(tx,kind,scope),before=await captureAccounting(tx,x.period),source=await x.prepare();
 if(scope==='LATER')await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:x.period}},create:{companyId:COMPANY_ID,period:x.period,packageId:'합성',digest:'합성',locked:true},update:{locked:true}});
 const saved=await registerPaidReduction(tx,source);assert.equal((await registerPaidReduction(tx,source)).replayed,true);const r=await tx.tradeReduction.findUniqueOrThrow({where:{id:saved.reductionId}});let p=await tx.cashPlan.findUniqueOrThrow({where:{id:r.refundPlanId!},include:{settlements:true}}),d=await x.current();
 assert.equal(d.grossAmount.toFixed(0),'880');assert.equal(d.settledAmount.toFixed(0),'1100');assert.equal(tradeRemaining('880','1100'),0n);assert.equal(p.plannedAmount.toFixed(0),'220');assert.equal(p.direction,kind==='PURCHASE'?'IN':'OUT');assert.equal((await tx.bankTransaction.findUniqueOrThrow({where:{id:x.bank.id}})).bankBalance?.toFixed(0),'9000');assert.equal(await tx.bankTransaction.count({where:{accountId:x.account.id}}),1);
 const primary=await tx.cashPlan.findUniqueOrThrow({where:{id:d.cashPlanId!},include:{settlements:true}});assert.equal(primary.plannedAmount.toFixed(0),'880');assert.equal(cashSummary(primary).actual,1100n);assert.equal(cashSummary(primary).remaining,0n);
 if(scope==='LATER')assert.equal((await captureAccounting(tx,x.period)).digest,before.digest);
 const link=await tx.tradeBankLink.findFirstOrThrow({where:{documentId:d.id,voidedAt:null}});await assert.rejects(unlinkTradeBank(tx,form({linkId:link.id,version:String(d.version),reason:'원 지급 해제 시도'})),/원 지급/);
 const prep=await transferPreparation(tx,'2026-11-30');assert.equal(prep.ready.find(row=>row.id===`credit-refund:${r.id}`)?.amount,kind==='SALE'?'220':undefined);assert.ok(!prep.ready.some(row=>row.id===`invoice:${d.id}`));
 await assert.rejects(settleCashPlan(tx,form({planId:p.id,version:String(p.version),requestId:randomUUID(),amount:'220',processedDate:'2026-11-01',note:'수기 환급 시도'})),/실제 은행/);
 const october=await captureAccounting(tx,'2026-10');
 const settle=async(amount:string,day:string)=>{p=await tx.cashPlan.findUniqueOrThrow({where:{id:p.id},include:{settlements:true}});const b=await tx.bankTransaction.create({data:{accountId:x.account.id,tradedDate:new Date(day),direction:p.direction,amount,description:'실제 감액 환급'}});await settleCashPlan(tx,form({planId:p.id,version:String(p.version),requestId:randomUUID(),bankTransactionId:b.id,amount,note:'실제 환급 은행 대조'}));};
 await settle('150','2026-11-01');p=await tx.cashPlan.findUniqueOrThrow({where:{id:p.id},include:{settlements:true}});assert.equal(cashSummary(p).remaining,70n);
 await assert.rejects(undoTradeReduction(tx,form({reductionId:r.id,version:'0',requestId:randomUUID(),reason:'환급 중 감액 정정 시도'})),/환급한 은행/);
 await settle('70','2026-11-02');p=await tx.cashPlan.findUniqueOrThrow({where:{id:p.id},include:{settlements:true}});assert.equal(cashSummary(p).remaining,0n);assert.equal((await captureAccounting(tx,'2026-10')).digest,october.digest);
 const november=await captureAccounting(tx,'2026-11'),table=november.snapshot.tables.find(t=>t.title==='기지급 부분 감액 환급 정산')!;const row=table.rows.find(row=>row[0]===r.id)!;assert.equal(row[9],'220');assert.equal(row[10],'220');assert.equal(row[11],'0');assert.ok(november.snapshot.attachments?.some(a=>a.id===r.fileId));
 for(let i=0;i<2;i++){p=await tx.cashPlan.findUniqueOrThrow({where:{id:p.id},include:{settlements:true}});const latest=await tx.cashSettlement.findFirstOrThrow({where:{planId:p.id,voidedAt:null},orderBy:[{createdAt:'desc'},{id:'desc'}]});await voidCashSettlement(tx,form({settlementId:latest.id,version:String(p.version),reason:'합성 환급 연결 오류 정정'}));}
 await undoTradeReduction(tx,form({reductionId:r.id,version:'0',requestId:randomUUID(),reason:'감액 입력 오류 정정'}));d=await x.current();assert.equal(d.grossAmount.toFixed(0),'1100');assert.equal(d.settledAmount.toFixed(0),'1100');if(scope==='LATER')assert.equal((await captureAccounting(tx,x.period)).digest,before.digest);
}));
test('일부 지급 뒤 감액은 남은 미지급만 줄이고 후속 은행 지급·해제를 원 지급과 구분한다',async()=>rollback(async tx=>{
 const x=await setup(tx,'PURCHASE','LATER','400'),saved=await registerPaidReduction(tx,await x.prepare({refundDueDate:''})),r=await tx.tradeReduction.findUniqueOrThrow({where:{id:saved.reductionId}});assert.equal(r.refundPlanId,null);assert.equal(tradeRemaining((await x.current()).grossAmount.toFixed(0),(await x.current()).settledAmount.toFixed(0)),480n);assert.equal((await transferPreparation(tx,'2026-11-30')).ready.find(row=>row.id===`invoice:${x.documentId}`)?.amount,'480');
 const bank=await tx.bankTransaction.create({data:{accountId:x.account.id,tradedDate:new Date('2026-10-25'),direction:'OUT',amount:'480',description:'감액 후 잔액 지급'}});let d=await x.current();await linkTradeBank(tx,form({documentId:d.id,version:String(d.version),requestId:randomUUID(),transactionId:bank.id,amount:'480',note:'감액 후 실제 잔액 지급'}));
 await assert.rejects(undoTradeReduction(tx,form({reductionId:r.id,version:'0',requestId:randomUUID(),reason:'후속 지급 중 정정'})),/원 지급 연결이 변경/);
 const link=await tx.tradeBankLink.findFirstOrThrow({where:{documentId:d.id,transactionId:bank.id,voidedAt:null}});d=await x.current();await unlinkTradeBank(tx,form({linkId:link.id,version:String(d.version),reason:'후속 지급 연결 정정'}));await undoTradeReduction(tx,form({reductionId:r.id,version:'0',requestId:randomUUID(),reason:'감액 원본 입력 정정'}));assert.equal(tradeRemaining((await x.current()).grossAmount.toFixed(0),(await x.current()).settledAmount.toFixed(0)),700n);
}));

test('부분 감액 환급 일정은 금액·은행 실적을 유지하고 이전 작성월 자료를 보존한다',async()=>rollback(async tx=>{
 const x=await setup(tx,'PURCHASE','LATER'),saved=await registerPaidReduction(tx,await x.prepare()),r=await tx.tradeReduction.findUniqueOrThrow({where:{id:saved.reductionId}}),p=await tx.cashPlan.findUniqueOrThrow({where:{id:r.refundPlanId!}}),before=await captureAccounting(tx,'2026-10');
 const request=form({sourceType:'REDUCTION',cancellationId:r.id,planId:p.id,version:String(p.version),requestId:randomUUID(),plannedDate:'2026-11-30',confirmed:'on',reason:'거래처 환급 일정 변경 확인'});
 await amendRefundSchedule(tx,request);await amendRefundSchedule(tx,request);const changed=await tx.cashPlan.findUniqueOrThrow({where:{id:p.id}});assert.equal(changed.plannedAmount.toFixed(0),'220');assert.equal(changed.plannedDate.toISOString().slice(0,10),'2026-11-30');assert.equal((await captureAccounting(tx,'2026-10')).digest,before.digest);assert.equal(await tx.financeChange.count({where:{entityId:p.id}}),1);
 await assert.rejects(connectTradeCashPlan(tx,form({documentId:x.documentId,version:String((await x.current()).version),requestId:randomUUID(),mode:'DETACH',reason:'감액 원 지급예산 분리 시도'})),/감액의 지급·예산안 대조 기준/);
 const target=await saveTradeDocument(tx,form({requestId:randomUUID(),version:'0',kind:'SALE',reference:id(),title:'환급 예정 승계 시도',partnerId:x.partner.id,projectId:x.project.id,issuedDate:'2026-10-25',dueDate:'2026-11-30',supplyAmount:'200',taxAmount:'20',taxKind:'TAXABLE',evidence:'STATEMENT',proofConfirmed:'on',inputVatReview:'PENDING',reason:'별도 합성 청구'}));
 await assert.rejects(connectTradeCashPlan(tx,form({documentId:target,version:'0',requestId:randomUUID(),cashPlanId:p.id,mode:'EXISTING',noDuplicate:'on',reason:'환급을 다른 청구로 연결 시도'})),/일반 예정/);
}));
test('연속 기지급 감액은 초과 지급 증가분만 각각 환급하고 최신 감액부터 정정한다',async()=>rollback(async tx=>{
 const x=await setup(tx,'PURCHASE','LATER'),first=await registerPaidReduction(tx,await x.prepare()),d=await x.current();
 const source=await preparePaidReduction(form({requestId:randomUUID(),sheet:'매 입',sourceRow:'2',originalDocumentId:d.id,version:String(d.version),paidReductionConfirmed:'on',refundDueDate:'2026-11-03',reason:'후속 감액 대조'}),'후속감액.xlsx',await workbook('PURCHASE',id(),'-100','-10'),'LATER');
 const second=await registerPaidReduction(tx,source),r1=await tx.tradeReduction.findUniqueOrThrow({where:{id:first.reductionId}}),r2=await tx.tradeReduction.findUniqueOrThrow({where:{id:second.reductionId}});assert.equal((await tx.cashPlan.findUniqueOrThrow({where:{id:r1.refundPlanId!}})).plannedAmount.toFixed(0),'220');assert.equal((await tx.cashPlan.findUniqueOrThrow({where:{id:r2.refundPlanId!}})).plannedAmount.toFixed(0),'110');assert.equal((await x.current()).grossAmount.toFixed(0),'770');
 const p=await tx.cashPlan.findUniqueOrThrow({where:{id:r1.refundPlanId!}}),bank=await tx.bankTransaction.create({data:{accountId:x.account.id,tradedDate:new Date('2026-11-01'),direction:'IN',amount:'220',description:'선행 감액 환급'}});await settleCashPlan(tx,form({planId:p.id,version:String(p.version),requestId:randomUUID(),bankTransactionId:bank.id,amount:'220',note:'후속 감액 뒤 선행 환급 확인'}));
 await assert.rejects(undoTradeReduction(tx,form({reductionId:r1.id,version:'0',requestId:randomUUID(),reason:'선행 감액 먼저 정정 시도'})),/변경/);
 await undoTradeReduction(tx,form({reductionId:r2.id,version:'0',requestId:randomUUID(),reason:'후속 감액 입력 정정'}));assert.equal((await x.current()).grossAmount.toFixed(0),'880');assert.equal((await x.current()).settledAmount.toFixed(0),'1100');
}));

for(const kind of ['PURCHASE','SALE'] as const)test(`${kind} 감액 뒤 잔액 전액취소는 기존 환급을 중복하지 않고 미회수 청구를 각각 유지한다`,async()=>rollback(async tx=>{
 const x=await setup(tx,kind,'LATER'),before=await captureAccounting(tx,'2026-09'),credit=await registerPaidReduction(tx,await x.prepare()),r=await tx.tradeReduction.findUniqueOrThrow({where:{id:credit.reductionId}}),d=await x.current();
 const source=await prepareLaterPaidCancellation(form({requestId:randomUUID(),sheet:kind==='SALE'?'매 출':'매 입',sourceRow:'2',originalDocumentId:d.id,version:String(d.version),laterPaidCancellationConfirmed:'on',refundDueDate:'2026-11-03',reason:'감액 후 나머지 전액취소'}),'잔액취소.xlsx',await workbook(kind,id(),'-800','-80'));
 const candidate=(await paidCancellationCandidates(tx,{kind,date:'2026-10-20',gross:'-880',supply:'-800',tax:'-80',businessNumber:'0012345678'},'LATER')).find(row=>row.id===d.id);assert.equal(candidate?.refundAmount,'880');
 const cancelled=await registerPaidCancellation(tx,source,'LATER'),c=await tx.tradeCancellation.findUniqueOrThrow({where:{id:cancelled.cancellationId}}),p=await tx.cashPlan.findUniqueOrThrow({where:{id:c.refundPlanId!}});assert.equal(p.plannedAmount.toFixed(0),'880');assert.equal((await tx.cashPlan.findUniqueOrThrow({where:{id:r.refundPlanId!}})).plannedAmount.toFixed(0),'220');assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);
 if(kind==='SALE'){const prepared=await transferPreparation(tx,'2026-11-30');assert.equal(prepared.ready.filter(row=>row.id===`refund:${c.id}`||row.id===`credit-refund:${r.id}`).reduce((v,row)=>v+BigInt(row.amount),0n),1100n);}
 for(const planId of [r.refundPlanId!,c.refundPlanId!]){const plan=await tx.cashPlan.findUniqueOrThrow({where:{id:planId}}),bank=await tx.bankTransaction.create({data:{accountId:x.account.id,tradedDate:new Date('2026-11-03'),direction:plan.direction,amount:plan.plannedAmount,description:'감액 및 잔액 취소 환급'}});await settleCashPlan(tx,form({planId,version:String(plan.version),requestId:randomUUID(),bankTransactionId:bank.id,amount:plan.plannedAmount.toFixed(0),note:'각 수정증빙의 실제 은행 환급'}));}
 assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);
 const cash=await tx.cashSettlement.findFirstOrThrow({where:{planId:c.refundPlanId!,voidedAt:null}}),done=await tx.cashPlan.findUniqueOrThrow({where:{id:c.refundPlanId!}});await voidCashSettlement(tx,form({settlementId:cash.id,version:String(done.version),reason:'잔액 취소 환급 연결 정정'}));await undoTradeCancellation(tx,form({cancellationId:c.id,version:'0',requestId:randomUUID(),reason:'잔액 취소 등록 정정'}));assert.equal((await x.current()).voidedAt,null);assert.equal((await x.current()).grossAmount.toFixed(0),'880');
}));

test('부분 감액 환급은 초과·차액 임의완료·은행 중복 청구 연결을 차단한다',async()=>rollback(async tx=>{
 const x=await setup(tx,'PURCHASE','LATER'),saved=await registerPaidReduction(tx,await x.prepare()),r=await tx.tradeReduction.findUniqueOrThrow({where:{id:saved.reductionId}}),p=await tx.cashPlan.findUniqueOrThrow({where:{id:r.refundPlanId!}}),bank=await tx.bankTransaction.create({data:{accountId:x.account.id,tradedDate:new Date('2026-11-01'),direction:'IN',amount:'300',description:'환급 상한 검증 은행'}});
 const input=(amount:string,finish='')=>form({planId:p.id,version:String(p.version),requestId:randomUUID(),bankTransactionId:bank.id,amount,finish,note:'환급 잔액 한도 대조'});
 await assert.rejects(settleCashPlan(tx,input('221','on')),/환급 잔액/);await assert.rejects(settleCashPlan(tx,input('100','on')),/임의 완료/);assert.equal(await tx.cashSettlement.count({where:{planId:p.id}}),0);await settleCashPlan(tx,input('100'));
 const target=await saveTradeDocument(tx,form({requestId:randomUUID(),version:'0',kind:'SALE',reference:id(),title:'환급 은행의 다른 매출 연결 시도',partnerId:x.partner.id,projectId:x.project.id,issuedDate:'2026-10-25',supplyAmount:'200',taxAmount:'20',taxKind:'TAXABLE',evidence:'STATEMENT',proofConfirmed:'on',inputVatReview:'PENDING',reason:'별도 합성 청구'}));
 await assert.rejects(linkTradeBank(tx,form({documentId:target,version:'0',requestId:randomUUID(),transactionId:bank.id,amount:'100',note:'환급과 매출 입금 중복 연결 시도'})),/환급에 연결/);assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:target}})).settledAmount.toFixed(0),'0');assert.equal(cashSummary(await tx.cashPlan.findUniqueOrThrow({where:{id:p.id},include:{settlements:true}})).remaining,120n);
}));

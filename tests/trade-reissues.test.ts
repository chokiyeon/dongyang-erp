import {transferPreparation} from "../src/lib/transfer-preparation";
import {prepareLaterCancellation,registerLaterCancellation} from '../src/lib/trade-later-cancellations';
import {preparePaidCancellation,registerPaidCancellation} from '../src/lib/trade-paid-cancellations';
import {replacementCandidates} from '../src/lib/trade-cancellations';
import {settleCashPlan,voidCashSettlement} from '../src/lib/cash';
import {linkTradeBank,voidTradeDocument} from '../src/lib/trades';
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {randomUUID} from 'node:crypto';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
import {prepareTradeCancellation,registerTradeCancellation,undoTradeCancellation,hasActiveReissue} from '../src/lib/trade-cancellations';
import {prepareTradeWorkbookImport,importTradeWorkbookRow} from '../src/lib/trade-workbook-import';
import {saveTradeDocument} from '../src/lib/trades';
import {profitSources} from '../src/lib/project-profit';
import {summarizeProjectProfit} from '../src/lib/project-profit-summary';
import {captureAccounting} from '../src/lib/accounting-delivery';
const form=(v:Record<string,string>)=>{const f=new FormData();for(const[k,x]of Object.entries(v))f.set(k,x);return f;};
async function workbook(approval:string,date:string,supply:string,tax:string){const b=new ExcelJS.Workbook(),s=b.addWorksheet('매 입'),h=Array(43).fill('');h[0]='작성일자';h[1]='승인번호';h[14]='합계금액';h[15]='공급가액';h[16]='세액';s.addRow(h);const r=Array(43).fill('');r[0]=date;r[1]=approval;r[4]='0012345678';r[6]='재발급 합성업체';r[14]=(BigInt(supply)+BigInt(tax)).toString();r[15]=supply;r[16]=tax;r[18]='수정세금계산서';r[26]='재발급 합성 자재';s.addRow(r);return new Uint8Array(await b.xlsx.writeBuffer());}
const approval=()=>randomUUID().replace(/-/g,'').toUpperCase();
test('전액취소 후 양수 수정 재발급을 연결하고 활성 후속 청구가 있으면 옛 청구 복원을 막는다',async()=>{
 const db=getDb(),rollback=new Error('REISSUE_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'재발급 합성 회사'},update:{}});const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:approval(),name:'재발급 합성업체',type:'SUPPLIER',businessNumber:'0012345678'}}),project=await tx.project.create({data:{companyId:COMPANY_ID,code:approval(),name:'재발급 합성 공사'}});
 const first=await saveTradeDocument(tx,form({requestId:randomUUID(),version:'0',kind:'PURCHASE',reference:approval(),title:'재발급 전 원본',partnerId:partner.id,projectId:project.id,profitCategory:'MATERIAL',issuedDate:'2026-10-01',supplyAmount:'1000',taxAmount:'100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',proofConfirmed:'on',inputVatReview:'DEDUCTIBLE',taxApprovalNumber:approval(),reason:'합성 원본 확인'}));
 const cancelled=await registerTradeCancellation(tx,await prepareTradeCancellation(form({requestId:randomUUID(),sheet:'매 입',sourceRow:'2',originalDocumentId:first,version:'0',reason:'합성 전액취소',cancellationConfirmed:'on'}),'수정.xlsx',await workbook(approval(),'2026-10-20','-1000','-100')));
 const values={requestId:randomUUID(),sheet:'매 입',sourceRow:'2',reference:approval(),title:'합성 양수 수정 재발급',partnerId:partner.id,projectId:project.id,profitCategory:'MATERIAL',taxKind:'TAXABLE',mappingConfirmed:'on',reason:'원본 취소 후 재발급 대조'},bytes=await workbook(approval(),'2026-10-21','1200','120');await assert.rejects(prepareTradeWorkbookImport(form(values),'재발급.xlsx',bytes),/전액취소 원본/);
 const prepared=await prepareTradeWorkbookImport(form({...values,replacesCancellationId:cancelled.cancellationId}),'재발급.xlsx',bytes),reissued=await importTradeWorkbookRow(tx,prepared);assert.equal((await tx.tradeWorkbookSource.findUniqueOrThrow({where:{documentId:reissued.id}})).replacesCancellationId,cancelled.cancellationId);const costs=await profitSources(tx,project.id);assert.equal(summarizeProjectProfit(project,costs.documents,costs.entries).incurred,1200n);assert.equal(summarizeProjectProfit(project,costs.documents,costs.entries).unpaid,1320n);
 await assert.rejects(undoTradeCancellation(tx,form({cancellationId:cancelled.cancellationId,version:'0',requestId:randomUUID(),reason:'중복 복원 차단'})),/재발급/);
 const secondCancel=await registerTradeCancellation(tx,await prepareTradeCancellation(form({requestId:randomUUID(),sheet:'매 입',sourceRow:'2',originalDocumentId:reissued.id,version:'0',reason:'후속 합성 전액취소',cancellationConfirmed:'on'}),'후속수정.xlsx',await workbook(approval(),'2026-10-22','-1200','-120')));
 const tail=await importTradeWorkbookRow(tx,await prepareTradeWorkbookImport(form({...values,requestId:randomUUID(),reference:approval(),replacesCancellationId:secondCancel.cancellationId}),'후속재발급.xlsx',await workbook(approval(),'2026-10-23','1500','150')));assert.ok(tail.id);assert.equal(await hasActiveReissue(tx,cancelled.cancellationId),true);await assert.rejects(undoTradeCancellation(tx,form({cancellationId:cancelled.cancellationId,version:'0',requestId:randomUUID(),reason:'연쇄 재발급 중복 복원 차단'})),/후속 재발급/);
 const delivery=await captureAccounting(tx,'2026-10');const table=delivery.snapshot.tables.find(t=>t.title==='매입매출 이관 원본')!;assert.equal(table.headers.at(-1),'재발급 취소 연결');assert.ok(table.rows.some(r=>r[0]===tail.id&&r.at(-1)===secondCancel.cancellationId));throw rollback;
 },{timeout:30000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});

test('다른 달 미정산 취소는 이후 작성월 재발급과 연결해 마감 원본·수정월 자료를 보존한다',async()=>{
 const db=getDb(),rollback=new Error('LATER_REISSUE');try{await assert.rejects(db.$transaction(async tx=>{
  const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:approval(),name:'재발급 합성업체',type:'SUPPLIER',businessNumber:'0012345678'}}),project=await tx.project.create({data:{companyId:COMPANY_ID,code:approval(),name:'다른 달 재발급 공사'}});
  const original=await saveTradeDocument(tx,form({requestId:randomUUID(),version:'0',kind:'PURCHASE',reference:approval(),title:'원본 작성월 보존',partnerId:partner.id,projectId:project.id,issuedDate:'2026-09-01',supplyAmount:'1000',taxAmount:'100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',proofConfirmed:'on',inputVatReview:'DEDUCTIBLE',taxApprovalNumber:approval(),reason:'합성 원본',profitCategory:'MATERIAL'}));
  const september=await captureAccounting(tx,'2026-09'),cancelled=await registerLaterCancellation(tx,await prepareLaterCancellation(form({requestId:randomUUID(),sheet:'매 입',sourceRow:'2',originalDocumentId:original,version:'0',reason:'다른 달 취소',laterCancellationConfirmed:'on'}),'취소.xlsx',await workbook(approval(),'2026-10-20','-1000','-100'))),october=await captureAccounting(tx,'2026-10');
  for(const period of ['2026-09','2026-10'])await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period}},create:{companyId:COMPANY_ID,period,packageId:'합성',digest:'합성',locked:true},update:{locked:true}});
  assert.ok((await replacementCandidates(tx,{kind:'PURCHASE',date:'2026-11-02',businessNumber:'0012345678'})).some(c=>c.id===cancelled.cancellationId));
  const values={requestId:randomUUID(),sheet:'매 입',sourceRow:'2',reference:approval(),title:'이후 작성월 재발급',partnerId:partner.id,projectId:project.id,profitCategory:'MATERIAL',taxKind:'TAXABLE',proofConfirmed:'on',mappingConfirmed:'on',reason:'기간 구분 재발급 대조',replacesCancellationId:cancelled.cancellationId};
  const next=await importTradeWorkbookRow(tx,await prepareTradeWorkbookImport(form(values),'재발급.xlsx',await workbook(approval(),'2026-11-02','1200','120')));assert.equal(await hasActiveReissue(tx,cancelled.cancellationId),true);assert.equal((await captureAccounting(tx,'2026-09')).digest,september.digest);assert.equal((await captureAccounting(tx,'2026-10')).digest,october.digest);
  const costs=await profitSources(tx,project.id);assert.equal(summarizeProjectProfit(project,costs.documents,costs.entries).incurred,1200n);assert.equal(summarizeProjectProfit(project,costs.documents,costs.entries).unpaid,1320n);
  await tx.accountingPeriodLock.update({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-10'}},data:{locked:false}});await assert.rejects(undoTradeCancellation(tx,form({cancellationId:cancelled.cancellationId,version:'0',requestId:randomUUID(),reason:'후속 청구 중 옛 청구 복원 시도'})),/재발급/);
  await voidTradeDocument(tx,form({documentId:next.id,version:'0',requestId:randomUUID(),reason:'재발급 입력 오류 정정'}));await undoTradeCancellation(tx,form({cancellationId:cancelled.cancellationId,version:'0',requestId:randomUUID(),reason:'이전 취소 입력 정정'}));assert.equal((await captureAccounting(tx,'2026-09')).digest,september.digest);
  throw rollback;
 },{timeout:60000}),e=>e===rollback);}finally{await db.$disconnect();}
});

test('미회수 환급과 재발급 청구는 별도 기록하고 환급 연결 해제 시 송금 준비를 다시 보류한다',async()=>{
 const db=getDb(),rollback=new Error('REFUNDED_REISSUE');try{await assert.rejects(db.$transaction(async tx=>{
  const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:approval(),name:'재발급 합성업체',type:'SUPPLIER',businessNumber:'0012345678'}}),account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:'검증은행',label:approval()}});
  const original=await saveTradeDocument(tx,form({requestId:randomUUID(),version:'0',kind:'PURCHASE',reference:approval(),title:'기지급 재발급 원본',partnerId:partner.id,issuedDate:'2026-10-01',supplyAmount:'1000',taxAmount:'100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',proofConfirmed:'on',inputVatReview:'DEDUCTIBLE',taxApprovalNumber:approval(),reason:'합성 원본',companyExpense:'on'}));
  const paidBank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date('2026-10-10'),direction:'OUT',amount:'400',description:'실제 원 지급'}});await linkTradeBank(tx,form({documentId:original,version:'0',requestId:randomUUID(),transactionId:paidBank.id,amount:'400',note:'원 지급 확인'}));
  const cancelled=await registerPaidCancellation(tx,await preparePaidCancellation(form({requestId:randomUUID(),sheet:'매 입',sourceRow:'2',originalDocumentId:original,version:'1',reason:'기지급 취소',paidCancellationConfirmed:'on',refundDueDate:'2026-11-03'}),'취소.xlsx',await workbook(approval(),'2026-10-20','-1000','-100'))),c=await tx.tradeCancellation.findUniqueOrThrow({where:{id:cancelled.cancellationId}});let plan=await tx.cashPlan.findUniqueOrThrow({where:{id:c.refundPlanId!}});
  const values={requestId:randomUUID(),sheet:'매 입',sourceRow:'2',reference:approval(),title:'환급 후 재발급',partnerId:partner.id,companyExpense:'on',dueDate:'2026-11-30',paymentMethod:'BANK_TRANSFER',taxKind:'TAXABLE',proofConfirmed:'on',mappingConfirmed:'on',reason:'환급 완료와 새 청구 대조',replacesCancellationId:c.id},source=await prepareTradeWorkbookImport(form(values),'재발급.xlsx',await workbook(approval(),'2026-11-02','700','70'));
  const before=await captureAccounting(tx,'2026-10'),next=await importTradeWorkbookRow(tx,source);assert.equal((await captureAccounting(tx,'2026-10')).digest,before.digest);assert.ok((await replacementCandidates(tx,{kind:'PURCHASE',date:'2026-11-02',businessNumber:'0012345678'})).some(r=>r.id===c.id));
  await tx.partner.update({where:{id:partner.id},data:{payeeBank:'검증은행',payeeAccount:'001-0000',payeeHolder:'검증업체',payeeVerifiedAt:new Date()}});
  const pending=async()=> (await transferPreparation(tx,'2026-11-30')).held.find(r=>r.id===`invoice:${next.id}`)?.issues.includes('재발급 원본 환급 미완료 · 별도 회수 확인 필요')??false;assert.equal(await pending(),true);assert.equal((await transferPreparation(tx,'2026-11-30')).held.find(r=>r.id===`invoice:${next.id}`)?.refundLink,`/trade-cancellations?view=${c.id}`);assert.equal(await tx.bankTransaction.count({where:{accountId:account.id}}),1);
  const refundBank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date('2026-11-03'),direction:'IN',amount:'400',description:'실제 환급 입금'}});await settleCashPlan(tx,form({planId:plan.id,version:String(plan.version),requestId:randomUUID(),bankTransactionId:refundBank.id,amount:'400',note:'실제 은행 환급 완료'}));plan=await tx.cashPlan.findUniqueOrThrow({where:{id:plan.id}});assert.ok((await replacementCandidates(tx,{kind:'PURCHASE',date:'2026-11-02',businessNumber:'0012345678'})).some(r=>r.id===c.id));
  assert.equal(await pending(),false);assert.equal((await transferPreparation(tx,'2026-11-30')).ready.find(r=>r.id===`invoice:${next.id}`)?.amount,'770');assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:next.id}})).settledAmount.toFixed(0),'0');assert.equal(await tx.bankTransaction.count({where:{accountId:account.id}}),2);
  const settlement=await tx.cashSettlement.findFirstOrThrow({where:{planId:plan.id,voidedAt:null}});await voidCashSettlement(tx,form({settlementId:settlement.id,version:String(plan.version),reason:'환급 은행 연결 오류 정정'}));assert.equal(await pending(),true);assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:next.id}})).voidedAt,null);await assert.rejects(undoTradeCancellation(tx,form({cancellationId:c.id,version:'0',requestId:randomUUID(),reason:'활성 청구 중 복원 시도'})),/재발급/);
  await voidTradeDocument(tx,form({documentId:next.id,version:'0',requestId:randomUUID(),reason:'재발급 잘못 연결한 입력 정정'}));await undoTradeCancellation(tx,form({cancellationId:c.id,version:'0',requestId:randomUUID(),reason:'취소 등록 입력 정정'}));assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:original}})).voidedAt,null);assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:original}})).settledAmount.toFixed(0),'400');
  throw rollback;
 },{timeout:60000}),e=>e===rollback);}finally{await db.$disconnect();}
});

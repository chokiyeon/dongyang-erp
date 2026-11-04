import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '../src/generated/prisma/client';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
import {prepareLaterCancellation,registerLaterCancellation,laterCancellationCandidates} from '../src/lib/trade-later-cancellations';
import {undoTradeCancellation,replacementCandidates} from '../src/lib/trade-cancellations';
import {LATER_CANCELLATION,readTaxPeriod,tradeActiveAt} from '../src/lib/trade-period';
import {captureAccounting} from '../src/lib/accounting-delivery';
import {summarizeVat} from '../src/lib/tax-summary';
import {profitSources} from '../src/lib/project-profit';
import {summarizeProjectProfit} from '../src/lib/project-profit-summary';
import {findExistingWorkbookTrades} from '../src/lib/trade-workbook-existing';
const form=(v:Record<string,string>)=>{const f=new FormData();Object.entries(v).forEach(([k,x])=>f.set(k,x));return f;};
async function workbook(kind:'PURCHASE'|'SALE',issued='2026-10-20',business='0012345678',supply='-1000',tax='-100'){
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(kind==='PURCHASE'?'매 입':'매 출'),headers=Array(43).fill('');headers[0]='작성일자';headers[1]='승인번호';headers[14]='합계금액';headers[15]='공급가액';headers[16]='세액';sheet.addRow(headers);
 const row=Array(43).fill('');row[0]=issued;row[1]=randomUUID().replace(/-/g,'').toUpperCase();row[kind==='SALE'?9:4]=business;row[kind==='SALE'?11:6]='다른 달 합성업체';row[14]=String(BigInt(supply)+BigInt(tax));row[15]=supply;row[16]=tax;row[18]='수정세금계산서';sheet.addRow(row);return new Uint8Array(await book.xlsx.writeBuffer());
}
async function setup(tx:Prisma.TransactionClient,kind:'PURCHASE'|'SALE'){
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'합성 기간 정산 회사'},update:{}});
 const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:'다른 달 합성업체',businessNumber:'0012345678',type:'BOTH'}}),project=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:'합성 기간 정산 공사'}});
 const doc=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId:partner.id,projectId:project.id,kind,reference:randomUUID(),title:'이전 달 합성 청구',issuedDate:new Date('2026-09-10'),dueDate:new Date('2026-10-31'),supplyAmount:'1000',taxAmount:'100',grossAmount:'1100',profitCategory:kind==='PURCHASE'?'MATERIAL':null,taxKind:'TAXABLE',evidence:'TAX_INVOICE',proofConfirmed:true,inputVatReview:'DEDUCTIBLE',taxApprovalNumber:randomUUID().replace(/-/g,'').toUpperCase(),note:'합성 기간 검증'}});
 const prepare=async(bytes?:Uint8Array,overrides:Record<string,string>={})=>prepareLaterCancellation(form({requestId:randomUUID(),sheet:kind==='PURCHASE'?'매 입':'매 출',sourceRow:'2',originalDocumentId:doc.id,version:'0',reason:'다음 달 계약 전액취소 원본 대조',laterCancellationConfirmed:'on',...overrides}),'기간수정.xlsx',bytes??await workbook(kind));
 return {doc,partner,project,prepare};
}
async function rollbackTest(run:(tx:Prisma.TransactionClient)=>Promise<void>){const db=getDb(),rollback=new Error('LATER_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{await run(tx);throw rollback;},{timeout:60000}),e=>e===rollback);}finally{await db.$disconnect();}}
test('다른 달 미정산 전액취소는 마감 원본 월을 보존하고 수정 월 세액·미지급·회계 전달에 한 번 반영한다',async()=>rollbackTest(async tx=>{
 for(const kind of ['PURCHASE','SALE'] as const){
  const x=await setup(tx,kind),before=await captureAccounting(tx,'2026-09'),banks=await tx.bankTransaction.count(),plans=await tx.cashPlan.count();
  const beforeTax=await readTaxPeriod(tx,COMPANY_ID,new Date('2026-09-01'),new Date('2026-10-01'));
  const candidates=await laterCancellationCandidates(tx,{kind,date:'2026-10-20',gross:'-1100',supply:'-1000',tax:'-100',businessNumber:'0012345678'});assert.ok(candidates.some(c=>c.id===x.doc.id));
  await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-09'}},create:{companyId:COMPANY_ID,period:'2026-09',packageId:'합성',digest:'합성',locked:true},update:{locked:true}});
  const source=await x.prepare(),saved=await registerLaterCancellation(tx,source);assert.deepEqual(await registerLaterCancellation(tx,source),{...saved,replayed:true});
  const d=await tx.tradeDocument.findUniqueOrThrow({where:{id:x.doc.id}});assert.ok(d.voidedAt);assert.equal(d.supplyAmount.toFixed(0),'1000');assert.equal(d.taxAmount.toFixed(0),'100');assert.equal(d.grossAmount.toFixed(0),'1100');assert.equal(d.settledAmount.toFixed(0),'0');assert.equal(d.issuedDate.toISOString().slice(0,10),'2026-09-10');assert.equal(await tx.bankTransaction.count(),banks);assert.equal(await tx.cashPlan.count(),plans);
  assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);assert.equal(await tx.tradeDocument.count({where:{...tradeActiveAt(COMPANY_ID,new Date('2026-09-30')),id:d.id}}),1);assert.equal(await tx.tradeDocument.count({where:{...tradeActiveAt(COMPANY_ID,new Date('2026-10-31')),id:d.id}}),0);
  const september=await readTaxPeriod(tx,COMPANY_ID,new Date('2026-09-01'),new Date('2026-10-01')),october=await readTaxPeriod(tx,COMPANY_ID,new Date('2026-10-01'),new Date('2026-11-01')),year=await readTaxPeriod(tx,COMPANY_ID,new Date('2026-01-01'),new Date('2027-01-01'));
  assert.deepEqual(summarizeVat(september.groups),summarizeVat(beforeTax.groups));const negative=october.rows.find(r=>r.id===saved.cancellationId)!;assert.equal(negative.supplyAmount.toFixed(0),'-1000');assert.equal(negative.taxAmount.toFixed(0),'-100');assert.ok(negative.correction);
  assert.equal(year.rows.filter(r=>r.id===d.id||r.id===saved.cancellationId).reduce((v,r)=>v+BigInt(r.taxAmount.toFixed(0)),0n),0n);assert.ok(year.rows.some(r=>r.id===d.id));assert.ok(year.rows.some(r=>r.id===saved.cancellationId));
  const current=await profitSources(tx,x.project.id);assert.equal(summarizeProjectProfit(x.project,current.documents,current.entries).incurred,0n);assert.equal(summarizeProjectProfit(x.project,current.documents,current.entries).unpaid,0n);
  const accounting=await captureAccounting(tx,'2026-10'),table=accounting.snapshot.tables.find(t=>t.title==='매입 매출')!;assert.equal(table.rows.filter(r=>r[0]===saved.cancellationId).length,1);assert.ok(table.rows.some(r=>r[0]===saved.cancellationId&&r[6]==='-1000'&&r[7]==='-100'&&r[8]==='-1100'&&r[9]==='0'));assert.ok(accounting.snapshot.attachments?.some(f=>f.kind==='TRADE_WORKBOOK'&&f.checksum===source.checksum));
  const matches=await findExistingWorkbookTrades(tx,[source.row.approval]);assert.equal(matches[0].recordType,'CANCELLATION');assert.equal(matches[0].gross,'-1100');assert.ok(!(await replacementCandidates(tx,{kind,date:'2026-10-20',businessNumber:'0012345678'})).some(c=>c.id===saved.cancellationId));
  await undoTradeCancellation(tx,form({cancellationId:saved.cancellationId,version:'0',requestId:randomUUID(),reason:'잘못 연결한 다른 달 정산 정정'}));assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:d.id}})).voidedAt,null);assert.ok(!(await readTaxPeriod(tx,COMPANY_ID,new Date('2026-10-01'),new Date('2026-11-01'))).rows.some(r=>r.id===saved.cancellationId));
  await tx.accountingPeriodLock.update({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-09'}},data:{locked:false}});
 }
}));
test('기간 정산은 수정월 마감·동일 월·부분 감액·기지급·미확인 원본·사업자 오류를 거부한다',async()=>rollbackTest(async tx=>{
 const x=await setup(tx,'PURCHASE');await assert.rejects(x.prepare(undefined,{laterCancellationConfirmed:''}),/확인/);
 await assert.rejects(registerLaterCancellation(tx,await x.prepare(await workbook('PURCHASE','2026-09-20'))),/이전 달/);
 await assert.rejects(registerLaterCancellation(tx,await x.prepare(await workbook('PURCHASE','2026-10-20','0012345678','-500','-50'))),/부분 감액/);
 await assert.rejects(registerLaterCancellation(tx,await x.prepare(await workbook('PURCHASE','2026-10-20','9999999999'))),/사업자/);
 await tx.tradeDocument.update({where:{id:x.doc.id},data:{settledAmount:'100'}});await assert.rejects(registerLaterCancellation(tx,await x.prepare()),/은행 지급/);await tx.tradeDocument.update({where:{id:x.doc.id},data:{settledAmount:0,proofConfirmed:false}});await assert.rejects(registerLaterCancellation(tx,await x.prepare()),/원본 확인/);await tx.tradeDocument.update({where:{id:x.doc.id},data:{proofConfirmed:true}});
 await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-10'}},create:{companyId:COMPANY_ID,period:'2026-10',packageId:'합성',digest:'합성',locked:true},update:{locked:true}});await assert.rejects(registerLaterCancellation(tx,await x.prepare()),/마감/);await tx.accountingPeriodLock.update({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-10'}},data:{locked:false}});
 const plan=await tx.cashPlan.create({data:{companyId:COMPANY_ID,title:'합성 기존 예정',plannedDate:new Date('2026-10-31'),plannedAmount:1100,direction:'OUT',category:'자재대금'}});await tx.tradeDocument.update({where:{id:x.doc.id},data:{cashPlanId:plan.id}});await assert.rejects(registerLaterCancellation(tx,await x.prepare()),/예산안/);assert.equal(await tx.tradeCancellation.count({where:{originalDocumentId:x.doc.id}}),0);
}));
test('다른 달 정산 동시 재시도는 원본·수정 증빙을 한 번만 반영한다',async()=>{
 const db=getDb();let base:Awaited<ReturnType<typeof setup>>|undefined,cancellationId='',fileId='';
 try{const prepared=await db.$transaction(async tx=>{const x=await setup(tx,'PURCHASE');return {x,source:await x.prepare()};});base=prepared.x;const source=prepared.source;const results=await Promise.all([db.$transaction(tx=>registerLaterCancellation(tx,source)),db.$transaction(tx=>registerLaterCancellation(tx,source))]);assert.equal(results[0].cancellationId,results[1].cancellationId);assert.equal(results.filter(r=>!r.replayed).length,1);cancellationId=results[0].cancellationId;const c=await db.tradeCancellation.findUniqueOrThrow({where:{id:cancellationId}});fileId=c.fileId;assert.equal(await db.tradeCancellationChange.count({where:{cancellationId,operation:LATER_CANCELLATION}}),1);
 }finally{if(base){const c=await db.tradeCancellation.findFirst({where:{originalDocumentId:base.doc.id}});if(c){cancellationId=c.id;fileId=c.fileId;await db.tradeCancellationChange.deleteMany({where:{cancellationId}});await db.tradeCancellation.delete({where:{id:cancellationId}});}await db.tradeDocumentChange.deleteMany({where:{documentId:base.doc.id}});await db.tradeDocument.delete({where:{id:base.doc.id}});if(fileId)await db.tradeWorkbookFile.delete({where:{id:fileId}});await db.partner.delete({where:{id:base.partner.id}});await db.project.delete({where:{id:base.project.id}});}await db.$disconnect();}
});

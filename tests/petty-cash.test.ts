import {loadMonthEndReview} from '../src/lib/month-end-review';
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '../src/generated/prisma/client';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
import {savePettyCash,voidPettyCash,pettyCashMonth,countPettyCash,pettyCashCountBasis,pettyCashCounts} from '../src/lib/petty-cash';
import {captureAccounting} from '../src/lib/accounting-delivery';
const form=(v:Record<string,string>={})=>{const d=new FormData();for(const[k,x]of Object.entries({requestId:randomUUID(),kind:'OPENING',entryDate:'2026-09-01',amount:'1000',title:'합성 시제',evidence:'합성 영수증',reason:'합성 현금 대조',confirmed:'on',...v}))d.set(k,x);return d;};
async function rollback(work:(tx:Prisma.TransactionClient)=>Promise<void>){const db=getDb(),stop=new Error('PETTY_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'합성 현금 회사'},update:{}});assert.equal(await tx.pettyCashEntry.count({where:{companyId:COMPANY_ID}}),0,'현금 검사는 비어 있는 개발 장부에서 실행');await work(tx);throw stop;},{timeout:60000}),e=>e===stop);}finally{await db.$disconnect();}}
test('현금 시제는 보충/반납과 비용을 분리하고 월 이월·중복 요청·원본 취소를 보존한다',async()=>rollback(async tx=>{
 const banks=await tx.bankTransaction.count(),trades=await tx.tradeDocument.count(),costs=await tx.projectCostEntry.count(),input=form(),first=await savePettyCash(tx,input);assert.equal(await savePettyCash(tx,input),first);
 await savePettyCash(tx,form({kind:'FUNDING',entryDate:'2026-09-02',amount:'500'}));const expense=await savePettyCash(tx,form({kind:'EXPENSE',entryDate:'2026-09-03',amount:'400'}));await savePettyCash(tx,form({kind:'RETURN',entryDate:'2026-10-01',amount:'100'}));
 assert.equal((await pettyCashMonth(tx,'2026-09')).balance,'1100');const october=await pettyCashMonth(tx,'2026-10');assert.equal(october.opening,'1100');assert.equal(october.balance,'1000');
 const undo=form({entryId:expense,reason:'합성 오입력 취소'});await voidPettyCash(tx,undo);await voidPettyCash(tx,undo);assert.equal((await pettyCashMonth(tx,'2026-09')).balance,'1500');assert.equal((await pettyCashMonth(tx,'2026-10')).balance,'1400');assert.equal((await pettyCashMonth(tx,'2026-09')).lines.find(r=>r.id===expense)?.voidReason,'합성 오입력 취소');assert.equal(await tx.bankTransaction.count(),banks);assert.equal(await tx.tradeDocument.count(),trades);assert.equal(await tx.projectCostEntry.count(),costs);
}));
test('현금 부족·후속일 부족·기초 중복·낡은 취소 요청과 타사 공사 연결을 차단한다',async()=>rollback(async tx=>{
 const opening=await savePettyCash(tx,form());await assert.rejects(savePettyCash(tx,form()),/기초 현금/);await assert.rejects(savePettyCash(tx,form({kind:'EXPENSE',amount:'1001'})),/잔액이 부족/);
 const funding=await savePettyCash(tx,form({kind:'FUNDING',entryDate:'2026-09-03',amount:'1000'}));await savePettyCash(tx,form({kind:'EXPENSE',entryDate:'2026-09-04',amount:'1800'}));await assert.rejects(savePettyCash(tx,form({kind:'EXPENSE',entryDate:'2026-09-02',amount:'300'})),/잔액이 부족/);await assert.rejects(voidPettyCash(tx,form({entryId:funding})),/잔액이 부족/);await assert.rejects(voidPettyCash(tx,form({entryId:opening})),/후속 현금/);
 await assert.rejects(savePettyCash(tx,form({kind:'RECEIPT',projectId:'unknown'})),/회사 공사/);await assert.rejects(savePettyCash(tx,form({kind:'RECEIPT',entryDate:'2026-08-31'})),/기초 현금일/);await assert.rejects(savePettyCash(tx,form({kind:'RECEIPT',entryDate:'2099-01-01'})),/실제 처리한/);await assert.rejects(savePettyCash(tx,form({kind:'RECEIPT',confirmed:''})),/실제 현금 이동/);assert.equal((await pettyCashMonth(tx,'2026-09')).balance,'200');
}));
test('현금 마감은 과거 수정·취소를 막고 다음달 현금 이동은 이전 전달본을 바꾸지 않는다',async()=>rollback(async tx=>{
 const id=await savePettyCash(tx,form()),before=await captureAccounting(tx,'2026-09');await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-09'}},create:{companyId:COMPANY_ID,period:'2026-09',packageId:'합성',digest:before.digest,locked:true},update:{locked:true}});await assert.rejects(voidPettyCash(tx,form({entryId:id})),/마감/);await assert.rejects(savePettyCash(tx,form({kind:'EXPENSE',amount:'1'})),/마감/);await savePettyCash(tx,form({kind:'EXPENSE',entryDate:'2026-10-01',amount:'100'}));assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);assert.equal((await pettyCashMonth(tx,'2026-10')).balance,'900');
}));
test('현금 원 단위 20자리 정밀도와 재사용 요청 내용·취소 회사 범위를 검증한다',async()=>rollback(async tx=>{
 const d=form({amount:'99999999999999999999'}),id=await savePettyCash(tx,d);d.set('amount','1');await assert.rejects(savePettyCash(tx,d),/다른 내용/);await assert.rejects(savePettyCash(tx,form({kind:'RECEIPT',amount:'1'})),/범위를 초과/);await savePettyCash(tx,form({kind:'EXPENSE',amount:'99999999999999999998'}));assert.equal((await pettyCashMonth(tx,'2026-09')).balance,'1');await assert.rejects(voidPettyCash(tx,form({entryId:'foreign'})),/변경되었거나/);assert.equal((await tx.pettyCashEntry.findUniqueOrThrow({where:{id}})).amount.toFixed(0),'99999999999999999999');
}));

test('현금 실사는 차이를 기록해도 잔액을 바꾸지 않고 장부 변경 후 재대조를 요구한다',async()=>rollback(async tx=>{
 await savePettyCash(tx,form());const basis=await pettyCashCountBasis(tx,'2026-09'),input=form({period:'2026-09',basis:basis.basis,counted:'900'});await countPettyCash(tx,input);await countPettyCash(tx,input);let checks=await pettyCashCounts(tx,'2026-09');assert.equal(checks.length,1);assert.equal(checks[0].difference,'-100');assert.equal(checks[0].current,true);assert.equal((await loadMonthEndReview(tx,COMPANY_ID,'2026-09')).checks.find(c=>c.key==='pettyCash')?.count,1);assert.equal((await pettyCashMonth(tx,'2026-09')).balance,'1000');await savePettyCash(tx,form({kind:'EXPENSE',amount:'100'}));checks=await pettyCashCounts(tx,'2026-09');assert.equal(checks[0].current,false);await assert.rejects(countPettyCash(tx,form({period:'2026-09',basis:basis.basis,counted:'900'})),/변경/);const now=await pettyCashCountBasis(tx,'2026-09');await countPettyCash(tx,form({period:'2026-09',basis:now.basis,counted:'900'}));assert.equal((await pettyCashCounts(tx,'2026-09')).filter(c=>c.current).length,1);assert.equal((await loadMonthEndReview(tx,COMPANY_ID,'2026-09')).checks.find(c=>c.key==='pettyCash')?.count,0);assert.equal((await pettyCashMonth(tx,'2026-09')).balance,'900');
}));

import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
import {tradeDependencies} from '../src/lib/trade-dependencies';
import {saveTradeDocument} from '../src/lib/trades';
import {connectTradeCashPlan} from '../src/lib/trade-cash';
import {saveSourceCosts,sourceCostBasis} from '../src/lib/source-costs';
import {saveVehicle} from '../src/lib/vehicles';
const form=(values:Record<string,string>)=>{const d=new FormData();for(const[k,v]of Object.entries({requestId:randomUUID(),reason:'합성 연결 현황 검증',...values}))d.set(k,v);return d;};
test('청구 연결 현황은 배부/본사/차량/예정/마감을 모으되 원가나 은행 실적을 변경하지 않는다',async()=>{
 const db=getDb(),rollback=new Error('DEPENDENCIES_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'합성 연결 회사'},update:{}});
 const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:'합성 공급처',type:'SUPPLIER'}}),project=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:'합성 배부 현장'}});
 const id=await saveTradeDocument(tx,form({version:'0',kind:'PURCHASE',reference:randomUUID(),title:'연결 현황 청구',partnerId:partner.id,companyExpense:'on',issuedDate:'2026-10-01',dueDate:'2026-10-31',supplyAmount:'1000',taxAmount:'100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',paymentMethod:'BANK_TRANSFER',proofConfirmed:'on',inputVatReview:'DEDUCTIBLE',profitCategory:'OTHER'}));
 await connectTradeCashPlan(tx,form({documentId:id,version:'0',mode:'NEW',noDuplicate:'on'}));
 const basis=await sourceCostBasis(tx,'TRADE',id),input=form({sourceType:'TRADE',sourceId:id,version:'0',basis:basis.basis,totalAmount:'1000',commonAmount:'300',incurredDate:'2026-10-01',confirmed:'on',noDuplicate:'on',allocationProjectId:project.id,allocationAmount:'700'});await saveSourceCosts(tx,'review',input);
 const vehicle=await saveVehicle(tx,'vehicle',form({plate:`확인${randomUUID().slice(0,8)}`,name:'연결 확인 차량',kind:'TRUCK',usage:'OFFICE',active:'on'}));
 await saveVehicle(tx,'expense',form({vehicleId:vehicle,reference:'CAR',category:'REPAIR',companyExpense:'on',incurredDate:'2026-10-01',amount:'1100',title:'합성 수리비',payer:'COMPANY',paymentStatus:'UNPAID',evidence:'합성 영수증'}));
 const expense=await tx.vehicleExpense.findUniqueOrThrow({where:{vehicleId_reference:{vehicleId:vehicle,reference:'CAR'}}});await saveVehicle(tx,'expenseLink',form({vehicleId:vehicle,expenseId:expense.id,version:'0',documentId:id,confirmed:'on'}));
 await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-10'}},create:{companyId:COMPANY_ID,period:'2026-10',packageId:'합성',digest:'합성',locked:true},update:{locked:true}});
 const before=await tx.tradeDocument.findUniqueOrThrow({where:{id}}),bankCount=await tx.bankTransaction.count(),changes=await tx.sourceCostChange.count();
 const rows=await tradeDependencies(tx,id);assert.equal(rows.find(r=>r.kind==='입금·지급 예정')?.amount,'1100');assert.equal(rows.find(r=>r.kind==='여러 공사 원가 배부')?.amount,'1000');assert.equal(rows.find(r=>r.kind==='현장별 배부')?.amount,'700');assert.equal(rows.find(r=>r.kind==='본사 공통 배부')?.amount,'300');assert.match(rows.find(r=>r.kind==='차량 비용')!.href,/expense=/);assert.equal(rows.find(r=>r.kind==='기간 마감')?.reference,'2026-10 마감');assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id}})).version,before.version);assert.equal(await tx.bankTransaction.count(),bankCount);assert.equal(await tx.sourceCostChange.count(),changes);
 await tx.sourceCostReview.update({where:{companyId_sourceType_sourceId:{companyId:COMPANY_ID,sourceType:'TRADE',sourceId:id}},data:{active:false}});const inactive=await tradeDependencies(tx,id);assert.equal(inactive.some(r=>r.kind==='현장별 배부'),false);assert.equal(inactive.find(r=>r.kind==='여러 공사 원가 배부')?.status,'배부 취소됨');
 throw rollback;
 },{timeout:60000}),e=>e===rollback);}finally{await db.$disconnect();}
});
test('다른 회사 청구와 존재하지 않는 원본의 연결 현황을 노출하지 않는다',async()=>{
 const db=getDb(),rollback=new Error('DEPENDENCIES_SCOPE');try{await assert.rejects(db.$transaction(async tx=>{
 const company=await tx.company.create({data:{name:'외부 합성 회사'}}),partner=await tx.partner.create({data:{companyId:company.id,code:randomUUID(),name:'외부 합성 거래처',type:'SUPPLIER'}}),document=await tx.tradeDocument.create({data:{companyId:company.id,partnerId:partner.id,kind:'PURCHASE',reference:randomUUID(),title:'외부 비공개',issuedDate:new Date('2026-10-01'),supplyAmount:'1',taxAmount:'0',grossAmount:'1',taxKind:'EXEMPT',evidence:'STATEMENT',note:'합성 외부 자료'}});
 await assert.rejects(tradeDependencies(tx,document.id),/회사 청구 원본/);await assert.rejects(tradeDependencies(tx,'unknown'),/회사 청구 원본/);throw rollback;
 }),e=>e===rollback);}finally{await db.$disconnect();}
});

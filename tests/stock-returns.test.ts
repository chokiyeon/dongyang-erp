import ExcelJS from 'exceljs';
import {prepareLaterReduction,registerTradeReduction,undoTradeReduction} from '../src/lib/trade-reductions';
import {preparePaidReduction,registerPaidReduction} from '../src/lib/trade-paid-reductions';
import {linkTradeBank} from '../src/lib/trades';
import {captureAccounting} from '../src/lib/accounting-delivery';
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Prisma} from '../src/generated/prisma/client';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
import {saveStock,stockOverview} from '../src/lib/stock';
const form=(values:Record<string,string>)=>{const d=new FormData();for(const[k,v]of Object.entries({requestId:randomUUID(),reason:'공급처 반품 합성 검증',...values}))d.set(k,v);return d;};
async function rollback(work:(tx:Prisma.TransactionClient)=>Promise<void>){const db=getDb(),marker=new Error('SUPPLIER_RETURN_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'반품 검증 회사'},update:{}});await work(tx);throw marker;},{timeout:30000}),e=>e===marker);}finally{await db.$disconnect();}}
async function setup(tx:Prisma.TransactionClient){
 const item=(await saveStock(tx,'item',form({code:randomUUID().slice(0,20),name:'반품 검증 전선',unit:'EA',active:'on'}))).materialId!,location=(await saveStock(tx,'location',form({code:randomUUID().slice(0,20),name:'반품 검증 창고',kind:'WAREHOUSE',active:'on'}))).locationId!;
 await saveStock(tx,'move',form({materialId:item,reference:'IN-RETURN-TEST',movedDate:'2026-09-01',kind:'IN',toId:location,quantity:'10',unitPrice:'100',supplyAmount:'1000',sourceNote:'원 입고 거래명세서'}));const receipt=await tx.stockMovement.findFirstOrThrow({where:{materialId:item,kind:'IN'}});
 const request=async(extra:Record<string,string>={})=>form({receiptId:receipt.id,version:String((await tx.materialItem.findUniqueOrThrow({where:{id:item}})).version),reference:randomUUID(),movedDate:'2026-10-15',fromId:location,quantity:'2',supplyAmount:'200',returnConfirmed:'on',sourceNote:'공급처 반품 인수 확인',...extra});return{item,location,receipt,request};
}
test('공급처 반품은 원 입고 수량·금액과 연결해 실재고만 줄이고 재시도는 중복하지 않는다',async()=>rollback(async tx=>{
 const x=await setup(tx),request=await x.request();await saveStock(tx,'return',request);await saveStock(tx,'return',request);const row=await tx.stockMovement.findFirstOrThrow({where:{returnOfId:x.receipt.id}});assert.equal(row.kind,'RETURN');assert.equal(row.supplyAmount?.toFixed(0),'-200');assert.equal(row.quantity.toFixed(4),'2.0000');assert.equal((await stockOverview(tx)).balances.find(r=>r.item.id===x.item&&r.location.id===x.location)?.quantity,80000n);assert.equal(await tx.stockMovement.count({where:{returnOfId:x.receipt.id}}),1);
 await assert.rejects(saveStock(tx,'void',form({materialId:x.item,movementId:x.receipt.id})),/반품.*연결/);await saveStock(tx,'void',form({materialId:x.item,movementId:row.id}));assert.equal((await stockOverview(tx)).balances.find(r=>r.item.id===x.item&&r.location.id===x.location)?.quantity,100000n);assert.equal((await tx.stockMovement.findUniqueOrThrow({where:{id:x.receipt.id}})).supplyAmount?.toFixed(0),'1000');
}));
test('공급처 반품은 원 입고 한도·입고 전 날짜·현재 장소 재고·다른 회사 범위를 검증한다',async()=>rollback(async tx=>{
 const x=await setup(tx);await saveStock(tx,'return',await x.request());await assert.rejects(saveStock(tx,'return',await x.request({quantity:'9',supplyAmount:'800'})),/반품 가능/);await assert.rejects(saveStock(tx,'return',await x.request({quantity:'1',supplyAmount:'900'})),/반품 가능/);await assert.rejects(saveStock(tx,'return',await x.request({movedDate:'2026-08-31'})),/원 입고일/);
 const foreign=await tx.company.create({data:{name:'다른 반품 검증 회사'}}),other=await tx.stockLocation.create({data:{companyId:foreign.id,code:randomUUID().slice(0,20),name:'타사 장소',kind:'WAREHOUSE'}});await assert.rejects(saveStock(tx,'return',await x.request({fromId:other.id})),/회사 반품 출발/);
 await saveStock(tx,'move',form({materialId:x.item,reference:'OUT-BEFORE-RETURN',kind:'OUT',movedDate:'2026-10-16',fromId:x.location,quantity:'7',sourceNote:'현장 사용'}));await assert.rejects(saveStock(tx,'return',await x.request({movedDate:'2026-10-17',quantity:'2',supplyAmount:'200'})),/해당 시점 재고/);
}));
test('매입 미연결 입고와 반품을 나중에 계산서에 함께 연결하고 한도를 순액으로 검사한다',async()=>rollback(async tx=>{
 const x=await setup(tx);await saveStock(tx,'return',await x.request());const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID().slice(0,20),name:'반품 거래처',type:'SUPPLIER'}}),doc=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId:partner.id,kind:'PURCHASE',reference:randomUUID(),title:'반품 반영 순액 계산서',issuedDate:new Date('2026-10-20'),supplyAmount:'800',taxAmount:'80',grossAmount:'880',taxKind:'TAXABLE',evidence:'TAX_INVOICE',note:'합성 원본'}});
 await saveStock(tx,'link',form({materialId:x.item,movementId:x.receipt.id,version:String((await tx.materialItem.findUniqueOrThrow({where:{id:x.item}})).version),documentId:doc.id,linkConfirmed:'on'}));const rows=await tx.stockMovement.findMany({where:{materialId:x.item,voidedAt:null}});assert.ok(rows.every(r=>r.documentId===doc.id));assert.equal(rows.reduce((v,r)=>v+BigInt(r.supplyAmount?.toFixed(0)??'0'),0n),800n);
}));


async function creditWorkbook(approval:string){const b=new ExcelJS.Workbook(),s=b.addWorksheet('매 입'),h=Array(43).fill('');h[0]='작성일자';h[1]='승인번호';h[14]='합계금액';h[15]='공급가액';h[16]='세액';s.addRow(h);const r=Array(43).fill('');r[0]='2026-10-20';r[1]=approval;r[4]='0012345678';r[6]='반품 감액 검증 업체';r[14]='-220';r[15]='-200';r[16]='-20';r[18]='수정세금계산서';s.addRow(r);return new Uint8Array(await b.xlsx.writeBuffer());}
for(const valueOnly of [false,true])for(const paid of [false,true])test(`${paid?'기지급':'미정산'} 입고 ${valueOnly?'단가 감액':'반품'}을 감액증빙에 대조하고 마감한 과거 재고·장부는 보존한다`,async()=>rollback(async tx=>{
 const x=await setup(tx),partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:'반품 감액 검증 업체',type:'SUPPLIER',businessNumber:'0012345678'}}),doc=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId:partner.id,kind:'PURCHASE',reference:randomUUID(),title:'원 입고의 원본 계산서',issuedDate:new Date('2026-09-01'),supplyAmount:'1000',taxAmount:'100',grossAmount:'1100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',taxApprovalNumber:randomUUID().replace(/-/g,'').toUpperCase(),proofConfirmed:true,companyExpense:true,note:'합성 반품 감액 원본'}});
 await saveStock(tx,'link',form({materialId:x.item,movementId:x.receipt.id,version:String((await tx.materialItem.findUniqueOrThrow({where:{id:x.item}})).version),documentId:doc.id,linkConfirmed:'on'}));
 if(paid){const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:'검증은행',label:randomUUID()}}),bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date('2026-09-10'),direction:'OUT',amount:'1100',description:'반품 전 원 지급'}});await linkTradeBank(tx,form({documentId:doc.id,version:'1',transactionId:bank.id,requestId:randomUUID(),amount:'1100',note:'원 지급 대조'}));}
 await saveStock(tx,'return',await x.request({movedDate:'2026-09-15',...(valueOnly?{kind:'VALUE_CREDIT',quantity:'0',fromId:''}:{})}));const returned=await tx.stockMovement.findFirstOrThrow({where:{returnOfId:x.receipt.id,voidedAt:null}}),before=await captureAccounting(tx,'2026-09'),current=await tx.tradeDocument.findUniqueOrThrow({where:{id:doc.id}}),bytes=await creditWorkbook(randomUUID().replace(/-/g,'').toUpperCase());
 await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-09'}},create:{companyId:COMPANY_ID,period:'2026-09',packageId:'합성',digest:'합성',locked:true},update:{locked:true}});
 const input=(ids:string[])=>form({requestId:randomUUID(),sheet:'매 입',sourceRow:'2',originalDocumentId:doc.id,version:String(current.version),laterReductionConfirmed:'on',paidReductionConfirmed:'on',stockReturnIds:JSON.stringify(ids),refundDueDate:'2026-11-20',reason:'공급처 인수와 감액 계산서 대조'});
 if(paid)await assert.rejects(registerPaidReduction(tx,await preparePaidReduction(input([]),'감액.xlsx',bytes,'LATER')),/자재/);else await assert.rejects(registerTradeReduction(tx,await prepareLaterReduction(input([]),'감액.xlsx',bytes),'LATER'),/자재/);
 const saved=paid?await registerPaidReduction(tx,await preparePaidReduction(input([returned.id]),'감액.xlsx',bytes,'LATER')):await registerTradeReduction(tx,await prepareLaterReduction(input([returned.id]),'감액.xlsx',bytes),'LATER');
 assert.equal((await tx.stockMovement.findUniqueOrThrow({where:{id:returned.id}})).reductionId,saved.reductionId);assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:doc.id}})).grossAmount.toFixed(0),'880');assert.equal((await stockOverview(tx)).balances.find(r=>r.item.id===x.item&&r.location.id===x.location)?.quantity,valueOnly?100000n:80000n);assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);
 await assert.rejects(saveStock(tx,'void',form({materialId:x.item,movementId:returned.id})),/감액증빙/);await assert.rejects(saveStock(tx,'link',form({materialId:x.item,movementId:x.receipt.id,version:String((await tx.materialItem.findUniqueOrThrow({where:{id:x.item}})).version),documentId:'',linkConfirmed:'on'})),/감액증빙/);
 const october=await captureAccounting(tx,'2026-10'),table=october.snapshot.tables.find(t=>t.title==='부분 감액 수정증빙')!;assert.equal(table.headers.at(-1),'대조한 공급처 반품');assert.ok(table.rows.some(row=>row[0]===saved.reductionId&&row.at(-1)===JSON.stringify([returned.id])));
 await undoTradeReduction(tx,form({reductionId:saved.reductionId,version:'0',requestId:randomUUID(),reason:'잘못 연결한 감액증빙 입력 정정'}));assert.equal((await tx.stockMovement.findUniqueOrThrow({where:{id:returned.id}})).reductionId,null);assert.equal((await tx.stockMovement.findUniqueOrThrow({where:{id:returned.id}})).voidedAt,null);assert.equal((await stockOverview(tx)).balances.find(r=>r.item.id===x.item&&r.location.id===x.location)?.quantity,valueOnly?100000n:80000n);assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);
}));

test('입고 단가 감액은 실제 수량을 유지하고 공급가액 순액만 조정한다',async()=>rollback(async tx=>{
 const x=await setup(tx);await saveStock(tx,'return',await x.request({kind:'VALUE_CREDIT',quantity:'0',fromId:'',supplyAmount:'200'}));const adjustment=await tx.stockMovement.findFirstOrThrow({where:{returnOfId:x.receipt.id}});assert.equal(adjustment.kind,'VALUE_CREDIT');assert.equal(adjustment.quantity.toFixed(4),'0.0000');assert.equal(adjustment.fromId,null);assert.equal(adjustment.unitPrice,null);assert.equal(adjustment.supplyAmount?.toFixed(0),'-200');assert.equal((await stockOverview(tx)).balances.find(r=>r.item.id===x.item&&r.location.id===x.location)?.quantity,100000n);
 await assert.rejects(saveStock(tx,'return',await x.request({kind:'VALUE_CREDIT',quantity:'1',fromId:''})),/수량을 바꾸지/);await assert.rejects(saveStock(tx,'return',await x.request({kind:'VALUE_CREDIT',quantity:'0',fromId:'',supplyAmount:'900'})),/공급가액.*초과/);
 await saveStock(tx,'void',form({materialId:x.item,movementId:adjustment.id}));assert.equal((await stockOverview(tx)).balances.find(r=>r.item.id===x.item&&r.location.id===x.location)?.quantity,100000n);
}));

test('동시 공급처 반품은 원 입고 수량과 현재 재고를 넘지 않고 재시도도 중복하지 않는다',async()=>{
 const db=getDb();let item='',location='',receiptId='',createdCompany=false;
 try{
 if(!await db.company.findUnique({where:{id:COMPANY_ID}})){await db.company.create({data:{id:COMPANY_ID,name:'동시 반품 검증 회사'}});createdCompany=true;}
 item=(await db.materialItem.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:'동시 반품 검증 자재',unit:'EA'}})).id;location=(await db.stockLocation.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:'동시 반품 검증 창고',kind:'WAREHOUSE'}})).id;receiptId=(await db.stockMovement.create({data:{materialId:item,reference:randomUUID(),kind:'IN',movedDate:new Date('2026-10-01'),toId:location,quantity:'10',unitPrice:'100',supplyAmount:'1000',sourceNote:'동시 반품 원 입고'}})).id;
 const inputs=['A','B'].map(tag=>form({receiptId,version:'0',reference:`RETURN-${tag}`,movedDate:'2026-10-02',fromId:location,quantity:'6',supplyAmount:'600',returnConfirmed:'on',sourceNote:'동시 공급처 인수 확인'}));
 const results=await Promise.allSettled(inputs.map(input=>db.$transaction(tx=>saveStock(tx,'return',input))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await db.stockMovement.count({where:{returnOfId:receiptId,voidedAt:null}}),1);assert.equal((await stockOverview(db)).balances.find(r=>r.item.id===item&&r.location.id===location)?.quantity,40000n);await db.$transaction(tx=>saveStock(tx,'return',inputs[results.findIndex(r=>r.status==='fulfilled')]));assert.equal(await db.stockMovement.count({where:{returnOfId:receiptId}}),1);
 }finally{if(item){await db.stockChange.deleteMany({where:{materialId:item}});await db.stockMovement.deleteMany({where:{materialId:item,returnOfId:{not:null}}});await db.stockMovement.deleteMany({where:{materialId:item}});await db.materialItem.delete({where:{id:item}});}if(location)await db.stockLocation.delete({where:{id:location}});if(createdCompany)await db.company.delete({where:{id:COMPANY_ID}});await db.$disconnect();}
});

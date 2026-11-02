import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {stockQuantity,stockDisplay,stockBalances} from "../src/lib/stock-types";
import {saveStock,stockOverview} from "../src/lib/stock";
import {voidTradeDocument} from "../src/lib/trades";
const request=(values:Record<string,string>)=>{const f=new FormData();Object.entries({requestId:randomUUID(),reason:"재고 합성 검증",...values}).forEach(([k,v])=>f.set(k,v));return f;};
test("소수 수량과 과거 재고 부족을 정밀하게 검증한다",()=>{
 assert.equal(stockQuantity("1234567890123456.1234"),12345678901234561234n);assert.equal(stockDisplay(10001n),"1.0001");for(const s of["-1","1e2","01","0.00001"])assert.throws(()=>stockQuantity(s));const rows=[{id:"in",sequence:1,movedDate:new Date("2026-10-02"),fromId:null,toId:"a",quantity:{toFixed:()=>"10"}},{id:"out",sequence:2,movedDate:new Date("2026-10-01"),fromId:"a",toId:null,quantity:{toFixed:()=>"1"}}];assert.throws(()=>stockBalances(rows),/해당 시점/);
});
test("품목 직납·창고·이동·사용·취소와 매입 한도·회사 범위·원본 보존을 검증한다",async()=>{
 const db=getDb();const rollback=new Error("rollback");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증 회사"},update:{}});const item=(await saveStock(tx,"item",request({code:randomUUID().slice(0,20),name:"합성 전선",unit:"m",active:"on"}))).materialId!;const project=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"재고 검증 현장"}});const warehouse=(await saveStock(tx,"location",request({code:randomUUID().slice(0,20),name:"창고",kind:"WAREHOUSE",active:"on"}))).locationId!;const site=(await saveStock(tx,"location",request({code:randomUUID().slice(0,20),name:"현장",kind:"SITE",projectId:project.id,active:"on"}))).locationId!;
 const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"합성 자재업체",type:"SUPPLIER"}});const document=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,kind:"PURCHASE",reference:randomUUID(),title:"합성 전선 매입",partnerId:partner.id,issuedDate:new Date("2026-10-01"),supplyAmount:"1000",taxAmount:"100",grossAmount:"1100",taxKind:"TAXABLE",evidence:"TAX_INVOICE",note:""}});
 const incoming=request({materialId:item,reference:"IN1",kind:"IN",movedDate:"2026-10-01",toId:warehouse,quantity:"10",unitPrice:"100",supplyAmount:"1000",documentId:document.id,sourceNote:"검증 거래명세서"});await saveStock(tx,"move",incoming);await saveStock(tx,"move",incoming);assert.equal(await tx.stockMovement.count({where:{materialId:item}}),1);
 await saveStock(tx,"move",request({materialId:item,reference:"MOVE1",kind:"TRANSFER",movedDate:"2026-10-02",fromId:warehouse,toId:site,quantity:"6",sourceNote:"현장 반출"}));await saveStock(tx,"move",request({materialId:item,reference:"USE1",kind:"OUT",movedDate:"2026-10-03",fromId:site,quantity:"2",sourceNote:"실제 사용"}));let overview=await stockOverview(tx);assert.equal(overview.balances.find(b=>b.item.id===item&&b.location.id===warehouse)?.quantity,40000n);assert.equal(overview.balances.find(b=>b.item.id===item&&b.location.id===site)?.quantity,40000n);
 await assert.rejects(saveStock(tx,"move",request({materialId:item,reference:"OVER",kind:"IN",movedDate:"2026-10-03",toId:site,quantity:"2",unitPrice:"100",supplyAmount:"200",documentId:document.id,sourceNote:"원본 초과 확인"})),/초과/);await assert.rejects(saveStock(tx,"move",request({materialId:item,reference:"EARLY",kind:"OUT",movedDate:"2026-09-30",fromId:warehouse,quantity:"1",sourceNote:"소급 출고"})),/해당 시점/);
 const receipt=await tx.stockMovement.findUniqueOrThrow({where:{materialId_reference:{materialId:item,reference:"IN1"}}});await assert.rejects(saveStock(tx,"void",request({materialId:item,movementId:receipt.id})),/해당 시점/);const currentDoc=await tx.tradeDocument.findUniqueOrThrow({where:{id:document.id}});await assert.rejects(voidTradeDocument(tx,request({documentId:document.id,version:String(currentDoc.version)})),/품목 입고/);
 const other=await tx.company.create({data:{name:"다른 검증 회사"}});const foreign=await tx.stockLocation.create({data:{companyId:other.id,code:randomUUID(),name:"타사 창고",kind:"WAREHOUSE"}});await assert.rejects(saveStock(tx,"move",request({materialId:item,reference:"FOREIGN",kind:"TRANSFER",movedDate:"2026-10-04",fromId:warehouse,toId:foreign.id,quantity:"1",sourceNote:"범위"})),/회사 재고 장소/);
 const original=await tx.materialItem.findUniqueOrThrow({where:{id:item}});await assert.rejects(saveStock(tx,"item",request({materialId:item,version:String(original.version),code:original.code,name:original.name,unit:"EA",active:"on"})),/관리 단위/);
 for(const ref of["USE1","MOVE1","IN1"]){const m=await tx.stockMovement.findUniqueOrThrow({where:{materialId_reference:{materialId:item,reference:ref}}});await saveStock(tx,"void",request({materialId:item,movementId:m.id}));}overview=await stockOverview(tx);assert.ok(!overview.balances.some(b=>b.item.id===item&&b.quantity!==0n));assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:document.id}})).supplyAmount.toFixed(0),"1000");assert.equal(await tx.projectCostEntry.count({where:{projectId:project.id}}),0);throw rollback;
 },{timeout:20000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});
test("동시 출고는 재고를 초과하지 않는다",async()=>{
 const db=getDb();let item="";let location="";let companyCreated=false;try{if(!await db.company.findUnique({where:{id:COMPANY_ID}})){await db.company.create({data:{id:COMPANY_ID,name:"동시 재고 검증"}});companyCreated=true;}item=(await db.$transaction(tx=>saveStock(tx,"item",request({code:randomUUID().slice(0,20),name:"동시 검증 자재",unit:"EA",active:"on"})))).materialId!;location=(await db.$transaction(tx=>saveStock(tx,"location",request({code:randomUUID().slice(0,20),name:"동시 검증 창고",kind:"WAREHOUSE",active:"on"})))).locationId!;await db.$transaction(tx=>saveStock(tx,"move",request({materialId:item,reference:"OPEN",kind:"OPENING",movedDate:"2026-10-01",toId:location,quantity:"1",sourceNote:"기초 1개"})));const results=await Promise.allSettled(["A","B"].map(reference=>db.$transaction(tx=>saveStock(tx,"move",request({materialId:item,reference,kind:"OUT",movedDate:"2026-10-02",fromId:location,quantity:"1",sourceNote:"동시 출고"})))));assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal((await stockOverview(db)).balances.find(b=>b.item.id===item)?.quantity,0n);
 }finally{if(item){await db.stockChange.deleteMany({where:{materialId:item}});await db.stockMovement.deleteMany({where:{materialId:item}});await db.materialItem.delete({where:{id:item}});}if(location){await db.stockLocationChange.deleteMany({where:{locationId:location}});await db.stockLocation.delete({where:{id:location}});}if(companyCreated)await db.company.delete({where:{id:COMPANY_ID}});await db.$disconnect();}
});
test("먼저 받은 명세서 입고는 중복 재고 없이 계산서에 연결·정정·해제하고 한도와 마감을 지킨다",async()=>{
 const db=getDb(),rollback=new Error("rollback");
 try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증 회사"},update:{}});
  const item=(await saveStock(tx,"item",request({code:randomUUID().slice(0,20),name:"사후 연결 자재",unit:"EA",active:"on"}))).materialId!;
  const location=(await saveStock(tx,"location",request({code:randomUUID().slice(0,20),name:"사후 연결 창고",kind:"WAREHOUSE",active:"on"}))).locationId!;
  const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"계산서 검증 공급자",type:"SUPPLIER"}});
  const makeDoc=(supplyAmount:string)=>tx.tradeDocument.create({data:{companyId:COMPANY_ID,kind:"PURCHASE",reference:randomUUID(),title:"사후 계산서",partnerId:partner.id,issuedDate:new Date("2026-10-01"),supplyAmount,taxAmount:"0",grossAmount:supplyAmount,taxKind:"EXEMPT",evidence:"TAX_INVOICE",note:""}});
  const a=await makeDoc("1000"),b=await makeDoc("1000"),small=await makeDoc("999");
  await saveStock(tx,"move",request({materialId:item,reference:"LATE",kind:"IN",movedDate:"2026-10-01",toId:location,quantity:"10",unitPrice:"100",supplyAmount:"1000",sourceNote:"계산서 수령 전 명세서"}));
  const original=await tx.stockMovement.findUniqueOrThrow({where:{materialId_reference:{materialId:item,reference:"LATE"}}});
  const form=async(documentId:string)=>request({materialId:item,movementId:original.id,version:String((await tx.materialItem.findUniqueOrThrow({where:{id:item}})).version),documentId,linkConfirmed:"on"});
  const unchecked=await form(a.id);unchecked.delete("linkConfirmed");await assert.rejects(saveStock(tx,"link",unchecked),/원본과 확인/);
  const other=await tx.company.create({data:{name:"외부회사 연결 거부 검증"}});
  const foreignPartner=await tx.partner.create({data:{companyId:other.id,code:randomUUID(),name:"외부 공급자",type:"SUPPLIER"}});
  const foreign=await tx.tradeDocument.create({data:{companyId:other.id,kind:"PURCHASE",reference:randomUUID(),title:"외부 계산서",partnerId:foreignPartner.id,issuedDate:new Date("2026-10-01"),supplyAmount:"1000",taxAmount:"0",grossAmount:"1000",taxKind:"EXEMPT",evidence:"TAX_INVOICE",note:""}});
  await assert.rejects(saveStock(tx,"link",await form(foreign.id)),/회사 매입/);
  const link=await form(a.id);await saveStock(tx,"link",link);await saveStock(tx,"link",link);
  assert.equal(await tx.stockMovement.count({where:{materialId:item}}),1);
  await assert.rejects(saveStock(tx,"link",await form(small.id)),/초과/);
  // Expected InputError is caught within this test transaction; the production action rolls it back.
  const stale=await form(b.id);stale.set("version","0");await assert.rejects(saveStock(tx,"link",stale),/변경/);
  await saveStock(tx,"link",await form(b.id));
  assert.equal((await tx.stockMovement.findUniqueOrThrow({where:{id:original.id}})).documentId,b.id);
  await saveStock(tx,"link",await form(""));
  const current=await tx.stockMovement.findUniqueOrThrow({where:{id:original.id}});
  assert.equal(current.documentId,null);assert.equal(current.quantity.toFixed(4),original.quantity.toFixed(4));assert.equal(current.unitPrice?.toFixed(4),original.unitPrice?.toFixed(4));assert.equal(current.supplyAmount?.toFixed(0),"1000");assert.equal(current.movedDate.getTime(),original.movedDate.getTime());
  assert.equal((await stockOverview(tx)).balances.find(r=>r.item.id===item)?.quantity,100000n);
  assert.equal(await tx.stockChange.count({where:{materialId:item,operation:"link"}}),3);
  await tx.accountingPeriodLock.create({data:{companyId:COMPANY_ID,period:"2026-10",locked:true,packageId:"stock-test",digest:"stock-test"}});
  await assert.rejects(saveStock(tx,"link",await form(a.id)),/마감/);
  throw rollback;
 },{timeout:20000}),e=>e===rollback);}finally{await db.$disconnect();}
});

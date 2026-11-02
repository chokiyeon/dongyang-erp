import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {saveVehicle,vehicleOverview} from "../src/lib/vehicles";
const request=(v:Record<string,string>)=>{const f=new FormData();Object.entries({requestId:randomUUID(),reason:"합성 차량 검증",...v}).forEach(([k,v])=>f.set(k,v));return f;};
test("보유 차량 고정·공용 배정과 과태료·범칙금 부담·납부·기한 및 원본 보존을 검증한다",async()=>{
 const db=getDb();const rollback=new Error("rollback");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"차량 검증 회사"},update:{}});const values={plate:`검증 ${randomUUID().slice(0,8)}`,name:"합성 트럭",kind:"TRUCK",usage:"FIXED",active:"on",insuranceDue:"2026-10-01",inspectionDue:"2026-10-31"};const input=request(values);const id=await saveVehicle(tx,"vehicle",input);assert.equal(await saveVehicle(tx,"vehicle",input),id);const a=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"차량 A현장"}});const b=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"차량 B현장"}});
 const assignment=request({vehicleId:id,projectId:a.id,startDate:"2026-10-01",endDate:"2026-10-15",driver:"합성 운전자",note:"소장 사용 확인"});await saveVehicle(tx,"assignment",assignment);await saveVehicle(tx,"assignment",assignment);assert.equal(await tx.vehicleAssignment.count({where:{vehicleId:id}}),1);await assert.rejects(saveVehicle(tx,"assignment",request({vehicleId:id,projectId:b.id,startDate:"2026-10-15",note:"중복 기간 확인"})),/중복/);await saveVehicle(tx,"assignment",request({vehicleId:id,projectId:b.id,startDate:"2026-10-16",note:"현장 이동"}));
 let vehicle=await tx.vehicle.findUniqueOrThrow({where:{id}});await saveVehicle(tx,"vehicle",request({...values,vehicleId:id,version:String(vehicle.version),usage:"SHARED"}));await saveVehicle(tx,"assignment",request({vehicleId:id,projectId:a.id,startDate:"2026-10-16",endDate:"2026-10-20",note:"공용 사용 확인"}));assert.equal(await tx.vehicleAssignment.count({where:{vehicleId:id,voidedAt:null}}),3);
 const before=await tx.bankTransaction.count();const expense={vehicleId:id,reference:randomUUID(),category:"FINE",incurredDate:"2026-09-30",dueDate:"2026-10-10",amount:"40000",title:"합성 주정차 과태료",payer:"UNKNOWN",paymentStatus:"UNPAID",driver:"합성 운전자",authority:"검증 기관",evidence:"합성 고지서"};const bill=request(expense);await saveVehicle(tx,"expense",bill);await saveVehicle(tx,"expense",bill);let e=await tx.vehicleExpense.findUniqueOrThrow({where:{vehicleId_reference:{vehicleId:id,reference:expense.reference}}});const overview=await vehicleOverview(tx,"2026-10");assert.ok(overview.unpaid.some(r=>r.id===e.id));assert.ok(!overview.expenses.some(r=>r.id===e.id));assert.equal(e.projectId,null);assert.equal(e.payer,"UNKNOWN");
 await assert.rejects(saveVehicle(tx,"expense",request({...expense,expenseId:e.id,version:"0",paymentStatus:"PAID"})),/납부일/);await assert.rejects(saveVehicle(tx,"expense",request({...expense,expenseId:e.id,version:"0",paymentStatus:"PAID",paidDate:"2026-09-29"})),/발생일/);
 await saveVehicle(tx,"expense",request({...expense,expenseId:e.id,version:"0",paymentStatus:"PAID",paidDate:"2026-10-01",payer:"DRIVER"}));assert.ok(!(await vehicleOverview(tx,"2026-10")).unpaid.some(r=>r.id===e.id));await assert.rejects(saveVehicle(tx,"expense",request({...expense,expenseId:e.id,version:"0"})),/변경/);await saveVehicle(tx,"expenseVoid",request({vehicleId:id,expenseId:e.id,version:"1"}));e=await tx.vehicleExpense.findUniqueOrThrow({where:{id:e.id}});assert.ok(e.voidedAt);assert.equal(await tx.bankTransaction.count(),before);
 const other=await tx.company.create({data:{name:"다른 합성 회사"}});const foreign=await tx.project.create({data:{companyId:other.id,code:randomUUID(),name:"타사 현장"}});await assert.rejects(saveVehicle(tx,"assignment",request({vehicleId:id,projectId:foreign.id,startDate:"2026-10-01",note:"범위 검증"})),/회사 현장/);const record=await tx.vehicleAssignment.findFirstOrThrow({where:{vehicleId:id}});await saveVehicle(tx,"assignmentVoid",request({vehicleId:id,assignmentId:record.id,version:"0"}));assert.ok((await tx.vehicleAssignment.findUniqueOrThrow({where:{id:record.id}})).voidedAt);assert.ok(await tx.vehicleChange.count({where:{vehicleId:id}})>5);vehicle=await tx.vehicle.findUniqueOrThrow({where:{id}});assert.ok(vehicle.insuranceDue);throw rollback;
 },{timeout:20000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});
test("차량비 매입 연결은 지급 원본을 재사용하고 수기 원가 중복·금액 차이·취소 우회를 거부한다",async()=>{
 const db=getDb(),rollback=new Error("rollback");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증회사"},update:{}});
 const id=await saveVehicle(tx,"vehicle",request({plate:`시험${randomUUID().slice(0,8)}`,name:"매입 연결 트럭",kind:"TRUCK",usage:"SHARED",active:"on"}));
 const expense={vehicleId:id,reference:randomUUID(),category:"REPAIR",incurredDate:"2026-10-01",amount:"110000",title:"합성 수리",payer:"COMPANY",companyExpense:"on",paymentStatus:"UNPAID",evidence:"수리 원본 대조"};await saveVehicle(tx,"expense",request(expense));
 const e=await tx.vehicleExpense.findUniqueOrThrow({where:{vehicleId_reference:{vehicleId:id,reference:expense.reference}}});
 const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"합성 수리업체",type:"SUPPLIER"}});
 const doc=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,kind:"PURCHASE",reference:randomUUID(),title:"수리 세금계산서",partnerId:partner.id,companyExpense:true,supplyAmount:"100000",taxAmount:"10000",grossAmount:"110000",issuedDate:new Date("2026-10-01"),taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:true,note:""}});
 const link=async(documentId:string)=>request({vehicleId:id,expenseId:e.id,version:String((await tx.vehicleExpense.findUniqueOrThrow({where:{id:e.id}})).version),documentId,confirmed:"on"});
 const beforeBanks=await tx.bankTransaction.count(),beforeCash=await tx.cashPlan.count();
 const unchecked=await link(doc.id);unchecked.delete("confirmed");await assert.rejects(saveVehicle(tx,"expenseLink",unchecked),/확인/);
 await tx.tradeDocument.update({where:{id:doc.id},data:{grossAmount:"110001"}});await assert.rejects(saveVehicle(tx,"expenseLink",await link(doc.id)),/일치/);await tx.tradeDocument.update({where:{id:doc.id},data:{grossAmount:"110000"}});
 const review=await tx.sourceCostReview.create({data:{companyId:COMPANY_ID,sourceType:"VEHICLE",sourceId:e.id,totalAmount:"110000",commonAmount:"110000",basis:"synthetic",incurredDate:new Date("2026-10-01")}});await assert.rejects(saveVehicle(tx,"expenseLink",await link(doc.id)),/기존 배부/);await tx.sourceCostReview.update({where:{id:review.id},data:{active:false}});
 const input=await link(doc.id);await saveVehicle(tx,"expenseLink",input);await saveVehicle(tx,"expenseLink",input);
 assert.equal((await tx.vehicleExpense.findUniqueOrThrow({where:{id:e.id}})).documentId,doc.id);
 const {sourceCostBasis}=await import("../src/lib/source-costs");await assert.rejects(sourceCostBasis(tx,"VEHICLE",e.id),/중복 배부/);
 const {voidTradeDocument}=await import("../src/lib/trades");await assert.rejects(voidTradeDocument(tx,request({documentId:doc.id,version:String((await tx.tradeDocument.findUniqueOrThrow({where:{id:doc.id}})).version)})),/차량 비용/);
 await assert.rejects(saveVehicle(tx,"expenseVoid",request({vehicleId:id,expenseId:e.id,version:"1"})),/먼저 해제/);
 await assert.rejects(saveVehicle(tx,"expense",request({...expense,expenseId:e.id,version:"1",paymentStatus:"PAID",paidDate:"2026-10-02"})),/원본에서 확인/);
 const {vehiclePaymentLabel}=await import("../src/lib/vehicle-types");const overview=await vehicleOverview(tx,"2026-10");assert.equal(vehiclePaymentLabel(overview.expenses.find(v=>v.id===e.id)!),"매입 미지급");
 const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"검증은행",label:randomUUID()}});
 const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-02"),direction:"OUT",amount:"110000",description:"수리 지급 검증"}});
 const {linkTradeBank,unlinkTradeBank}=await import("../src/lib/trades");
 for(const value of["40000","70000"]){await linkTradeBank(tx,request({documentId:doc.id,transactionId:bank.id,version:String((await tx.tradeDocument.findUniqueOrThrow({where:{id:doc.id}})).version),amount:value,note:"차량 수리 분할 지급"}));const current=(await vehicleOverview(tx,"2026-10")).expenses.find(v=>v.id===e.id)!;assert.equal(vehiclePaymentLabel(current),value==="40000"?"매입 일부 지급 · 잔액 70,000원":"매입 은행 지급 완료");}
 const paidLink=await tx.tradeBankLink.findFirstOrThrow({where:{documentId:doc.id,amount:"70000"}});await unlinkTradeBank(tx,request({linkId:paidLink.id,version:String((await tx.tradeDocument.findUniqueOrThrow({where:{id:doc.id}})).version)}));assert.equal(vehiclePaymentLabel((await vehicleOverview(tx,"2026-10")).expenses.find(v=>v.id===e.id)!),"매입 일부 지급 · 잔액 70,000원");
 await saveVehicle(tx,"expenseLink",await link(""));assert.equal((await tx.vehicleExpense.findUniqueOrThrow({where:{id:e.id}})).documentId,null);
 assert.equal(await tx.bankTransaction.count(),beforeBanks+1);assert.equal((await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}})).amount.toFixed(0),"110000");assert.equal(await tx.cashPlan.count(),beforeCash);assert.equal((await tx.vehicleExpense.findUniqueOrThrow({where:{id:e.id}})).amount.toFixed(0),"110000");
 assert.equal(await tx.vehicleChange.count({where:{vehicleId:id,operation:"expenseLink"}}),2);
 throw rollback;
 },{timeout:20000}),err=>err===rollback);}finally{await db.$disconnect();}
});

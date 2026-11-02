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
test("고지서 은행 대조는 기존 분할 지급을 재사용하고 해제해도 실제 실적을 보존한다",async()=>{
 const db=getDb(),rollback=new Error("rollback");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"고지서 대조 회사"},update:{}});
 const vehicleId=await saveVehicle(tx,"vehicle",request({plate:`대조${randomUUID().slice(0,8)}`,name:"고지서 시험 차량",kind:"TRUCK",usage:"SHARED",active:"on"}));
 await saveVehicle(tx,"expense",request({vehicleId,reference:"NOTICE",category:"FINE",incurredDate:"2026-09-30",amount:"40000",title:"은행 대조 과태료",payer:"COMPANY",companyExpense:"on",paymentStatus:"UNPAID",evidence:"합성 고지서"}));
 await tx.accountingPeriodLock.create({data:{companyId:COMPANY_ID,period:"2026-09",packageId:"synthetic",digest:"synthetic",locked:true}});
 const expense=await tx.vehicleExpense.findUniqueOrThrow({where:{vehicleId_reference:{vehicleId,reference:"NOTICE"}}});
 const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"대조 은행",label:randomUUID()}});
 const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-02"),direction:"OUT",amount:"40000",bankBalance:"-12345",description:"과태료 원본 출금"}});
 const plan=await tx.cashPlan.create({data:{companyId:COMPANY_ID,direction:"OUT",certainty:"CONFIRMED",title:"기존 과태료 지급",category:"OTHER",plannedDate:new Date("2026-09-30"),plannedAmount:"40000"}});
 const {settleCashPlan,voidCashSettlement}=await import("../src/lib/cash");
 for(const [version,amount]of[["0","10000"],["1","30000"]])await settleCashPlan(tx,request({planId:plan.id,version,bankTransactionId:bank.id,amount,note:"기존 실제 지급"}));
 const original=await tx.cashSettlement.findMany({where:{planId:plan.id},orderBy:{id:"asc"}});
 const match=async(cashPlanId:string)=>request({vehicleId,expenseId:expense.id,version:String((await tx.vehicleExpense.findUniqueOrThrow({where:{id:expense.id}})).version),cashPlanId,confirmed:"on"});
 const input=await match(plan.id);await saveVehicle(tx,"expenseCash",input);await saveVehicle(tx,"expenseCash",input);
 const {vehiclePaymentLabel}=await import("../src/lib/vehicle-types");assert.equal(vehiclePaymentLabel((await vehicleOverview(tx,"2026-09")).expenses.find(e=>e.id===expense.id)!),"은행 출금 대조 완료");assert.ok(!(await vehicleOverview(tx,"2026-10")).unpaid.some(e=>e.id===expense.id));
 await assert.rejects(voidCashSettlement(tx,request({settlementId:original[0].id,version:"3"})),/대조를 먼저 해제/);
 const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"출금 중복 검증 공급자",type:"SUPPLIER"}});const document=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,kind:"PURCHASE",reference:randomUUID(),title:"중복 연결 차단",partnerId:partner.id,issuedDate:new Date("2026-10-01"),dueDate:new Date("2026-10-02"),supplyAmount:"40000",taxAmount:"0",grossAmount:"40000",taxKind:"EXEMPT",evidence:"STATEMENT",proofConfirmed:true,paymentMethod:"BANK_TRANSFER",note:"합성"}});
 const {linkTradeBank}=await import("../src/lib/trades");await assert.rejects(linkTradeBank(tx,request({documentId:document.id,transactionId:bank.id,version:"0",amount:"40000",note:"같은 출금 중복 시도"})),/차량 고지서/);
 const {connectTradeCashPlan}=await import("../src/lib/trade-cash");await assert.rejects(connectTradeCashPlan(tx,request({documentId:document.id,version:"0",mode:"EXISTING",cashPlanId:plan.id,noDuplicate:"on",existingPaidConfirmed:"on"})),/일반 예정/);
 const {assertBankNotVehicleMatched}=await import("../src/lib/vehicle-cash");await assert.rejects(assertBankNotVehicleMatched(tx,bank.id),/차량 고지서/);
 await assert.rejects(saveVehicle(tx,"expenseVoid",request({vehicleId,expenseId:expense.id,version:"1"})),/먼저 해제/);
 await saveVehicle(tx,"expenseCash",await match(""));assert.ok((await vehicleOverview(tx,"2026-10")).unpaid.some(e=>e.id===expense.id));
 const current=await tx.cashSettlement.findMany({where:{planId:plan.id},orderBy:{id:"asc"}});assert.deepEqual(current,original);
 const bankAfter=await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}});assert.equal(bankAfter.amount.toFixed(0),"40000");assert.equal(bankAfter.bankBalance?.toFixed(0),"-12345");assert.equal((await tx.vehicleExpense.findUniqueOrThrow({where:{id:expense.id}})).paymentStatus,"UNPAID");
 await assertBankNotVehicleMatched(tx,bank.id);assert.equal(await tx.cashPlan.count({where:{id:plan.id}}),1);
 const manual=await tx.cashPlan.create({data:{companyId:COMPANY_ID,direction:"OUT",certainty:"CONFIRMED",title:"수기 지급 대조 거부",category:"기타",plannedDate:new Date("2026-10-02"),plannedAmount:"40000",completedAt:new Date()}});await tx.cashSettlement.create({data:{planId:manual.id,amount:"40000",processedDate:new Date("2026-10-02"),requestId:randomUUID()}});await assert.rejects(saveVehicle(tx,"expenseCash",await match(manual.id)),/실제 은행 출금/);

 throw rollback;
 },{timeout:20000}),err=>err===rollback);}finally{await db.$disconnect();}
});
test("고지서에서 미반영 출금을 최초 반영해도 은행 금액을 바꾸거나 지급 실적을 중복하지 않는다",async()=>{
 const db=getDb(),rollback=new Error("rollback");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"출금 최초 반영"},update:{}});
 const vehicleId=await saveVehicle(tx,"vehicle",request({plate:`최초${randomUUID().slice(0,8)}`,name:"최초 반영 차량",kind:"SEDAN",usage:"OFFICE",active:"on"}));
 await saveVehicle(tx,"expense",request({vehicleId,reference:"DIRECT",category:"TAX",incurredDate:"2026-09-30",amount:"50000",title:"자동차세 고지서",payer:"COMPANY",companyExpense:"on",paymentStatus:"UNPAID",evidence:"합성 자동차세 고지"}));
 const expense=await tx.vehicleExpense.findUniqueOrThrow({where:{vehicleId_reference:{vehicleId,reference:"DIRECT"}}});
 await tx.accountingPeriodLock.create({data:{companyId:COMPANY_ID,period:"2026-09",locked:true,packageId:"synthetic",digest:"synthetic"}});
 const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"최초 반영 검증은행",label:randomUUID()}});const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-02"),direction:"OUT",amount:"50000",bankBalance:"99999999999999999999",description:"자동차세 실제 출금"}});
 const input=request({vehicleId,expenseId:expense.id,version:"0",bankTransactionId:bank.id,confirmed:"on",noDuplicate:"on"});const unchecked=new FormData();for(const[k,v]of input.entries())unchecked.set(k,v);unchecked.delete("noDuplicate");await assert.rejects(saveVehicle(tx,"expenseCash",unchecked),/중복되지/);
 await saveVehicle(tx,"expenseCash",input);await saveVehicle(tx,"expenseCash",input);
 const linked=await tx.vehicleExpense.findUniqueOrThrow({where:{id:expense.id},include:{cashPlan:{include:{settlements:true}}}});assert.ok(linked.cashPlan);assert.equal(linked.cashPlan.settlements.length,1);assert.equal(linked.cashPlan.settlements[0].bankTransactionId,bank.id);assert.equal(linked.cashPlan.settlements[0].amount.toFixed(0),"50000");
 const {cashSummary}=await import("../src/lib/cash");assert.equal(cashSummary(linked.cashPlan).actual,50000n);assert.equal(cashSummary(linked.cashPlan).remaining,0n);assert.ok(linked.cashPlan.completedAt);const {buildForecast}=await import("../src/lib/forecast");const forecast=buildForecast({baseDate:new Date("2026-09-30"),amount:{toFixed:()=>"100000"}},[linked.cashPlan],3);assert.equal(forecast.rows.reduce((sum,r)=>sum+r.actualOut,0n),50000n);assert.equal(forecast.rows.at(-1)?.confirmedBalance,50000n);assert.equal(linked.cashPlan.category,"세금");assert.equal(linked.cashPlan.plannedDate.toISOString().slice(0,10),"2026-10-02");
 const afterBank=await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}});assert.equal(afterBank.amount.toFixed(0),"50000");assert.equal(afterBank.bankBalance?.toFixed(0),"99999999999999999999");
 assert.equal(await tx.cashSettlement.count({where:{bankTransactionId:bank.id,voidedAt:null}}),1);assert.equal(await tx.vehicleChange.count({where:{vehicleId,operation:"expenseCash"}}),1);
 throw rollback;
 },{timeout:20000}),err=>err===rollback);}finally{await db.$disconnect();}
});

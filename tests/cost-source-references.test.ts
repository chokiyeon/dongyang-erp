import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {costSourceReferences,costSourceKey} from "../src/lib/cost-source-references";
import {captureAccounting} from "../src/lib/accounting-delivery";
test("원가 배부는 같은 회사의 원본 번호·귀속월을 연결하고 전달본의 당시 원본 설명을 보존한다",async()=>{
 const db=getDb(),rollback=new Error("rollback source references");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"원본 대조 검증회사"},update:{}});const other=await tx.company.create({data:{name:"원본 대조 타사"}});const identities:{sourceType:string;sourceId:string}[]=[];let originalId="",originalPayroll="",originalExpense="",reviewId="";
 for(const companyId of[COMPANY_ID,other.id]){
  const partner=await tx.partner.create({data:{companyId,code:randomUUID(),name:"합성 원본 공급자",type:"SUPPLIER"}});const trade=await tx.tradeDocument.create({data:{companyId,partnerId:partner.id,kind:"PURCHASE",reference:randomUUID(),title:"당시 자재 원본 설명",issuedDate:new Date("2026-10-01"),supplyAmount:"1000",taxAmount:"100",grossAmount:"1100",taxKind:"TAXABLE",evidence:"TAX_INVOICE",note:"합성 원본"}});
  const employee=await tx.employee.create({data:{companyId,code:"000123",name:"합성 귀속 직원",kind:"MONTHLY",startDate:new Date("2020-01-01")}});const plan=await tx.cashPlan.create({data:{companyId,direction:"OUT",certainty:"CONFIRMED",title:"이전 귀속 합성 급여",category:"직원급여",plannedDate:new Date("2020-01-31"),plannedAmount:"100"}});const payroll=await tx.payrollPayment.create({data:{employeeId:employee.id,period:"2020-01",netAmount:"100",dueDate:new Date("2020-01-31"),basis:"synthetic",snapshot:{},cashPlanId:plan.id}});
  const vehicle=await tx.vehicle.create({data:{companyId,plate:"REF123",name:"합성 원본 차량",kind:"TRUCK",usage:"SHARED"}});const expense=await tx.vehicleExpense.create({data:{vehicleId:vehicle.id,reference:"REF-EXP",category:"REPAIR",incurredDate:new Date("2026-10-01"),amount:"1000",title:"합성 수리 원본",payer:"COMPANY",paymentStatus:"UNPAID",evidence:"합성 증빙"}});
  identities.push({sourceType:"TRADE",sourceId:trade.id},{sourceType:"PAYROLL",sourceId:payroll.id},{sourceType:"VEHICLE",sourceId:expense.id});
  if(companyId===COMPANY_ID){originalId=trade.id;originalPayroll=payroll.id;originalExpense=expense.id;reviewId=(await tx.sourceCostReview.create({data:{companyId,sourceType:"TRADE",sourceId:trade.id,totalAmount:"1000",commonAmount:"1000",basis:"synthetic",incurredDate:new Date("2026-10-01")}})).id;}
 }
 const references=await costSourceReferences(tx,identities);assert.equal(references.size,3);assert.match(references.get(costSourceKey({sourceType:"PAYROLL",sourceId:originalPayroll}))!.reference,/2020-01.*000123/);assert.match(references.get(costSourceKey({sourceType:"VEHICLE",sourceId:originalExpense}))!.reference,/REF123.*REF-EXP/);assert.match(references.get(costSourceKey({sourceType:"VEHICLE",sourceId:originalExpense}))!.href,/period=2026-10/);
 const before=await captureAccounting(tx,"2026-10");const row=before.snapshot.tables.find(t=>t.title==="총원가 배부")!.rows.find(r=>r[0]===reviewId)!;assert.equal(row[2],originalId);assert.equal(row[4],"합성 원본 공급자 · 당시 자재 원본 설명");assert.equal(row[5],"2026-10-01");assert.equal(row[6],"1000");
 await tx.tradeDocument.update({where:{id:originalId},data:{title:"새 원본 설명"}});assert.notEqual((await captureAccounting(tx,"2026-10")).digest,before.digest);assert.equal(row[4],"합성 원본 공급자 · 당시 자재 원본 설명");
 await tx.tradeDocument.update({where:{id:originalId},data:{voidedAt:new Date()}});const after=await captureAccounting(tx,"2026-10");assert.equal(after.snapshot.tables.find(t=>t.title==="총원가 배부")!.rows.find(r=>r[0]===reviewId)!.at(-1),"원본 확인 필요");
 throw rollback;
 },{timeout:30000}),err=>err===rollback);}finally{await db.$disconnect();}
});

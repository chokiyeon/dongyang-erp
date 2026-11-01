import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {loadMonthEndReview} from "../src/lib/month-end-review";
test("월말 점검은 회사·기간·취소 및 실제 잔액을 구분하고 원본을 변경하지 않는다",async()=>{
 const db=getDb();const rollback=new Error("rollback monthly review");
 try{await assert.rejects(db.$transaction(async tx=>{
  const company=await tx.company.create({data:{id:randomUUID(),name:"월말 합성 회사"}});
  const other=await tx.company.create({data:{id:randomUUID(),name:"다른 합성 회사"}});
  for(const c of [company,other]){
   const account=await tx.bankAccount.create({data:{companyId:c.id,bankName:"검증은행",label:"검증통장"}});
   for(const [tradedDate,internalTransfer]of [["2026-10-31",false],["2026-10-15",true],["2026-11-01",false]] as const)await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date(tradedDate),description:"합성 입출금",direction:"OUT",amount:100,internalTransfer}});
   const partner=await tx.partner.create({data:{companyId:c.id,code:"TEST",name:"검증업체"}});
   for(const voidedAt of[null,new Date()])await tx.tradeDocument.create({data:{companyId:c.id,partnerId:partner.id,kind:"PURCHASE",reference:randomUUID(),title:"검증 자재",issuedDate:new Date("2026-10-31"),supplyAmount:100,taxAmount:10,grossAmount:110,taxKind:"TAXABLE",evidence:"TAX_INVOICE",note:"합성 증빙",voidedAt}});
   await tx.employee.create({data:{companyId:c.id,code:"OFFICE",name:"사무직 합성",kind:"MONTHLY",startDate:new Date("2026-09-01")}});
   await tx.employee.create({data:{companyId:c.id,code:"DAILY",name:"출역 없는 합성",kind:"DAILY",startDate:new Date("2026-09-01")}});
   await tx.employee.create({data:{companyId:c.id,code:"ENDED",name:"전월 퇴사 합성",kind:"MONTHLY",startDate:new Date("2026-09-01"),endDate:new Date("2026-09-30")}});
   const template=await tx.recurringPaymentTemplate.create({data:{companyId:c.id,partnerId:partner.id,reference:"RENT",title:"합성 월세",category:"RENT",startMonth:"2026-10"}});
   await tx.recurringPaymentTemplate.create({data:{companyId:c.id,partnerId:partner.id,reference:"FUTURE",title:"차월 월세",category:"RENT",startMonth:"2026-11"}});
   const plan=await tx.cashPlan.create({data:{companyId:c.id,title:"일부 정산 합성",category:"OTHER",direction:"OUT",plannedDate:new Date("2026-10-31"),plannedAmount:100}});
   await tx.cashSettlement.create({data:{planId:plan.id,amount:30,processedDate:new Date("2026-10-31"),note:"합성",requestId:randomUUID()}});
   await tx.cashSettlement.create({data:{planId:plan.id,amount:70,processedDate:new Date("2026-10-31"),note:"취소 합성",requestId:randomUUID(),voidedAt:new Date()}});
   await tx.cashPlan.create({data:{companyId:c.id,title:"다음 달 제외",category:"OTHER",direction:"OUT",plannedDate:new Date("2026-11-01"),plannedAmount:100}});
   const carry=await tx.cashPlan.create({data:{companyId:c.id,title:"전월 이월",category:"OTHER",direction:"IN",plannedDate:new Date("2026-09-30"),plannedAmount:100}});
   const before=await loadMonthEndReview(tx,c.id,"2026-10");const counts=Object.fromEntries(before.checks.map(r=>[r.key,r.count]));
   assert.equal(counts.bank,1);assert.equal(counts.proof,1);assert.equal(counts.vat,1);assert.equal(counts.project,1);assert.equal(counts.payroll,1);assert.equal(counts.recurringMissing,1);assert.equal(counts.recurring,0);assert.equal(counts.cash,2);
   assert.equal(before.latest,null);assert.equal(before.checks.find(c=>c.key==="proof")?.href,"/trades?from=2026-10-01&to=2026-10-31");assert.equal(before.checks.find(c=>c.key==="vat")?.href,"/tax-summary?month=2026-10&mode=MONTH");
   await tx.monthlyPayment.create({data:{templateId:template.id,period:"2026-10",title:"합성 월세",partnerId:partner.id,dueDate:new Date("2026-10-31")}});
   await tx.cashSettlement.create({data:{planId:plan.id,amount:70,processedDate:new Date("2026-10-31"),note:"잔액 정산 합성",requestId:randomUUID()}});
   await tx.cashPlan.update({where:{id:carry.id},data:{completedAt:new Date()}});
   const after=await loadMonthEndReview(tx,c.id,"2026-10");const updated=Object.fromEntries(after.checks.map(r=>[r.key,r.count]));assert.equal(updated.recurringMissing,0);assert.equal(updated.recurring,1);assert.equal(updated.cash,0);
  }
  await assert.rejects(loadMonthEndReview(tx,company.id,"2026-13"));
  assert.equal(await tx.bankTransaction.count({where:{account:{companyId:company.id}}}),3);
  throw rollback;
 },{timeout:30000}),e=>e===rollback);}finally{await db.$disconnect();}
});

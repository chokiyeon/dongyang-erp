import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {settleCashPlan,cashSummary} from "../src/lib/cash";
import {connectTradeCashPlan} from "../src/lib/trade-cash";
import {buildForecast} from "../src/lib/forecast";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries(v).forEach(([k,v])=>d.set(k,v));return d;};
test("여러 공사 수금 일정을 한 청구로 통합해도 은행 실적과 총 자금 전망을 중복하지 않는다",async()=>{
 const db=getDb(),rollback=new Error("consolidation rollback");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"합성 통합 회사"},update:{}});const project=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"합성 단계별 공사"}}),partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"합성 발주처",type:"CLIENT"}}),account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"검증은행",label:randomUUID()}});
  const sources=[];let originalRequest:FormData|undefined;let originalSettlementId="";
  for(const[stage,total,actual]of[["START","400","400"],["FINAL","700","300"]]as const){const p=await tx.cashPlan.create({data:{companyId:COMPANY_ID,projectId:project.id,milestone:stage,title:stage,category:"공사대금",direction:"IN",certainty:"CONFIRMED",plannedDate:new Date("2026-10-31"),plannedAmount:total}});const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-15"),direction:"IN",amount:actual,description:`합성 ${stage}`}});const request=form({planId:p.id,version:"0",bankTransactionId:bank.id,requestId:randomUUID(),amount:actual,note:"원래 수금 실적"});await settleCashPlan(tx,request);sources.push(await tx.cashPlan.findUniqueOrThrow({where:{id:p.id},include:{settlements:true}}));if(!originalRequest){originalRequest=request;originalSettlementId=sources[0].settlements[0].id;}}
  const baseline={baseDate:new Date("2026-09-30"),amount:{toFixed:()=>"0"}};const before=buildForecast(baseline,sources,3);assert.equal(before.rows.at(-1)?.allBalance,1100n);
  const doc=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,projectId:project.id,partnerId:partner.id,kind:"SALE",reference:randomUUID(),title:"준공 통합 청구",issuedDate:new Date("2026-10-20"),dueDate:new Date("2026-10-31"),supplyAmount:1000,taxAmount:100,grossAmount:1100,taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:true,note:"합성 통합"}});
  const payload=form({mode:"MERGE",documentId:doc.id,version:"0",requestId:randomUUID(),reason:"착수금과 잔금 합계 대조",noDuplicate:"on",existingPaidConfirmed:"on"});sources.forEach(p=>payload.append("mergePlanId",p.id));await connectTradeCashPlan(tx,payload);await connectTradeCashPlan(tx,payload);
  const linked=await tx.tradeDocument.findUniqueOrThrow({where:{id:doc.id}}),target=await tx.cashPlan.findUniqueOrThrow({where:{id:linked.cashPlanId!},include:{settlements:true}});assert.equal(linked.settledAmount.toFixed(0),"700");assert.equal(cashSummary(target).actual,700n);assert.equal(cashSummary(target).remaining,400n);assert.equal(target.settlements.length,2);
  const original=await tx.cashSettlement.findUniqueOrThrow({where:{id:originalSettlementId}});assert.equal(original.originPlanId,sources[0].id);assert.equal(original.requestId,String(originalRequest!.get("requestId")));assert.equal(original.amount.toFixed(0),"400");assert.equal(original.processedDate.toISOString().slice(0,10),"2026-10-15");await settleCashPlan(tx,originalRequest!);assert.equal(await tx.cashSettlement.count({where:{planId:target.id}}),2);
  const after=await tx.cashPlan.findMany({where:{id:{in:[target.id,...sources.map(p=>p.id)]}},include:{settlements:true}});assert.equal(buildForecast(baseline,after,3).rows.at(-1)?.allBalance,before.rows.at(-1)?.allBalance);for(const p of after.filter(p=>p.id!==target.id)){assert.equal(p.replacedById,target.id);assert.equal(cashSummary(p).remaining,0n);assert.equal(cashSummary(p).actual,0n);}assert.equal(await tx.bankTransaction.count({where:{accountId:account.id}}),2);assert.equal(await tx.financeChange.count({where:{entityId:target.id,operation:"cashSchedulesConsolidate"}}),1);
  throw rollback;
 },{timeout:30000}),e=>e===rollback);}finally{await db.$disconnect();}
});

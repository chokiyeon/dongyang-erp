import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {createProjectReceipt,amendCashSchedule} from "../src/lib/cash-schedule";
import {settleCashPlan,cashSummary} from "../src/lib/cash";
import {buildForecast} from "../src/lib/forecast";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries(v).forEach(([k,v])=>d.set(k,v));return d;};const input=(v:Record<string,string>)=>form({requestId:randomUUID(),reason:"합성 공사 수금 일정",...v});
test("공사 수금 단계는 예산안과 같은 예정을 사용하고 일부 실적을 보존해 날짜·금액을 정정한다",async()=>{
 const db=getDb(),rollback=new Error("receipt rollback");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"합성 수금 회사"},update:{}});const project=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"합성 공사"}});
  const receipt=input({projectId:project.id,milestone:"START",title:"착수금 합성",plannedDate:"2026-10-15",plannedAmount:"1000",certainty:"CONFIRMED",confirmed:"on"});const id=await createProjectReceipt(tx,receipt);assert.equal(await createProjectReceipt(tx,receipt),id);let plan=await tx.cashPlan.findUniqueOrThrow({where:{id}});assert.equal(plan.projectId,project.id);assert.equal(plan.direction,"IN");assert.equal(plan.milestone,"START");
  await settleCashPlan(tx,input({planId:id,version:"0",processedDate:"2026-10-10",amount:"400",note:"합성 일부 수금"}));plan=await tx.cashPlan.findUniqueOrThrow({where:{id}});
  const change={planId:id,version:String(plan.version),title:"착수금 일정 정정",plannedDate:"2026-11-30",plannedAmount:"1200",certainty:"ESTIMATED",confirmed:"on"};await assert.rejects(amendCashSchedule(tx,input({...change,plannedAmount:"399"})),/실제 금액 이상/);const posted=input(change);await amendCashSchedule(tx,posted);await amendCashSchedule(tx,posted);
  const revised=await tx.cashPlan.findUniqueOrThrow({where:{id},include:{settlements:true}});assert.equal(cashSummary(revised).actual,400n);assert.equal(cashSummary(revised).remaining,800n);assert.equal(revised.settlements.length,1);assert.equal(revised.settlements[0].amount.toFixed(0),"400");assert.equal(revised.plannedDate.toISOString().slice(0,10),"2026-11-30");const forecast=buildForecast({baseDate:new Date("2026-09-30"),amount:{toFixed:()=>"0"}},[revised],3);assert.equal(forecast.rows.at(-1)?.confirmedBalance,400n);assert.equal(forecast.rows.at(-1)?.allBalance,1200n);
  const other=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"다른 공사"}});await assert.rejects(amendCashSchedule(tx,input({...change,version:String(revised.version),projectId:other.id})),/현장/);
  await amendCashSchedule(tx,input({...change,version:String(revised.version),plannedAmount:"400"}));assert.ok((await tx.cashPlan.findUniqueOrThrow({where:{id}})).completedAt);
  assert.equal(await tx.financeChange.count({where:{entityId:id}}),3);throw rollback;
 },{timeout:30000}),e=>e===rollback);}finally{await db.$disconnect();}
});

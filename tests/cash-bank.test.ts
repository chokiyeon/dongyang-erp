import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { createCashPlan, settleCashPlan, voidCashSettlement, cashSummary } from "../src/lib/cash";
import { buildForecast } from "../src/lib/forecast";
import { reclassifyBankTransaction } from "../src/lib/ledger";
const form=(values:Record<string,string>)=>{const f=new FormData();Object.entries(values).forEach(([k,v])=>f.set(k,v));return f;};
test("은행 실적은 거래일로 반영하고 초과 연결을 차단하며 취소 후 예정·전망을 복원한다",async()=>{
  const db=getDb();const rollback=new Error("ROLLBACK");
  try{await assert.rejects(db.$transaction(async tx=>{
    await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증 회사"},update:{}});
    const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"하나은행",label:randomUUID()}});
    const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-15"),direction:"OUT",amount:"600",bankBalance:"9000",description:"예정 연결 검증"}});
    const input={direction:"OUT",certainty:"CONFIRMED",title:"은행 실적 검증",category:"자재대금",plannedDate:"2026-10-20",plannedAmount:"1000",requestId:randomUUID()};
    await createCashPlan(tx,form(input));let plan=await tx.cashPlan.findUniqueOrThrow({where:{requestId:input.requestId},include:{settlements:true}});
    const data=form({planId:plan.id,version:"0",bankTransactionId:bank.id,amount:"600",note:"은행 연결 검증",requestId:randomUUID(),processedDate:"1900-01-01"});
    await settleCashPlan(tx,data);await settleCashPlan(tx,data);plan=await tx.cashPlan.findUniqueOrThrow({where:{id:plan.id},include:{settlements:true}});
    assert.equal(plan.settlements.length,1);assert.equal(plan.settlements[0].processedDate.toISOString().slice(0,10),"2026-10-15");assert.equal(cashSummary(plan).remaining,400n);
    const code=await tx.accountingCode.findUniqueOrThrow({where:{code:"1010"}});await assert.rejects(reclassifyBankTransaction(tx,form({transactionId:bank.id,version:"0",accountingCodeId:code.id,businessType:"internal-transfer",reason:"검증"})),/실적을 먼저 취소/);
    const other={...input,requestId:randomUUID()};await createCashPlan(tx,form(other));const otherPlan=await tx.cashPlan.findUniqueOrThrow({where:{requestId:other.requestId}});
    await assert.rejects(settleCashPlan(tx,form({planId:otherPlan.id,version:"0",bankTransactionId:bank.id,amount:"1",note:"초과 검증",requestId:randomUUID()})),/은행 거래금액/);
    await settleCashPlan(tx,form({planId:plan.id,version:"1",processedDate:"2026-10-16",amount:"300",finish:"on",note:"감액 완료",requestId:randomUUID()}));
    plan=await tx.cashPlan.findUniqueOrThrow({where:{id:plan.id},include:{settlements:true}});assert.equal(cashSummary(plan).actual,900n);assert.equal(cashSummary(plan).remaining,0n);
    const first=plan.settlements.find(s=>s.bankTransactionId)!;const manual=plan.settlements.find(s=>!s.bankTransactionId)!;
    // Set distinct registration times in the fixture to prove reverse-order cancellation.
    await tx.cashSettlement.update({where:{id:first.id},data:{createdAt:new Date("2026-10-15")}});await tx.cashSettlement.update({where:{id:manual.id},data:{createdAt:new Date("2026-10-16")}});
    await assert.rejects(voidCashSettlement(tx,form({settlementId:first.id,version:"2",reason:"취소"})),/최근에 등록/);
    await voidCashSettlement(tx,form({settlementId:manual.id,version:"2",reason:"최종 처리 취소"}));
    plan=await tx.cashPlan.findUniqueOrThrow({where:{id:plan.id},include:{settlements:true}});assert.equal(plan.completedAt,null);assert.equal(cashSummary(plan).remaining,400n);
    const baseline={baseDate:new Date("2026-10-14"),amount:{toFixed:()=>"10000"}};
    assert.equal(buildForecast(baseline,[plan],3).rows.at(-1)?.confirmedBalance,9000n);
    const undo=form({settlementId:first.id,version:"3",reason:"은행 연결 취소"});await voidCashSettlement(tx,undo);await voidCashSettlement(tx,undo);await settleCashPlan(tx,data);
    plan=await tx.cashPlan.findUniqueOrThrow({where:{id:plan.id},include:{settlements:true}});assert.equal(cashSummary(plan).actual,0n);assert.equal(cashSummary(plan).remaining,1000n);assert.equal(plan.plannedAmount.toFixed(0),"1000");assert.equal(plan.settlements.length,2);
    const forecast=buildForecast(baseline,[plan],3);assert.equal(forecast.rows.reduce((sum,r)=>sum+r.actualOut,0n),0n);assert.equal(forecast.rows.at(-1)?.confirmedBalance,9000n);
    const original=await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}});assert.equal(original.amount.toFixed(0),"600");assert.equal(original.bankBalance?.toFixed(0),"9000");
    throw rollback;
  },{timeout:15000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});

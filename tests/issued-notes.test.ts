import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { issuedNoteMaturity } from "../src/lib/issued-note-types";
import { createIssuedNote, voidIssuedNote } from "../src/lib/issued-notes";
import { settleCashPlan, voidCashSettlement, cashSummary } from "../src/lib/cash";
import { buildForecast } from "../src/lib/forecast";
const form=(values:Record<string,string>)=>{const f=new FormData();Object.entries(values).forEach(([k,v])=>f.set(k,v));return f;};
test("어음 3개월 만기는 월말·윤년·연도 경계에서 달력 날짜로 계산한다",()=>{
 assert.equal(issuedNoteMaturity("2026-01-31"),"2026-04-30");assert.equal(issuedNoteMaturity("2026-07-31"),"2026-10-31");assert.equal(issuedNoteMaturity("2023-11-30"),"2024-02-29");assert.equal(issuedNoteMaturity("2026-11-30"),"2027-02-28");assert.equal(issuedNoteMaturity("2026-12-31"),"2027-03-31");assert.throws(()=>issuedNoteMaturity("2026-02-30"));assert.throws(()=>issuedNoteMaturity("2199-12-31"));
});
test("발행어음은 예정 중복을 피하고 전액 은행 결제·실적 취소·등록 취소와 자금 전망을 함께 반영한다",async()=>{
 const db=getDb();const rollback=new Error("ROLLBACK");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증 회사"},update:{}});
  const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"어음 매입처",type:"SUPPLIER"}});
  const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"하나은행",label:randomUUID()}});const other=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"우리은행",label:randomUUID()}});
  const values={requestId:randomUUID(),reference:randomUUID(),partnerId:partner.id,accountId:account.id,issuedDate:"2026-07-31",amount:"100",scheduleMode:"NEW",scheduleConfirmed:"on",reason:"어음 발행 내역 확인"};
  const data=form(values);const id=await createIssuedNote(tx,data);assert.equal(await createIssuedNote(tx,data),id);assert.equal(await tx.issuedNote.count({where:{id}}),1);
  let note=await tx.issuedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.dueDate.toISOString().slice(0,10),"2026-10-31");assert.equal(note.cashPlan.plannedAmount.toFixed(0),"100");assert.equal(note.cashPlan.certainty,"CONFIRMED");
  const baseline={baseDate:new Date("2026-10-01"),amount:{toFixed:()=>"1000"}};assert.equal(buildForecast(baseline,[note.cashPlan],3).rows.at(-1)?.confirmedBalance,900n);
  const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-31"),direction:"OUT",amount:"100",bankBalance:"500",description:"어음 결제 검증"}});
  const wrong=await tx.bankTransaction.create({data:{accountId:other.id,tradedDate:new Date("2026-10-31"),direction:"OUT",amount:"100",description:"다른 계좌 검증"}});
  const pay=form({planId:note.cashPlanId,version:"0",requestId:randomUUID(),processedDate:"2026-10-31",amount:"100",note:"결제 확인"});await assert.rejects(settleCashPlan(tx,pay),/지정 결제 계좌/);
  pay.set("bankTransactionId",wrong.id);await assert.rejects(settleCashPlan(tx,pay),/지정 결제 계좌/);pay.set("bankTransactionId",bank.id);pay.set("amount","50");await assert.rejects(settleCashPlan(tx,pay),/전액/);pay.set("amount","100");await settleCashPlan(tx,pay);await settleCashPlan(tx,pay);
  note=await tx.issuedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.status,"SETTLED");assert.equal(cashSummary(note.cashPlan).remaining,0n);assert.equal(buildForecast(baseline,[note.cashPlan],3).rows.at(-1)?.confirmedBalance,900n);
  await assert.rejects(voidIssuedNote(tx,form({noteId:id,version:"1",requestId:randomUUID(),reason:"취소 시도"})),/미결제/);
  const undo=form({settlementId:note.cashPlan.settlements[0].id,version:"1",reason:"잘못 연결한 결제 실적 취소"});await voidCashSettlement(tx,undo);await voidCashSettlement(tx,undo);
  note=await tx.issuedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.status,"OPEN");assert.equal(note.settledDate,null);assert.equal(cashSummary(note.cashPlan).remaining,100n);
  const cancel=form({noteId:id,version:"2",requestId:randomUUID(),reason:"어음 등록 오류 확인"});await voidIssuedNote(tx,cancel);await voidIssuedNote(tx,cancel);
  note=await tx.issuedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.status,"VOID");assert.equal(cashSummary(note.cashPlan).actual,0n);assert.equal(buildForecast(baseline,[note.cashPlan],3).rows.at(-1)?.confirmedBalance,1000n);
  assert.equal((await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}})).bankBalance?.toFixed(0),"500");assert.equal(await tx.issuedNoteChange.count({where:{noteId:id}}),4);
  const existing=await tx.cashPlan.create({data:{companyId:COMPANY_ID,direction:"OUT",certainty:"ESTIMATED",title:"기존 어음결제 예정",category:"어음결제",plannedDate:new Date("2026-10-31"),plannedAmount:"200"}});
  const count=await tx.cashPlan.count({where:{companyId:COMPANY_ID}});const linked=await createIssuedNote(tx,form({...values,reference:randomUUID(),requestId:randomUUID(),amount:"200",scheduleMode:"EXISTING",cashPlanId:existing.id,planVersion:"0"}));assert.equal(await tx.cashPlan.count({where:{companyId:COMPANY_ID}}),count);assert.equal((await tx.issuedNote.findUniqueOrThrow({where:{id:linked}})).cashPlanId,existing.id);
  await assert.rejects(createIssuedNote(tx,form({...values,reference:randomUUID(),requestId:randomUUID(),amount:"200",scheduleMode:"EXISTING",cashPlanId:existing.id,planVersion:"1"})),/미처리/);
  await assert.rejects(createIssuedNote(tx,form({...values,reference:randomUUID(),requestId:randomUUID(),partnerId:"foreign-partner"})),/회사 결제 계좌/);
  const noConfirm=form({...values,reference:randomUUID(),requestId:randomUUID()});noConfirm.delete("scheduleConfirmed");await assert.rejects(createIssuedNote(tx,noConfirm),/확인/);
  throw rollback;
 },{timeout:15000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});

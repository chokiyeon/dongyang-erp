import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {discountedProceeds} from "../src/lib/received-note-types";
import {createReceivedNote,discountReceivedNote,changeReceivedNote} from "../src/lib/received-notes";
import {settleCashPlan,voidCashSettlement,cashSummary} from "../src/lib/cash";
import {buildForecast} from "../src/lib/forecast";
const form=(values:Record<string,string>)=>{const f=new FormData();Object.entries(values).forEach(([k,v])=>f.set(k,v));return f;};
test("할인 실입금액은 큰 금액의 정밀도를 보존하고 액면 이상 할인료를 거절한다",()=>{
 assert.equal(discountedProceeds("10000000","100000"),"9900000");assert.equal(discountedProceeds("99999999999999999999","1"),"99999999999999999998");assert.equal(discountedProceeds("1000","0"),"1000");assert.throws(()=>discountedProceeds("1000","1000"));assert.throws(()=>discountedProceeds("1000","-1"));
});
test("수취어음 할인은 실입금만 전망에 반영하고 만기 확인·취소·원본 복원을 보존한다",async()=>{
 const db=getDb();const rollback=new Error("ROLLBACK");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증 회사"},update:{}});
  const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"수취어음 거래처",type:"CLIENT"}});const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"하나은행",label:randomUUID()}});
  const values={requestId:randomUUID(),reference:randomUUID(),partnerId:partner.id,receivedDate:"2026-10-01",dueDate:"2026-10-31",amount:"1000",scheduleMode:"NEW",scheduleConfirmed:"on",reason:"수취어음 원본 확인"};const input=form(values);const id=await createReceivedNote(tx,input);assert.equal(await createReceivedNote(tx,input),id);
  let note=await tx.receivedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.cashPlan.certainty,"ESTIMATED");
  const baseline={baseDate:new Date("2026-10-01"),amount:{toFixed:()=>"0"}};let forecast=buildForecast(baseline,[note.cashPlan],3);assert.equal(forecast.rows.at(-1)?.confirmedBalance,0n);assert.equal(forecast.rows.at(-1)?.allBalance,1000n);
  const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-15"),direction:"IN",amount:"990",bankBalance:"2000",description:"수취어음 할인 실입금"}});
  const data=form({noteId:id,version:"0",requestId:randomUUID(),transactionId:bank.id,discountFee:"1000",reason:"할인 확인"});await assert.rejects(discountReceivedNote(tx,data),/액면금액/);data.set("discountFee","10");
  await discountReceivedNote(tx,data);await discountReceivedNote(tx,data);note=await tx.receivedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});
  assert.equal(note.status,"DISCOUNTED");assert.equal(note.discountFee?.toFixed(0),"10");assert.equal(note.netProceeds?.toFixed(0),"990");assert.equal(cashSummary(note.cashPlan).remaining,0n);forecast=buildForecast(baseline,[note.cashPlan],3);assert.equal(forecast.rows.at(-1)?.confirmedBalance,990n);assert.equal(forecast.rows.at(-1)?.allBalance,990n);assert.equal(forecast.rows.reduce((sum,r)=>sum+r.actualOut,0n),0n);
  const second=await createReceivedNote(tx,form({...values,reference:randomUUID(),requestId:randomUUID()}));await assert.rejects(discountReceivedNote(tx,form({noteId:second,version:"0",requestId:randomUUID(),transactionId:bank.id,discountFee:"10",reason:"중복 연결 차단"})),/연결 가능한/);
  const mature=form({noteId:id,version:"1",requestId:randomUUID(),reason:"은행 만기 확인"});await assert.rejects(changeReceivedNote(tx,mature,"mature"),/만기 도래/);mature.set("confirmed","on");await changeReceivedNote(tx,mature,"mature");
  const undoCash=form({settlementId:note.cashPlan.settlements[0].id,version:"1",reason:"할인 연결 취소"});await assert.rejects(voidCashSettlement(tx,undoCash),/먼저 만기 확인/);
  await changeReceivedNote(tx,form({noteId:id,version:"2",requestId:randomUUID(),reason:"만기 자료 재확인"}),"undoMaturity");await voidCashSettlement(tx,undoCash);await voidCashSettlement(tx,undoCash);await discountReceivedNote(tx,data);
  note=await tx.receivedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.status,"HELD");assert.equal(note.discountFee,null);assert.equal(note.netProceeds,null);assert.equal(cashSummary(note.cashPlan).remaining,1000n);assert.equal(cashSummary(note.cashPlan).actual,0n);assert.equal(buildForecast(baseline,[note.cashPlan],3).rows.at(-1)?.allBalance,1000n);
  await changeReceivedNote(tx,form({noteId:id,version:"4",requestId:randomUUID(),reason:"잘못 받은 어음 등록 취소"}),"void");note=await tx.receivedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.status,"VOID");assert.equal(buildForecast(baseline,[note.cashPlan],3).rows.at(-1)?.allBalance,0n);assert.equal(await tx.receivedNoteChange.count({where:{noteId:id}}),6);
  assert.equal((await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}})).amount.toFixed(0),"990");assert.equal((await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}})).bankBalance?.toFixed(0),"2000");
  await assert.rejects(createReceivedNote(tx,form({...values,requestId:randomUUID(),reference:randomUUID(),partnerId:"foreign-partner"})),/회사 발주/);
  throw rollback;
 },{timeout:15000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});
test("기존 공사대금 예정은 중복 생성 없이 연결하고 전액 추심·실적 취소를 반영한다",async()=>{
 const db=getDb();const rollback=new Error("ROLLBACK");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증 회사"},update:{}});const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"추심 거래처",type:"CLIENT"}});const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"우리은행",label:randomUUID()}});
  const plan=await tx.cashPlan.create({data:{companyId:COMPANY_ID,direction:"IN",certainty:"CONFIRMED",title:"기존 공사대금",category:"공사대금",plannedDate:new Date("2026-10-31"),plannedAmount:"1000"}});const count=await tx.cashPlan.count({where:{companyId:COMPANY_ID}});
  const values={requestId:randomUUID(),reference:randomUUID(),partnerId:partner.id,receivedDate:"2026-10-01",dueDate:"2026-10-31",amount:"1000",scheduleMode:"EXISTING",cashPlanId:plan.id,planVersion:"0",reason:"기존 입금 예정 연결"};const id=await createReceivedNote(tx,form(values));assert.equal(await tx.cashPlan.count({where:{companyId:COMPANY_ID}}),count);assert.equal((await tx.cashPlan.findUniqueOrThrow({where:{id:plan.id}})).certainty,"ESTIMATED");
  await assert.rejects(createReceivedNote(tx,form({...values,requestId:randomUUID(),reference:randomUUID(),planVersion:"1"})),/미처리/);
  const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-31"),direction:"IN",amount:"1000",description:"만기 전액 입금"}});const pay=form({planId:plan.id,version:"1",requestId:randomUUID(),bankTransactionId:bank.id,amount:"999",note:"추심 완료"});await assert.rejects(settleCashPlan(tx,pay),/액면금액 전액/);pay.set("amount","1000");await settleCashPlan(tx,pay);await settleCashPlan(tx,pay);
  let note=await tx.receivedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.status,"COLLECTED");assert.equal(note.discountFee?.toFixed(0),"0");assert.equal(note.netProceeds?.toFixed(0),"1000");
  await voidCashSettlement(tx,form({settlementId:note.cashPlan.settlements[0].id,version:"2",reason:"추심 연결 취소"}));note=await tx.receivedNote.findUniqueOrThrow({where:{id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(note.status,"HELD");assert.equal(cashSummary(note.cashPlan).remaining,1000n);throw rollback;
 },{timeout:15000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});

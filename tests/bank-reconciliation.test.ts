import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {reconcileBankBalance,bankReconciliationMonth,saveBankReconciliation,baselineFromReconciliation} from "../src/lib/bank-reconciliation";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries(v).forEach(([k,v])=>d.set(k,v));return d;};
test("통장 대조는 마이너스 잔액과 15자리 초과 금액을 정확히 계산한다",()=>{
 assert.deepEqual(reconcileBankBalance("100","-200",[{direction:"IN",amount:"200"},{direction:"OUT",amount:"500"}]),{incoming:200n,outgoing:500n,calculated:-200n,difference:0n});assert.equal(reconcileBankBalance("9999999999999999999","9999999999999999998",[{direction:"OUT",amount:"1"}]).difference,0n);assert.throws(()=>reconcileBankBalance("미확인","0",[]));
});
test("월말 차이·원본 변경·회사 범위·대출한도 제외와 예산안 기준 합산을 보호한다",async()=>{
 const db=getDb(),rollback=new Error("reconciliation rollback");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"합성 대조 회사"},update:{}});const period="2025-01";
  const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"검증은행",label:randomUUID(),overdraftLimit:200000000}});
  await tx.bankTransaction.createMany({data:[{accountId:account.id,tradedDate:new Date("2025-01-01"),direction:"IN",amount:200,description:"합성 입금",internalTransfer:true},{accountId:account.id,tradedDate:new Date("2025-01-31"),direction:"OUT",amount:500,description:"합성 출금"},{accountId:account.id,tradedDate:new Date("2025-02-01"),direction:"IN",amount:999,description:"다음 달 제외"}]});
  let month=await bankReconciliationMonth(tx,COMPANY_ID,period);let row=month.rows.find(row=>row.account.id===account.id)!;assert.equal(row.incoming,200n);assert.equal(row.outgoing,500n);
  const input={accountId:account.id,period,version:"0",basis:row.basis,openingBalance:"100",closingBalance:"-199",sourceReference:"합성 은행 원본 대조",requestId:randomUUID(),reason:"합성 대조"};
  await assert.rejects(saveBankReconciliation(tx,form({...input,confirmed:"on"})),/잔액이 다릅니다/);await saveBankReconciliation(tx,form(input));month=await bankReconciliationMonth(tx,COMPANY_ID,period);row=month.rows.find(r=>r.account.id===account.id)!;assert.equal(row.ready,false);assert.equal(row.calculation?.difference,1n);
  const confirmed=form({...input,requestId:randomUUID(),version:"0",closingBalance:"-200",confirmed:"on"});const id=await saveBankReconciliation(tx,confirmed);assert.equal(await saveBankReconciliation(tx,confirmed),id);
  month=await bankReconciliationMonth(tx,COMPANY_ID,period);for(const other of month.rows.filter(r=>r.account.id!==account.id)){const closing=reconcileBankBalance("0","0",other.account.transactions.map(t=>({direction:t.direction,amount:t.amount.toFixed(0)}))).calculated.toString();await saveBankReconciliation(tx,form({accountId:other.account.id,period,version:String(other.record?.version??0),basis:other.basis,openingBalance:"0",closingBalance:closing,sourceReference:"합성 테스트 원본",requestId:randomUUID(),reason:"합성 롤백 검증",confirmed:"on"}));}
  month=await bankReconciliationMonth(tx,COMPANY_ID,period);assert.ok(month.ready);const company=await tx.company.findUniqueOrThrow({where:{id:COMPANY_ID}});const payload=form({period,basis:month.basis,version:String(company.baselineVersion),requestId:randomUUID(),reason:"대출 한도 제외",confirmed:"on"});const baselineId=await baselineFromReconciliation(tx,payload);assert.equal(await baselineFromReconciliation(tx,payload),baselineId);const baseline=await tx.cashBaseline.findUniqueOrThrow({where:{id:baselineId}});assert.equal(baseline.amount.toFixed(0),month.closing.toString());assert.equal(baseline.reconciliationBasis,month.basis);
  await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2025-01-15"),direction:"IN",amount:1,description:"대조 후 추가"}});const changed=await bankReconciliationMonth(tx,COMPANY_ID,period);assert.equal(changed.ready,false);assert.notEqual(changed.basis,baseline.reconciliationBasis);assert.equal(changed.rows.find(r=>r.account.id===account.id)?.calculation?.difference,-1n);
  await assert.rejects(baselineFromReconciliation(tx,form({period,basis:month.basis,version:String(company.baselineVersion+1),requestId:randomUUID(),reason:"변경 후 차단",confirmed:"on"})),/모든 회사 통장/);
  const foreign=await tx.company.create({data:{id:randomUUID(),name:"다른 합성 회사"}});assert.equal((await bankReconciliationMonth(tx,foreign.id,period)).rows.length,0);
  throw rollback;
 },{timeout:30000}),e=>e===rollback);}finally{await db.$disconnect();}
});

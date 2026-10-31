import "dotenv/config";
import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {MONTHLY_PAY_FIELDS,calculateMonthlyPay,readMonthlyPayDetails} from "../src/lib/monthly-payroll-details";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {saveLabor} from "../src/lib/labor";
import {payrollBasis,savePayroll} from "../src/lib/payroll";
const amounts=()=>({...Object.fromEntries(MONTHLY_PAY_FIELDS.map(([key])=>[key,"0"])),basic:"3000000",meal:"200000",late:"10000",absence:"20000",incomeTax:"70000",localTax:"7000",pension:"140000",employment:"25000",health:"100000",care:"12000",advance:"50000",adjustment:"5000"});
const form=(values:Record<string,string>)=>{const d=new FormData();Object.entries({requestId:randomUUID(),reason:"합성 급여 세부 내역 검증",...values}).forEach(([key,value])=>d.set(key,value));return d;};
test("상용직 세부 내역은 근태공제·제세공제·연말정산 환급/추가공제를 중복 없이 계산한다",()=>{
 const r=calculateMonthlyPay(amounts());assert.equal(r.earnings,3200000n);assert.equal(r.gross,3170000n);assert.equal(r.deductions,404000n);assert.equal(r.net,2771000n);
 assert.equal(calculateMonthlyPay({...amounts(),adjustment:"-5000"}).net,2761000n);
 assert.throws(()=>calculateMonthlyPay({...amounts(),meal:""}),/식대보조/);assert.throws(()=>calculateMonthlyPay({...amounts(),basic:"1.5"}),/기본급/);assert.throws(()=>calculateMonthlyPay({...amounts(),advance:"999999999"}),/초과/);assert.throws(()=>calculateMonthlyPay({...amounts(),basic:"99999999999999999999"}),/20자리/);
 assert.equal(readMonthlyPayDetails({}),null);assert.deepEqual(readMonthlyPayDetails({monthlyDetails:r.details}),r.details);
 assert.equal(readMonthlyPayDetails({monthlyDetails:{version:1,amounts:{basic:"1"}}}),null);
});
test("상용직 세부 내역 저장은 지급액 대조·이력·중복 요청·생략 덮어쓰기 및 지급 후 변경을 보호한다",async()=>{
 const db=getDb();const rollback=new Error("ROLLBACK");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"세부 급여 검증 회사"},update:{}});
 const employeeId=await saveLabor(tx,"employee",form({code:randomUUID().slice(0,20),name:"합성 월급 직원",kind:"MONTHLY",startDate:"2026-01-01",active:"on"}));await saveLabor(tx,"rate",form({employeeId,effectiveDate:"2026-01-01",role:"NORMAL",amount:"3000000"}));
 const base=await payrollBasis(tx,"2026-10",employeeId);const values={employeeId,period:"2026-10",version:"0",basis:base.basis,netAmount:"2771000",dueDate:"2026-10-31",adjustmentReason:"계약액과 별도 확인한 수당·공제",confirmed:"on",noDuplicate:"on",useMonthlyDetails:"on",...Object.fromEntries(Object.entries(amounts()).map(([key,v])=>[`monthly_${key}`,v]))};
 await assert.rejects(savePayroll(tx,"confirm",form({...values,netAmount:"2771001"})),/다릅니다/);
 const input=form(values);const id=await savePayroll(tx,"confirm",input);assert.equal(await savePayroll(tx,"confirm",input),id);const saved=await tx.payrollPayment.findUniqueOrThrow({where:{id}});assert.equal(readMonthlyPayDetails(saved.snapshot)?.amounts.meal,"200000");assert.equal(saved.netAmount.toFixed(0),"2771000");
 const audit=await tx.laborChange.findUniqueOrThrow({where:{requestId:String(input.get("requestId"))}});assert.ok(JSON.stringify(audit.next).includes('monthlyDetails'));
 await assert.rejects(savePayroll(tx,"confirm",form({...values,useMonthlyDetails:"off"})),/생략/);
 await tx.cashSettlement.create({data:{planId:saved.cashPlanId,amount:"100",processedDate:new Date("2026-10-31"),requestId:randomUUID()}});
 await assert.rejects(savePayroll(tx,"confirm",form(values)),/지급 실적/);assert.equal((await tx.payrollPayment.findUniqueOrThrow({where:{id}})).netAmount.toFixed(0),"2771000");throw rollback;
 },{timeout:15000}),e=>e===rollback);}finally{await db.$disconnect();}
});

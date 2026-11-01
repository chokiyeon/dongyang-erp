import "dotenv/config";
import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {DAILY_DEDUCTIONS,dailyAttendanceSummary,dailyRateGroups,calculateDailyPay,readDailyPayDetails} from "../src/lib/daily-payroll-details";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {saveLabor} from "../src/lib/labor";
import {payrollBasis,savePayroll} from "../src/lib/payroll";
const zero=()=>Object.fromEntries(DAILY_DEDUCTIONS.map(([key])=>[key,"0"]));
const form=(v:Record<string,string>)=>{const f=new FormData();Object.entries({requestId:randomUUID(),reason:"합성 일용직 명세서 검증",...v}).forEach(([k,v])=>f.set(k,v));return f;};
test("일용직은 일당×일수에서 공제만 차감하고 일반·신호수와 소수 일수를 구분한다",()=>{
 const groups=[{key:"NORMAL:190000",role:"NORMAL",units:"20.00",grossRate:"200000"},{key:"SIGNAL:140000",role:"SIGNAL",units:"2.50",grossRate:"150000"}];const r=calculateDailyPay(groups,{...zero(),incomeTax:"100000"});assert.equal(r.gross,4375000n);assert.equal(r.deducted,100000n);assert.equal(r.net,4275000n);assert.deepEqual(readDailyPayDetails({dailyDetails:r.details}),r.details);
 assert.throws(()=>calculateDailyPay(groups,{...zero(),incomeTax:""}),/소득세/);assert.throws(()=>calculateDailyPay(groups,{...zero(),incomeTax:"99999999"}),/초과/);assert.throws(()=>calculateDailyPay([{...groups[0],units:"1.01",grossRate:"1"}],zero()),/원 미만/);
 assert.deepEqual(dailyAttendanceSummary([{date:"2026-10-01",units:"0.50"},{date:"2026-10-01",units:"0.50"},{date:"2026-10-02",units:"1.50"}]),{units:"2.50",days:2});
 assert.deepEqual(dailyRateGroups([{role:"NORMAL",rate:"190000",units:"0.5"},{role:"NORMAL",rate:"190000",units:"1.00"}]),[{key:"NORMAL:190000",role:"NORMAL",units:"1.50"}]);
});
test("공제 전 일용직 확인은 일수 원본·최종 지급액을 대조하고 기존 내역을 생략하지 못한다",async()=>{
 const db=getDb();const rollback=new Error("ROLLBACK");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"일용직 명세서 검증"},update:{}});const employeeId=await saveLabor(tx,"employee",form({code:randomUUID().slice(0,20),name:"합성 일용직",kind:"DAILY",startDate:"2026-01-01",active:"on"}));await saveLabor(tx,"rate",form({employeeId,effectiveDate:"2026-01-01",role:"NORMAL",amount:"195000"}));const project=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID().slice(0,20),name:"합성 현장"}});for(const day of[1,2])await saveLabor(tx,"work",form({employeeId,projectId:project.id,workedDate:`2026-10-0${day}`,role:"NORMAL",units:"1",source:"합성 출역"}));
 const base=await payrollBasis(tx,"2026-10",employeeId);const input={employeeId,period:"2026-10",version:"0",basis:base.basis,netAmount:"390000",dueDate:"2026-10-31",confirmed:"on",noDuplicate:"on",useDailyDetails:"on",dailyGrossConfirmed:"on",dailyGrossRate_0:"200000",...Object.fromEntries(DAILY_DEDUCTIONS.map(([key])=>[`dailyDeduction_${key}`,key==="incomeTax"?"10000":"0"]))};
 await assert.rejects(savePayroll(tx,"confirm",form({...input,netAmount:"390001",adjustmentReason:"불일치 검증"})),/다릅니다/);await assert.rejects(savePayroll(tx,"confirm",form({...input,dailyGrossConfirmed:"off"})),/확인/);
 const posted=form(input);const id=await savePayroll(tx,"confirm",posted);assert.equal(await savePayroll(tx,"confirm",posted),id);const saved=await tx.payrollPayment.findUniqueOrThrow({where:{id}});const detail=readDailyPayDetails(saved.snapshot)!;assert.equal(detail.groups[0].units,"2.00");assert.equal(calculateDailyPay(detail.groups,detail.deductions).net,390000n);await assert.rejects(savePayroll(tx,"confirm",form({...input,useDailyDetails:"off"})),/내역/);throw rollback;
 }),e=>e===rollback);}finally{await db.$disconnect();}
});

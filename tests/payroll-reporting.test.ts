import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {saveLabor} from "../src/lib/labor";
import {payrollBasis,savePayroll} from "../src/lib/payroll";
import {MONTHLY_PAY_FIELDS} from "../src/lib/monthly-payroll-details";
import {savePayrollReporting,reportingBasis,reportingGross,employerCostTotal,EMPLOYER_COST_FIELDS} from "../src/lib/payroll-reporting";
import {sourceCostBasis,saveSourceCosts} from "../src/lib/source-costs";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries(v).forEach(([k,v])=>d.set(k,v));return d;};
const request=(v:Record<string,string>)=>form({requestId:randomUUID(),reason:"신고·회사 부담 합성 검증",...v});
test("회사 부담분은 실지급액·신고액과 별개이며 누락 항목·범위·원 단위 초과를 검증한다",()=>{
 const values=Object.fromEntries(EMPLOYER_COST_FIELDS.map(([key])=>[key,"0"]));values.pension="100";values.health="50";assert.equal(employerCostTotal("3000",values).total,3150n);assert.throws(()=>employerCostTotal("3000",{...values,health:""}));assert.throws(()=>employerCostTotal("99999999999999999999",values));
});
test("신고자료는 실지급을 보존하고 원가를 재검토하며 급여 변경·중복 요청·직원 범위를 보호한다",async()=>{
 const db=getDb(),rollback=new Error("reporting rollback");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"신고 검증"},update:{}});
  const employeeId=await saveLabor(tx,"employee",request({code:randomUUID().slice(0,20),name:"합성 사무직",kind:"MONTHLY",startDate:"2026-09-01",active:"on"}));await saveLabor(tx,"rate",request({employeeId,role:"NORMAL",effectiveDate:"2026-09-01",amount:"3000"}));const base=await payrollBasis(tx,"2026-10",employeeId);
  const amounts=Object.fromEntries(MONTHLY_PAY_FIELDS.map(([key])=>[`monthly_${key}`,key==="basic"?"3000":"0"]));
  const payrollId=await savePayroll(tx,"confirm",request({employeeId,period:"2026-10",version:"0",basis:base.basis,netAmount:"3000",dueDate:"2026-10-31",adjustmentReason:"합성 수당·공제 확인",useMonthlyDetails:"on",confirmed:"on",noDuplicate:"on",...amounts}));
  let p=await tx.payrollPayment.findUniqueOrThrow({where:{id:payrollId}});assert.equal(reportingGross(p),"3000");const costs=Object.fromEntries(EMPLOYER_COST_FIELDS.map(([key])=>[key,key==="pension"?"100":key==="health"?"50":"0"]));
  const input={employeeId,period:"2026-10",basis:reportingBasis(p),version:"0",declaredWage:"2500",declaredDays:"20.5",sourceReference:"원본 보험 고지서·회계사무소 합성 대조",confirmed:"on",...costs};
  await assert.rejects(savePayrollReporting(tx,request({...input,declaredDays:"32"})),/신고 일수/);await assert.rejects(savePayrollReporting(tx,request({...input,industrial:""})),/산재보험/);await assert.rejects(savePayrollReporting(tx,request({...input,employeeId:randomUUID()})),/변경/);
  const posted=request(input);const id=await savePayrollReporting(tx,posted);assert.equal(await savePayrollReporting(tx,posted),id);assert.equal((await tx.payrollPayment.findUniqueOrThrow({where:{id:payrollId}})).netAmount.toFixed(0),"3000");
  let source=await sourceCostBasis(tx,"PAYROLL",payrollId);assert.equal(source.suggestedTotal,"3150");
  const reviewId=await saveSourceCosts(tx,"review",request({sourceType:"PAYROLL",sourceId:payrollId,basis:source.basis,version:"0",totalAmount:"3150",commonAmount:"3150",incurredDate:"2026-10-31",confirmed:"on",noDuplicate:"on"}));
  await savePayrollReporting(tx,request({...input,version:"0",pension:"200"}));assert.ok((await tx.sourceCostReview.findUniqueOrThrow({where:{id:reviewId}})).needsReview);source=await sourceCostBasis(tx,"PAYROLL",payrollId);assert.equal(source.suggestedTotal,"3250");
  await tx.payrollPayment.update({where:{id:payrollId},data:{version:{increment:1}}});p=await tx.payrollPayment.findUniqueOrThrow({where:{id:payrollId}});await assert.rejects(sourceCostBasis(tx,"PAYROLL",payrollId),/신고자료/);await assert.rejects(savePayrollReporting(tx,request({...input,version:"1"})),/급여 지급 확인이 변경/);
  await savePayrollReporting(tx,request({...input,basis:reportingBasis(p),version:"1"}));assert.equal((await tx.payrollReporting.findUniqueOrThrow({where:{id}})).declaredWage.toFixed(0),"2500");
  throw rollback;
 },{timeout:30000}),e=>e===rollback);}finally{await db.$disconnect();}
});

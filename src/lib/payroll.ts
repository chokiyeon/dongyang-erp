import {DAILY_DEDUCTIONS,dailyRateGroups,calculateDailyPay,readDailyPayDetails} from "./daily-payroll-details";
import {MONTHLY_PAY_FIELDS,calculateMonthlyPay,readMonthlyPayDetails} from "./monthly-payroll-details";
import {invalidateSourceCosts} from "./source-cost-invalidation";
import {createHash} from "node:crypto";
import type {Prisma,PrismaClient} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {laborMonth} from "./labor";
import {InputError,text,date,amount,revision} from "./validation";
import {cashSummary} from "./cash";
export async function payrollBasis(db:PrismaClient|Prisma.TransactionClient,period:string,employeeId:string,loadedMonth?:Awaited<ReturnType<typeof laborMonth>>){
 const month=loadedMonth??await laborMonth(db,period);const daily=month.daily.find(r=>r.employee.id===employeeId);const monthly=month.monthly.find(r=>r.employee.id===employeeId);const employee=daily?.employee??monthly?.employee;if(!employee)throw new InputError("급여월의 고용 기간에 해당하는 직원을 선택하세요.");
 const basisData={employee:{id:employee.id,kind:employee.kind,start:employee.startDate.toISOString(),end:employee.endDate?.toISOString()??null},period,lines:daily?.lines.map(r=>({id:r.id,version:r.version,date:r.workedDate.toISOString(),project:r.projectId,role:r.role,units:r.units.toFixed(2),rateId:r.rateId,rateAmount:r.rateAmount.toFixed(0),amount:r.amount.toFixed(0)}))??[],rates:employee.rates.map(r=>({id:r.id,version:r.version,date:r.effectiveDate.toISOString(),role:r.role,amount:r.amount.toFixed(0)}))};
 const basis=createHash("sha256").update(JSON.stringify(basisData)).digest("hex");return{employee,month,daily,monthly,basis,basisData,issues:daily?.issues??monthly?.issues??[]};
}
export async function savePayroll(tx:Prisma.TransactionClient,op:"confirm"|"void",d:FormData){
 const employeeId=text(d,"employeeId","직원",true,50);const period=text(d,"period","급여월",true,7);const requestId=text(d,"requestId","요청",true,50);const reason=text(d,"reason","급여 확인 사유",true,300);if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("화면을 다시 열어 주세요.");
 const fingerprint=createHash("sha256").update(JSON.stringify({op,values:Object.fromEntries([...d.entries()].sort(([a],[b])=>a.localeCompare(b)))})).digest("hex");const replay=await tx.laborChange.findUnique({where:{requestId},include:{employee:true}});if(replay){if(replay.employee.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용에 사용한 요청입니다.");return (replay.next as {id:string}).id;}
 const employee=await tx.employee.findFirst({where:{id:employeeId,companyId:COMPANY_ID}});if(!employee)throw new InputError("회사 직원을 선택하세요.");
 const old=await tx.payrollPayment.findUnique({where:{employeeId_period:{employeeId,period}},include:{cashPlan:{include:{settlements:true}}}});const version=revision(d);if((old?.version??0)!==version)throw new InputError("급여 지급 내용이 변경되었습니다. 다시 조회하세요.");
 if(old&&cashSummary(old.cashPlan).actual>0n)throw new InputError("이미 지급 실적이 있는 급여입니다. 은행·실적을 먼저 확인하고 필요하면 최근 지급부터 취소하세요.");
 if(op==="void"&&(!old||old.voidedAt))throw new InputError("취소할 급여 지급 예정을 선택하세요.");
 let values:{netAmount:string;dueDate:Date;basis:string;snapshot:Prisma.InputJsonValue;adjustmentReason:string|null}|undefined;
 if(op==="confirm"){
  const base=await payrollBasis(tx,period,employeeId);if(text(d,"basis","계산 기준",true,64)!==base.basis)throw new InputError("출역 또는 계약이 변경되었습니다. 급여 검토를 다시 열어 주세요.");
  if(base.daily&&(!base.daily.lines.length||base.daily.issues.some(i=>i.includes("계약 변경"))))throw new InputError("일용직 출역과 계약 변경을 먼저 정정·확인하세요.");if(base.monthly&&!base.monthly.rate)throw new InputError("월급제 계약 기준액을 먼저 등록하세요.");
  if(base.issues.length&&d.get("issuesConfirmed")!=="on")throw new InputError("공수 초과·월중 변동 등 검토사항을 확인하세요.");
  const netAmount=amount(text(d,"netAmount","최종 실지급액",true,20),"최종 실지급액")!;if(BigInt(netAmount)<=0n)throw new InputError("최종 실지급액은 0보다 커야 합니다.");const adjustmentReason=text(d,"adjustmentReason","지급액 조정·산정 근거",false,300)||null;
  if((base.monthly||BigInt(netAmount)!==base.daily?.amount)&&!adjustmentReason)throw new InputError("공제·수당 등 최종 실지급액 산정·조정 근거를 입력하세요.");
  const dueDate=date(text(d,"dueDate","급여 지급일",true),"급여 지급일")!;if(d.get("confirmed")!=="on"||d.get("noDuplicate")!=="on")throw new InputError("실지급액과 기존 급여 예정의 중복 여부를 확인하세요.");
  if(readMonthlyPayDetails(old?.snapshot)&&d.get("useMonthlyDetails")!=="on")throw new InputError("기존 수당·공제 세부 내역을 켜고 정정하세요. 내역을 생략해 덮어쓸 수 없습니다.");
  let snapshot:Prisma.InputJsonValue=base.basisData;
  if(d.get("useMonthlyDetails")==="on"){
   if(!base.monthly)throw new InputError("상용직 수당·공제 세부 계산은 월급제 지급 확인에서 사용하세요.");
   const calculation=calculateMonthlyPay(Object.fromEntries(MONTHLY_PAY_FIELDS.map(([key])=>[key,text(d,`monthly_${key}`,key,true,21)])));
   if(calculation.net!==BigInt(netAmount))throw new InputError("세부 내역의 계산 실수령액과 최종 실지급액이 다릅니다.");
   snapshot={...base.basisData,monthlyDetails:calculation.details};
  }
  if(readDailyPayDetails(old?.snapshot)&&d.get("useDailyDetails")!=="on")throw new InputError("기존 일용직 공제 전 일당·공제 내역을 켜고 정정하세요.");
  if(d.get("useDailyDetails")==="on"){
   if(!base.daily||d.get("dailyGrossConfirmed")!=="on")throw new InputError("일용직 공제 전 일당과 공제 내역을 확인하세요.");
   const groups=dailyRateGroups(base.daily.lines.map(row=>({role:row.role,units:row.units.toFixed(2),rate:row.rateAmount.toFixed(0)})));
   const calculation=calculateDailyPay(groups.map((row,index)=>({...row,grossRate:text(d,`dailyGrossRate_${index}`,"공제 전 일당",true,20)})),Object.fromEntries(DAILY_DEDUCTIONS.map(([key])=>[key,text(d,`dailyDeduction_${key}`,key,true,20)])));
   if(calculation.net!==BigInt(netAmount))throw new InputError("일당 × 일수 − 공제합계와 최종 실지급액이 다릅니다.");
   snapshot={...base.basisData,dailyDetails:calculation.details};
  }
  values={netAmount,dueDate,basis:base.basis,snapshot,adjustmentReason};
 }
 const locked=await tx.employee.updateMany({where:{id:employee.id,companyId:COMPANY_ID,version:employee.version},data:{version:{increment:1}}});if(locked.count!==1)throw new InputError("직원·계약·출역이 변경되었습니다. 다시 조회하세요.");
 if(old&&!old.cashPlan.completedAt){const closed=await tx.cashPlan.updateMany({where:{id:old.cashPlan.id,version:old.cashPlan.version,completedAt:null},data:{completedAt:new Date(),completionNote:reason,version:{increment:1}}});if(closed.count!==1)throw new InputError("기존 급여 예정이 변경되었습니다. 다시 조회하세요.");}
 let saved;
 if(op==="void")saved=await tx.payrollPayment.update({where:{id:old!.id},data:{voidedAt:new Date(),version:{increment:1}}});
 else{
  const plan=await tx.cashPlan.create({data:{companyId:COMPANY_ID,title:`급여 ${period} · ${employee.code} ${employee.name}`,category:employee.kind==="DAILY"?"현장노무비":"직원급여",direction:"OUT",certainty:"CONFIRMED",plannedDate:values!.dueDate,plannedAmount:values!.netAmount}});
  saved=old?await tx.payrollPayment.update({where:{id:old.id},data:{...values!,cashPlanId:plan.id,voidedAt:null,version:{increment:1}}}):await tx.payrollPayment.create({data:{...values!,employeeId,period,cashPlanId:plan.id}});
 }
 await invalidateSourceCosts(tx,"PAYROLL",[saved.id]);
 await tx.laborChange.create({data:{employeeId,requestId,fingerprint,operation:op==="confirm"?"payroll":"payrollVoid",previous:old?{id:old.id,netAmount:old.netAmount.toFixed(0),basis:old.basis,cashPlanId:old.cashPlanId,snapshot:old.snapshot}: {},next:{id:saved.id,netAmount:saved.netAmount.toFixed(0),basis:saved.basis,cashPlanId:saved.cashPlanId,voided:op==="void",snapshot:saved.snapshot},reason}});return saved.id;
}

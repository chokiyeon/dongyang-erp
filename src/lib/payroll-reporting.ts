import {createHash} from "node:crypto";
import type {Prisma} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError,text,revision} from "./validation";
import {paymentMonth} from "./payment-terms";
import {statementBasis} from "./payroll-statement";
import {readDailyPayDetails,calculateDailyPay,dailyRateGroups} from "./daily-payroll-details";
import {payrollBasis} from "./payroll";
import {invalidateSourceCosts} from "./source-cost-invalidation";
export const EMPLOYER_COST_FIELDS=[["pension","회사 부담 국민연금"],["health","회사 부담 건강보험"],["care","회사 부담 요양보험"],["employment","회사 부담 고용보험"],["industrial","회사 부담 산재보험"],["retirement","퇴직급여 원가"],["other","기타 회사 부담 원가"]] as const;
export type EmployerCosts=Record<typeof EMPLOYER_COST_FIELDS[number][0],string>;
const max=99999999999999999999n;
function money(v:string,label:string){if(!/^(0|[1-9]\d{0,19})$/.test(v))throw new InputError(`${label}: 원 단위 금액을 확인하세요. 해당 없으면 0을 입력하세요.`);return BigInt(v);}
export function employerCostTotal(gross:string,values:Record<string,string>){let extra=0n;const costs={} as EmployerCosts;for(const[key,label]of EMPLOYER_COST_FIELDS){const value=money(values[key]??"",label);extra+=value;costs[key]=value.toString();}const total=money(gross,"공제 전 급여")+extra;if(total>max)throw new InputError("총노무원가가 20자리 범위를 초과합니다.");return{costs,extra,total};}
export type ReportingPayroll={id:string;version:number;employeeId:string;period:string;netAmount:{toFixed:(n:number)=>string};snapshot:unknown;voidedAt:Date|null};
export function reportingBasis(p:ReportingPayroll){return createHash("sha256").update(JSON.stringify({id:p.id,version:p.version,employeeId:p.employeeId,period:p.period,net:p.netAmount.toFixed(0),snapshot:p.snapshot,voided:Boolean(p.voidedAt)})).digest("hex");}
export function reportingGross(p:ReportingPayroll){
 if(p.voidedAt)throw new InputError("취소된 급여 지급 확인입니다.");const s=statementBasis(p.snapshot,p.employeeId,p.period,p.netAmount.toFixed(0));if(s.issues.length)throw new InputError("급여명세서의 지급·공제 내역을 먼저 확인하세요.");
 if(s.monthly)return s.monthly.gross.toString();const d=readDailyPayDetails(p.snapshot),groups=dailyRateGroups(s.lines);
 if(!d||d.groups.length!==groups.length||!groups.every(g=>d.groups.some(row=>row.key===g.key&&row.units===g.units)))throw new InputError("일용직 공제 전 일당·공제 내역을 먼저 확인하세요.");const result=calculateDailyPay(d.groups,d.deductions);if(result.net!==BigInt(p.netAmount.toFixed(0)))throw new InputError("급여 실지급액과 지급·공제 내역이 다릅니다.");return result.gross.toString();
}
export async function savePayrollReporting(tx:Prisma.TransactionClient,d:FormData){
 const employeeId=text(d,"employeeId","직원",true,50),period=paymentMonth(text(d,"period","급여월",true,7)),requestId=text(d,"requestId","요청",true,50),reason=text(d,"reason","신고자료 변경 사유",true,300),basis=text(d,"basis","급여 기준",true,64),version=revision(d);
 if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("신고자료 화면을 다시 열어 주세요.");
 const fingerprint=createHash("sha256").update(JSON.stringify(Object.fromEntries([...d.entries()].sort(([a],[b])=>a.localeCompare(b))))).digest("hex");
 const replay=await tx.financeChange.findUnique({where:{requestId}});if(replay){if(replay.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용된 요청입니다.");return replay.entityId;}
 const employee=await tx.employee.findFirst({where:{id:employeeId,companyId:COMPANY_ID}});const p=await tx.payrollPayment.findFirst({where:{employeeId,period,voidedAt:null,employee:{companyId:COMPANY_ID}}});
 if(!employee||!p||reportingBasis(p)!==basis)throw new InputError("급여 지급 확인이 변경되었습니다. 다시 조회하세요.");
 const current=await payrollBasis(tx,period,employeeId);if(current.basis!==p.basis)throw new InputError("계약·출역이 변경되었습니다. 급여 지급 확인을 먼저 정정하세요.");
 const gross=reportingGross(p),declaredWage=money(text(d,"declaredWage","신고 기준 금액",true,20),"신고 기준 금액").toString(),declaredDays=text(d,"declaredDays","신고 일수",true,6);
 if(!/^(0|[1-9]\d?)(\.\d{1,2})?$/.test(declaredDays)||Number(declaredDays)>new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).getUTCDate())throw new InputError("신고 일수는 해당 월 일수 안에서 소수 둘째 자리까지 입력하세요.");
 const employer=employerCostTotal(gross,Object.fromEntries(EMPLOYER_COST_FIELDS.map(([key,label])=>[key,text(d,key,label,true,20)]))),sourceReference=text(d,"sourceReference","신고·보험료 확인 근거",true,300);
 if(d.get("confirmed")!=="on")throw new InputError("신고금액·회사 부담분을 원본 또는 회계사무소 자료와 대조하세요.");
 const old=await tx.payrollReporting.findUnique({where:{employeeId_period:{employeeId,period}}});if((old?.version??0)!==version)throw new InputError("신고자료가 변경되었습니다. 다시 조회하세요.");
 const locked=await tx.employee.updateMany({where:{id:employee.id,companyId:COMPANY_ID,version:employee.version},data:{version:{increment:1}}});if(locked.count!==1)throw new InputError("직원·급여 자료가 변경되었습니다.");
 const values={payrollId:p.id,basis,declaredWage,declaredDays,employerCosts:employer.costs,sourceReference};
 let saved;if(old){const changed=await tx.payrollReporting.updateMany({where:{id:old.id,version},data:{...values,version:{increment:1}}});if(changed.count!==1)throw new InputError("신고자료가 변경되었습니다.");saved=await tx.payrollReporting.findUniqueOrThrow({where:{id:old.id}});}else saved=await tx.payrollReporting.create({data:{employeeId,period,...values}});
 await invalidateSourceCosts(tx,"PAYROLL",[p.id]);
 await tx.financeChange.create({data:{companyId:COMPANY_ID,entityId:saved.id,operation:"payrollReporting",requestId,fingerprint,previous:old?JSON.parse(JSON.stringify(old)):{},next:JSON.parse(JSON.stringify(saved)),reason}});return saved.id;
}
export async function payrollReportingRows(db:import("@/generated/prisma/client").PrismaClient,companyId:string,period:string){
 paymentMonth(period);const payments=await db.payrollPayment.findMany({where:{employee:{companyId},period,voidedAt:null},include:{employee:{include:{reporting:{where:{period}}}}},orderBy:{employee:{code:"asc"}}});
 const month=await import("./labor").then(m=>m.laborMonth(db,period));
 const rows=[];
 for(const p of payments){const report=p.employee.reporting[0];const issues:string[]=[];let gross:string|null=null,total:string|null=null;
  try{gross=reportingGross(p);const current=await payrollBasis(db,period,p.employeeId,month);if(current.basis!==p.basis)issues.push("계약·출역 변경 · 급여 재확인 필요");}catch(e){issues.push(e instanceof InputError?e.message:"급여 기준 확인 필요");}
  if(!report)issues.push("신고금액·회사 부담분 미작성");else{
   if(report.payrollId!==p.id||report.basis!==reportingBasis(p))issues.push("급여 변경 후 신고자료 재검토 필요");
   try{if(gross)total=employerCostTotal(gross,report.employerCosts as EmployerCosts).total.toString();}catch{issues.push("회사 부담분 확인 필요");}
  }
  rows.push({payment:p,report,gross,total,issues});
 }return rows;
}

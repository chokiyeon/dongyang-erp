import {invalidateSourceCosts} from "./source-cost-invalidation";
import {createHash} from "node:crypto";
import type {Prisma,PrismaClient} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError,text,amount,date,choice,revision} from "./validation";
import {koreanToday} from "./forecast";
import {normalizePayeeAccount,paymentMonth,recurringDue} from "./payment-terms";
import {laborUnits,laborAmount} from "./labor-types";
export {EMPLOYMENT_KINDS,LABOR_ROLES,laborUnits,laborAmount} from "./labor-types";
function snapshot(value:unknown):Prisma.InputJsonValue{return JSON.parse(JSON.stringify(value));}
export async function saveLabor(tx:Prisma.TransactionClient,op:"employee"|"rate"|"rateVoid"|"work"|"workVoid",data:FormData){
 const requestId=text(data,"requestId","요청 식별자",true,50);if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("화면을 다시 열어 주세요.");
 const reason=text(data,"reason","변경 사유",true,300);const fingerprint=createHash("sha256").update(JSON.stringify({op,values:Object.fromEntries([...data.entries()].sort(([a],[b])=>a.localeCompare(b)))})).digest("hex");
 const replay=await tx.laborChange.findUnique({where:{requestId},include:{employee:true}});
 if(replay){if(replay.employee.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용에 사용된 요청입니다. 다시 조회하세요.");return (replay.next as {id:string}).id;}
 const employeeId=text(data,"employeeId","직원",op!=="employee",50);
 let employee=employeeId?await tx.employee.findFirst({where:{id:employeeId,companyId:COMPANY_ID}}):null;
 if(employeeId&&!employee)throw new InputError("회사 직원을 선택하세요.");
 if(!await tx.company.findUnique({where:{id:COMPANY_ID}}))throw new InputError("회사 정보를 먼저 등록하세요.");
 let previous:unknown={};let next:unknown={};let result=employeeId;
 async function lock(){const changed=await tx.employee.updateMany({where:{id:employee!.id,companyId:COMPANY_ID,version:employee!.version},data:{version:{increment:1}}});if(changed.count!==1)throw new InputError("직원 또는 출역이 다른 화면에서 변경되었습니다. 다시 조회하세요.");}
 if(op==="employee"){
  if(employee&&employee.version!==revision(data))throw new InputError("직원 정보가 변경되었습니다. 다시 조회하세요.");
  const kind=choice(text(data,"kind","급여 구분",true),["DAILY","MONTHLY"] as const,"급여 구분");const startDate=date(text(data,"startDate","입사일",true),"입사일")!;const endDate=date(text(data,"endDate","퇴사일"),"퇴사일");if(endDate&&endDate<startDate)throw new InputError("퇴사일은 입사일 이후여야 합니다.");
  if(employee){if(employee.kind!==kind&&(await tx.employmentRate.count({where:{employeeId}})||await tx.workRecord.count({where:{employeeId}})))throw new InputError("계약·출역 이력이 있는 직원의 급여 구분은 변경할 수 없습니다. 별도 고용 코드를 사용하세요.");
   if(await tx.workRecord.count({where:{employeeId,voidedAt:null,OR:[{workedDate:{lt:startDate}},...(endDate?[{workedDate:{gt:endDate}}]:[])]}}))throw new InputError("입사·퇴사 기간 밖의 출역이 있습니다. 출역을 먼저 확인하세요.");
  }
  const hasPayee=data.has("payeeBank")||data.has("payeeAccount")||data.has("payeeHolder");
  const payeeBank=hasPayee?text(data,"payeeBank","급여 송금 은행",false,50)||null:employee?.payeeBank??null;
  const rawAccount=hasPayee?text(data,"payeeAccount","급여 송금 계좌번호",false,40):employee?.payeeAccount??"";const payeeAccount=rawAccount?normalizePayeeAccount(rawAccount):null;
  const payeeHolder=hasPayee?text(data,"payeeHolder","급여 예금주",false,100)||null:employee?.payeeHolder??null;
  if((payeeBank||payeeAccount||payeeHolder)&&!(payeeBank&&payeeAccount&&payeeHolder))throw new InputError("급여 송금 은행·계좌번호·예금주를 모두 입력하세요.");
  const same=employee?.payeeBank===payeeBank&&employee?.payeeAccount===payeeAccount&&employee?.payeeHolder===payeeHolder;
  const payeeVerifiedAt=!hasPayee?employee?.payeeVerifiedAt??null:payeeBank&&data.get("payeeConfirmed")==="on"?(same&&employee?.payeeVerifiedAt?employee.payeeVerifiedAt:new Date()):null;
  const values={payeeBank,payeeAccount,payeeHolder,payeeVerifiedAt,code:text(data,"code","직원 코드",true,30).toUpperCase(),name:text(data,"name","직원 이름",true,100),kind,startDate,endDate,active:data.get("active")==="on"};previous=employee??{};
  if(employee){await lock();employee=await tx.employee.update({where:{id:employeeId},data:values});}else employee=await tx.employee.create({data:{...values,companyId:COMPANY_ID}});result=employee.id;next=employee;
 }else if(op==="rate"||op==="rateVoid"){
  const id=text(data,"rateId","계약 단가",false,50);const old=id?await tx.employmentRate.findFirst({where:{id,employeeId}}):null;
  if(id&&(!old||old.voidedAt||old.version!==revision(data)))throw new InputError("계약 단가가 변경되었습니다. 다시 조회하세요.");
  if(op==="rateVoid"){
   if(!old)throw new InputError("취소할 계약 단가를 선택하세요.");if(await tx.workRecord.count({where:{rateId:old.id,voidedAt:null}}))throw new InputError("사용 중인 출역의 계약입니다. 출역을 먼저 정정·취소하세요.");await lock();await tx.employmentRate.update({where:{id:old.id},data:{voidedAt:new Date(),version:{increment:1}}});previous=old;next={id:employeeId,rateId:old.id,voided:true};
  }else{
   const effectiveDate=date(text(data,"effectiveDate","계약 적용일",true),"계약 적용일")!;const role=choice(text(data,"role","작업 구분",true),["NORMAL","SIGNAL"] as const,"작업 구분");const value=amount(text(data,"amount","계약 금액",true,20),"계약 금액")!;
   if(BigInt(value)<=0n)throw new InputError("계약 금액은 0보다 커야 합니다.");if(effectiveDate<employee!.startDate||(employee!.endDate&&effectiveDate>employee!.endDate))throw new InputError("고용 기간 안의 계약 적용일을 입력하세요.");if(employee!.kind==="MONTHLY"&&role!=="NORMAL")throw new InputError("월급제는 일반 구분의 월 기준액만 등록합니다.");
   await lock();if(await tx.employmentRate.count({where:{employeeId,role,effectiveDate,voidedAt:null,...(id?{id:{not:id}}:{})}}))throw new InputError("같은 적용일·작업 구분의 계약이 있습니다. 기존 계약을 수정하세요.");
   if(old&&(old.role!==role||old.effectiveDate.getTime()!==effectiveDate.getTime())&&await tx.workRecord.count({where:{rateId:old.id}}))throw new InputError("출역 이력이 있는 계약의 적용일·작업 구분은 변경할 수 없습니다. 새 계약을 추가하세요.");
   const values={effectiveDate,role,amount:value};const saved=old?await tx.employmentRate.update({where:{id:old.id},data:{...values,version:{increment:1}}}):await tx.employmentRate.create({data:{...values,employeeId}});previous=old??{};next={id:employeeId,rate:saved};
  }
 }else{
  const id=text(data,"workId","출역",false,50);const old=id?await tx.workRecord.findFirst({where:{id,employeeId}}):null;if(id&&(!old||old.voidedAt||old.version!==revision(data)))throw new InputError("출역 내역이 변경되었습니다. 다시 조회하세요.");
  if(op==="workVoid"){
   if(!old)throw new InputError("취소할 출역을 선택하세요.");await lock();await tx.workRecord.update({where:{id:old.id},data:{voidedAt:new Date(),voidReason:reason,version:{increment:1}}});previous=old;next={id:old.id,voided:true};result=old.id;
  }else{
   if(employee!.kind!=="DAILY")throw new InputError("사무실 월급제 직원은 출역을 입력하지 않습니다.");if(!employee!.active&&!old)throw new InputError("사용 중인 직원을 선택하세요.");
   const workedDate=date(text(data,"workedDate","작업일",true),"작업일")!;if(workedDate.toISOString().slice(0,10)>koreanToday())throw new InputError("미래 날짜의 실제 출역은 입력할 수 없습니다.");if(workedDate<employee!.startDate||(employee!.endDate&&workedDate>employee!.endDate))throw new InputError("입사·퇴사 기간 안의 작업일을 입력하세요.");
   const role=choice(text(data,"role","작업 구분",true),["NORMAL","SIGNAL"] as const,"작업 구분");const projectId=text(data,"projectId","현장",true,50);if(!await tx.project.findFirst({where:{id:projectId,companyId:COMPANY_ID}}))throw new InputError("회사 현장을 선택하세요.");
   const units=text(data,"units","공수",true,5);laborUnits(units);await lock();
   if(await tx.workRecord.count({where:{employeeId,projectId,workedDate,role,voidedAt:null,...(id?{id:{not:id}}:{})}}))throw new InputError("같은 직원·날짜·현장·작업 구분의 출역이 있습니다. 기존 내역을 수정하세요.");
   const rate=await tx.employmentRate.findFirst({where:{employeeId,role,voidedAt:null,effectiveDate:{lte:workedDate}},orderBy:[{effectiveDate:"desc"},{id:"asc"}]});if(!rate)throw new InputError("작업일에 적용할 계약 단가가 없습니다. 일반·신호수 계약을 확인하세요.");
   const values={projectId,workedDate,role,units,rateId:rate.id,rateAmount:rate.amount,amount:laborAmount(rate.amount.toFixed(0),units),source:text(data,"source","출역 원본 메모",true,200)};
   const saved=old?await tx.workRecord.update({where:{id:old.id},data:{...values,version:{increment:1}}}):await tx.workRecord.create({data:{...values,employeeId}});previous=old??{};next=saved;result=saved.id;
  }
 }
 const payrollIds=await tx.payrollPayment.findMany({where:{employeeId:employee!.id},select:{id:true}});await invalidateSourceCosts(tx,"PAYROLL",payrollIds.map(p=>p.id));
 await tx.laborChange.create({data:{employeeId:employee!.id,requestId,fingerprint,operation:op,previous:snapshot(previous),next:snapshot(next),reason}});return result;
}
export async function laborMonth(db:PrismaClient|Prisma.TransactionClient,period:string){
 paymentMonth(period);const start=new Date(`${period}-01`);const end=new Date(recurringDue(period,0));
 const [employees,records]=await Promise.all([
  db.employee.findMany({where:{companyId:COMPANY_ID,startDate:{lte:end},OR:[{endDate:null},{endDate:{gte:start}}]},include:{rates:{where:{voidedAt:null,effectiveDate:{lte:end}},orderBy:[{effectiveDate:"desc"},{id:"asc"}]}},orderBy:{code:"asc"}}),
  db.workRecord.findMany({where:{employee:{companyId:COMPANY_ID},voidedAt:null,workedDate:{gte:start,lte:end}},include:{employee:true,project:true},orderBy:[{workedDate:"asc"},{id:"asc"}]}),
 ]);
 const dayUnits=new Map<string,bigint>();for(const r of records){const key=`${r.employeeId}:${r.workedDate.toISOString()}`;dayUnits.set(key,(dayUnits.get(key)??0n)+laborUnits(r.units.toFixed(2)));}
 const daily=employees.filter(e=>e.kind==="DAILY").map(e=>{
  const lines=records.filter(r=>r.employeeId===e.id);const issues:string[]=[];if(!lines.length)issues.push("출역 없음 · 누락 여부 확인");
  for(const r of lines){const rate=e.rates.find(v=>v.role===r.role&&v.effectiveDate<=r.workedDate);if(!rate||rate.id!==r.rateId||rate.amount.toFixed(0)!==r.rateAmount.toFixed(0))issues.push(`${r.workedDate.toISOString().slice(0,10)} 계약 변경 · 출역 재검토`);}
  if([...dayUnits].some(([key,n])=>key.startsWith(`${e.id}:`)&&n>100n))issues.push("하루 합산 1공수 초과 · 중복/연장 확인");
  return{employee:e,lines,units:lines.reduce((sum,r)=>sum+laborUnits(r.units.toFixed(2)),0n),amount:lines.reduce((sum,r)=>sum+BigInt(r.amount.toFixed(0)),0n),issues:[...new Set(issues)]};
 });
 const monthly=employees.filter(e=>e.kind==="MONTHLY").map(e=>{const rate=e.rates.find(r=>r.role==="NORMAL");const issues:string[]=[];if(!rate)issues.push("월 기준액 계약 미등록");if(e.startDate>start||(e.endDate&&e.endDate<end)||e.rates.some(r=>r.effectiveDate>start))issues.push("월중 입·퇴사/계약 변경 · 실제 월급 별도 확인");return{employee:e,rate,issues};});
 const projects=new Map<string,{id:string;name:string;units:bigint;amount:bigint}>();for(const r of records){const p=projects.get(r.projectId)??{id:r.projectId,name:`${r.project.code} · ${r.project.name}`,units:0n,amount:0n};p.units+=laborUnits(r.units.toFixed(2));p.amount+=BigInt(r.amount.toFixed(0));projects.set(r.projectId,p);}
 return{period,records,daily,monthly,projects:[...projects.values()],dailyTotal:daily.reduce((s,r)=>s+r.amount,0n)};
}

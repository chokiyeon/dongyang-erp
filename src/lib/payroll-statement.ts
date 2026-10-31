import {readMonthlyPayDetails,calculateMonthlyPay} from "./monthly-payroll-details";
import {laborAmount,laborUnits} from "./labor-types";
export type StatementLine={date:string;projectId:string;role:"NORMAL"|"SIGNAL";units:string;rate:string;amount:string};
export function statementBasis(snapshot:unknown,employeeId:string,period:string,netAmount:string){
 const issues:string[]=[];let monthly:ReturnType<typeof calculateMonthlyPay>|null=null;const lines:StatementLine[]=[];
 const root=snapshot&&typeof snapshot==="object"?snapshot as Record<string,unknown>:{};
 const employee=root.employee&&typeof root.employee==="object"?root.employee as Record<string,unknown>:{};
 const validIdentity=employee.id===employeeId&&root.period===period;
 if(!validIdentity)return{monthly:null,lines:[],issues:["저장된 지급 확인 기준의 직원·급여월을 확인해야 합니다."],calculatedDaily:0n};
 if(employee.kind==="MONTHLY"){
  const details=readMonthlyPayDetails(snapshot);monthly=details?calculateMonthlyPay(details.amounts):null;
  if(!monthly)issues.push("저장된 수당·공제 세부 내역이 없습니다.");
  if(monthly&&monthly.net!==BigInt(netAmount))issues.push("세부 계산액과 확인 실지급액이 다릅니다.");
 }else if(employee.kind==="DAILY"&&Array.isArray(root.lines)&&validIdentity){
  let invalid=false;const ids=new Set<string>();
  for(const raw of root.lines){try{
   if(!raw||typeof raw!=="object")throw Error();const r=raw as Record<string,unknown>;
   if(typeof r.id!=="string"||ids.has(r.id)||typeof r.date!=="string"||typeof r.project!=="string"||(r.role!=="NORMAL"&&r.role!=="SIGNAL")||typeof r.units!=="string"||typeof r.rateAmount!=="string"||typeof r.amount!=="string"||!/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(r.date)||r.date.slice(0,7)!==period||new Date(r.date).toISOString()!==r.date||!/^(0|[1-9]\d{0,19})$/.test(r.rateAmount)||!/^(0|[1-9]\d{0,19})$/.test(r.amount))throw Error();
   laborUnits(r.units);if(laborAmount(r.rateAmount,r.units)!==r.amount)throw Error();ids.add(r.id);lines.push({date:r.date.slice(0,10),projectId:r.project,role:r.role,units:r.units,rate:r.rateAmount,amount:r.amount});
  }catch{invalid=true;}}
  if(invalid){issues.push("저장된 출역 기준에 중복·잘못된 날짜 또는 금액이 있어 세부 출역을 표시하지 않습니다.");lines.length=0;}
  if(!root.lines.length)issues.push("저장된 출역 내역이 없습니다.");
 }else issues.push("저장된 급여 구분·출역 기준을 읽을 수 없습니다.");
 return{monthly,lines,issues,calculatedDaily:lines.reduce((sum,row)=>sum+BigInt(row.amount),0n)};
}
export function maskPayeeAccount(account:string|null){if(!account)return "미등록";const digits=account.replace(/[^0-9]/g,"");return digits.length>4?`****${digits.slice(-4)}`:"****";}

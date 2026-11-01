import type {PrismaClient} from "@/generated/prisma/client";
import type {PayrollSlipData} from "@/components/payroll-slip";
import {laborUnits} from "./labor-types";
import {payrollBasis} from "./payroll";
import {statementBasis,maskPayeeAccount} from "./payroll-statement";
import {MONTHLY_PAY_FIELDS} from "./monthly-payroll-details";
import {cashSummary,won} from "./cash";
export async function loadPayrollSlip(db:PrismaClient,company:{id:string;name:string},id:string){
 const {payment,stale,projects}=await db.$transaction(async tx=>{const payment=await tx.payrollPayment.findFirst({where:{id,employee:{companyId:company.id}},include:{employee:true,cashPlan:{include:{settlements:{orderBy:[{processedDate:"asc"},{id:"asc"}]}}}}});if(!payment)return{payment:null,stale:true,projects:[]};let stale=true;try{stale=(await payrollBasis(tx,payment.period,payment.employeeId)).basis!==payment.basis;}catch{/* Missing current employment/month data requires review. */}const projects=await tx.project.findMany({where:{companyId:company.id},select:{id:true,code:true,name:true}});return{payment,stale,projects};},{isolationLevel:"RepeatableRead",timeout:30000});if(!payment)return null;
 const statement=statementBasis(payment.snapshot,payment.employeeId,payment.period,payment.netAmount.toFixed(0));const summary=cashSummary(payment.cashPlan);const issues=[...statement.issues,...(statement.lines.length>0&&statement.calculatedDaily!==BigInt(payment.netAmount.toFixed(0))&&!payment.adjustmentReason?["출역 계산액과 실지급 확인액의 차이에 대한 근거가 없습니다."]:[]),...(stale?["지급 확인 후 계약·출역이 변경되어 재검토가 필요합니다."]:[]),...(payment.voidedAt?["취소된 급여 지급 확인입니다."]:[])];
 const employee=payment.employee;
 const monthly=statement.monthly;const daily=employee.kind==="DAILY";
 const earnings:PayrollSlipData["earnings"]=MONTHLY_PAY_FIELDS.filter(([, ,group])=>group==="earnings").map(([key,label])=>({label,amount:monthly?.details.amounts[key]??null}));
 if(daily)earnings.unshift({label:"실지급 기준 계산액 (출역 합산)",amount:statement.lines.length?statement.calculatedDaily.toString():null});
 const order:string[]=["incomeTax","localTax","employment","pension","health","care","advance","late","absence"];
 const deductions:PayrollSlipData["deductions"]=MONTHLY_PAY_FIELDS.filter(([, ,group])=>group==="deductions"||group==="attendance").sort(([a],[b])=>order.indexOf(a)-order.indexOf(b)).map(([key,label])=>({label,amount:monthly?.details.amounts[key]??null}));
 if(daily)deductions.push({label:"노조 조합비",amount:null});
 const unitTotal=statement.lines.reduce((sum,row)=>sum+laborUnits(row.units),0n);const rateLabels=[...new Set(statement.lines.map(row=>`${row.role==="SIGNAL"?"신호수":"일반"} ${won(BigInt(row.rate))}`))];
 const breakdown=new Map<string,{role:string;rate:string;units:bigint;amount:bigint}>();for(const row of statement.lines){const key=`${row.role}:${row.rate}`;const group=breakdown.get(key)??{role:row.role==="SIGNAL"?"신호수":"일반",rate:row.rate,units:0n,amount:0n};group.units+=laborUnits(row.units);group.amount+=BigInt(row.amount);breakdown.set(key,group);}
 const dailyMethod=[...breakdown.values()].map(row=>`${row.role} ${row.units/100n}.${(row.units%100n).toString().padStart(2,"0")}공수 × ${won(BigInt(row.rate))} = ${won(row.amount)}`).join(" / ");
 const slip:PayrollSlipData={period:payment.period,company:company.name,employee:employee.name,code:employee.code,kind:daily?"일용직":"상용직",dueDate:payment.dueDate.toISOString().slice(0,10),account:`${employee.payeeBank??"은행 미등록"} ${maskPayeeAccount(employee.payeeAccount)}`,review:issues,earnings,deductions,earningTotal:monthly?.earnings.toString()??(statement.lines.length?statement.calculatedDaily.toString():null),deductionTotal:monthly?(monthly.attendance+monthly.deductions).toString():null,adjustment:monthly?.adjustment.toString()??null,net:payment.netAmount.toFixed(0),actual:summary.actual.toString(),remaining:summary.remaining.toString(),reason:payment.adjustmentReason??"등록된 조정 근거 없음",daily,units:daily&&statement.lines.length?`${unitTotal/100n}.${(unitTotal%100n).toString().padStart(2,"0")} 공수`:"미입력",rate:daily&&rateLabels.length?rateLabels.join(" / "):"미입력",method:monthly?"실수령액 = 지급항목 합계 − 근태·제세 공제합계 + 연말정산 조정액. 저장한 원 단위 금액을 적용합니다.":`${dailyMethod||"저장 당시 공수 × 실지급 일당"}. 실지급 기준이며 공제를 재차감하지 않습니다. 확인 지급액과 차이가 있으면 조정 근거를 대조합니다.`};
 return{payment,statement,issues,slip,projects};
}

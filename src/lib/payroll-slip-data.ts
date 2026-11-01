import {DAILY_DEDUCTIONS,dailyAttendanceSummary,readDailyPayDetails,calculateDailyPay,dailyRateGroups} from "./daily-payroll-details";
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

 const order:string[]=["incomeTax","localTax","employment","pension","health","care","advance","late","absence"];
 const deductions:PayrollSlipData["deductions"]=MONTHLY_PAY_FIELDS.filter(([, ,group])=>group==="deductions"||group==="attendance").sort(([a],[b])=>order.indexOf(a)-order.indexOf(b)).map(([key,label])=>({label,amount:monthly?.details.amounts[key]??null}));

 const unitTotal=statement.lines.reduce((sum,row)=>sum+laborUnits(row.units),0n);const rateLabels=[...new Set(statement.lines.map(row=>`${row.role==="SIGNAL"?"신호수":"일반"} ${won(BigInt(row.rate))}`))];
 const detail=daily?readDailyPayDetails(payment.snapshot):null;
 const sourceGroups=dailyRateGroups(statement.lines);
 const validGroups=detail&&detail.groups.length===sourceGroups.length&&sourceGroups.every(row=>detail.groups.some(g=>g.key===row.key&&g.units===row.units));
 const dailyCalculation=detail&&validGroups?calculateDailyPay(detail.groups,detail.deductions):null;
 if(daily&&!dailyCalculation)issues.push("공제 전 일당·일수와 공제 내역을 확인해야 합니다. 기존 실지급 기준 일당에서 공제를 다시 빼지 않습니다.");
 if(dailyCalculation&&dailyCalculation.net!==BigInt(payment.netAmount.toFixed(0)))issues.push("일당 × 일수 − 공제합계와 확인 실지급액이 다릅니다.");
 if(daily){
  earnings.length=0;deductions.length=0;
  const attendance=dailyAttendanceSummary(statement.lines);
  earnings.push({label:"공수",amount:null,display:statement.lines.length?`${attendance.units} 공수`:"미확인"});
  earnings.push({label:"일수",amount:null,display:statement.lines.length?`${attendance.days}일 (실제 출역일)`:"미확인"});
  for(const[key,label]of DAILY_DEDUCTIONS)deductions.push({label,amount:dailyCalculation?.details.deductions[key]??null});
 }
 const slip:PayrollSlipData={period:payment.period,company:company.name,employee:employee.name,code:employee.code,kind:daily?"일용직":"상용직",dueDate:payment.dueDate.toISOString().slice(0,10),account:`${employee.payeeBank??"은행 미등록"} ${maskPayeeAccount(employee.payeeAccount)}`,review:issues,earnings,deductions,earningTotal:monthly?.earnings.toString()??dailyCalculation?.gross.toString()??null,deductionTotal:monthly?(monthly.attendance+monthly.deductions).toString():dailyCalculation?.deducted.toString()??null,adjustment:monthly?.adjustment.toString()??null,net:payment.netAmount.toFixed(0),actual:summary.actual.toString(),remaining:summary.remaining.toString(),reason:payment.adjustmentReason??"등록된 조정 근거 없음",daily,dailyCalculationConfirmed:Boolean(dailyCalculation),units:daily&&statement.lines.length?`${unitTotal/100n}.${(unitTotal%100n).toString().padStart(2,"0")} 공수`:"미입력",rate:daily&&rateLabels.length?rateLabels.join(" / "):"미입력",method:monthly?"실수령액 = 지급항목 합계 − 근태·제세 공제합계 + 연말정산 조정액. 저장한 원 단위 금액을 적용합니다.":dailyCalculation?`실지급 기준 계산액(공제 전) = 확인 일당 × 합산 공수. 실지급액 = 공제 전 계산액 − 공제합계. 일수는 중복을 뺀 실제 출역 날짜 수입니다. ${dailyCalculation.details.groups.map(g=>`${g.role==="SIGNAL"?"신호수":"일반"} ${won(BigInt(g.grossRate))} × ${g.units}공수`).join(" / ")}`:"공제 전 일당과 공제 내역 확인 전입니다. 기존 실지급 기준 출역에서 공제를 자동 재차감하지 않습니다."};
 return{payment,statement,issues,slip,projects};
}

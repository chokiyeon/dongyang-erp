import {bankReconciliationMonth} from "./bank-reconciliation";
import {reportingBasis} from "./payroll-reporting";
import type {Prisma,PrismaClient} from "@/generated/prisma/client";
import {paymentMonth,recurringDue} from "./payment-terms";
import {cashSummary} from "./cash";
export type MonthEndCheck={key:string;title:string;count:number;description:string;href:string};
export async function loadMonthEndReview(db:PrismaClient|Prisma.TransactionClient,companyId:string,period:string){
 paymentMonth(period);const start=new Date(`${period}-01`),end=new Date(recurringDue(period,0));const range={gte:start,lte:end};
 const read=async(tx:Prisma.TransactionClient)=>{
  const[bank,trades,templates,recurring,payrollMissing,costs,plans,latest,payrollReports,reconciliation]=await Promise.all([
   tx.bankTransaction.count({where:{account:{companyId},tradedDate:range,internalTransfer:false,accountingCodeId:null}}),
   tx.tradeDocument.findMany({where:{companyId,issuedDate:range,voidedAt:null},select:{kind:true,proofConfirmed:true,inputVatReview:true,taxAmount:true,projectId:true,companyExpense:true,cashPlanId:true,settledAmount:true,grossAmount:true,paymentMethod:true}}),
   tx.recurringPaymentTemplate.count({where:{companyId,active:true,startMonth:{lte:period},OR:[{endMonth:null},{endMonth:{gte:period}}],months:{none:{period,voidedAt:null}}}}),
   tx.monthlyPayment.count({where:{template:{companyId},period,voidedAt:null,OR:[{confirmed:false},{amount:null}]}}),
   tx.employee.count({where:{companyId,startDate:{lte:end},AND:[{OR:[{endDate:null},{endDate:{gte:start}}]},{OR:[{kind:"MONTHLY"},{kind:"DAILY",workRecords:{some:{workedDate:range,voidedAt:null}}}]}],payrolls:{none:{period,voidedAt:null}}}}),
   tx.sourceCostReview.count({where:{companyId,incurredDate:range,active:true,needsReview:true}}),
   tx.cashPlan.findMany({where:{companyId,plannedDate:{lte:end},completedAt:null},include:{settlements:true}}),
   tx.accountingPackage.findFirst({where:{companyId,period},orderBy:{revision:"desc"},select:{revision:true,state:true}}),
   tx.payrollPayment.findMany({where:{employee:{companyId},period,voidedAt:null},include:{employee:{include:{reporting:{where:{period}}}}}}),
   bankReconciliationMonth(tx,companyId,period),
  ]);
  const checks:MonthEndCheck[]=[
   {key:"bankBalance",title:"통장 월말 잔액 대조 미완료",count:reconciliation.rows.filter(row=>!row.ready).length,description:"사용 중지 통장도 포함합니다. 월초 잔액과 은행 월말 잔액을 대조하고 원본 변경 여부를 확인하세요.",href:`/bank-reconciliation?period=${period}`},
   {key:"bank",title:"은행 거래 회계코드 미분류",count:bank,description:"회사 통장 간 이체를 제외한 해당 월 은행 거래입니다.",href:"/ledger/classify"},
   {key:"proof",title:"매입·매출 원본 미확인",count:trades.filter(t=>!t.proofConfirmed).length,description:"취소되지 않은 해당 월 증빙의 원본 확인이 필요합니다.",href:`/trades?from=${period}-01&to=${recurringDue(period,0)}`},
   {key:"vat",title:"매입 부가세 공제 미검토",count:trades.filter(t=>t.kind==="PURCHASE"&&t.inputVatReview==="PENDING"&&BigInt(t.taxAmount.toFixed(0))>0n).length,description:"세액이 있는 매입의 공제 여부를 회계사무소와 확인하세요.",href:`/tax-summary?month=${period}&mode=MONTH`},
   {key:"project",title:"매입·매출 현장·본사 구분 누락",count:trades.filter(t=>!t.projectId&&!t.companyExpense).length,description:"현장 또는 본사·공통 비용 여부가 지정되지 않은 증빙입니다.",href:`/trades?from=${period}-01&to=${recurringDue(period,0)}`},
   {key:"tradeCash",title:"미수·미지급 예산안 미연결",count:trades.filter(t=>!t.cashPlanId&&t.settledAmount.lt(t.grossAmount)&&(t.kind==="SALE"||t.paymentMethod==="BANK_TRANSFER")).length,description:"미정산 매입·매출을 확인해 기존 자금예정에 연결하거나 새로 생성하세요. 어음 지급은 제외합니다.",href:`/trades?from=${period}-01&to=${recurringDue(period,0)}`},
   {key:"recurringMissing",title:"월세·공과금 월별 내역 미생성",count:templates,description:"해당 월에 유효한 정기 지급 중 취소되지 않은 월별 내역이 없습니다.",href:`/recurring-payments?period=${period}`},
   {key:"recurring",title:"월세·공과금 금액·지급 미확인",count:recurring,description:"월별 내역은 있지만 금액 또는 지급 확인이 남아 있습니다.",href:`/recurring-payments?period=${period}`},
   {key:"payroll",title:"급여 지급 확인 미등록",count:payrollMissing,description:"해당 월 재직 상용직과 출역이 등록된 일용직 중 지급 확인이 없습니다. 출역 자체의 누락은 별도로 대조하세요.",href:`/payroll-review?period=${period}`},
   {key:"reporting",title:"급여 신고·회사 부담분 미작성·재검토",count:payrollReports.filter(p=>!p.employee.reporting.some(r=>r.payrollId===p.id&&r.basis===reportingBasis(p))).length,description:"신고금액과 회사 부담 보험료를 확인하세요. 실지급액을 신고금액이나 총노무원가로 간주하지 않습니다.",href:`/payroll-reporting?period=${period}`},
   {key:"cost",title:"총원가·현장 배부 재검토",count:costs,description:"원본 변경 등으로 재검토 표시가 남은 해당 월 원가 배부입니다.",href:"/source-costs"},
   {key:"cash",title:"월말까지 남은 입출금 예정",count:plans.filter(p=>cashSummary(p).remaining>0n).length,description:"이전 달에서 넘어온 내역을 포함해 월말까지 미정산 금액이 남은 예정입니다. 실제 처리 여부와 지급일 변경을 확인하세요.",href:"/cash"},
  ];return{checks,latest};
 };return "$transaction" in db?db.$transaction(read,{isolationLevel:"RepeatableRead",timeout:30000}):read(db);
}

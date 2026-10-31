import type {PrismaClient,Prisma} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {laborMonth} from "./labor";
import {payrollBasis} from "./payroll";
import {cashSummary} from "./cash";
import {date,InputError} from "./validation";
export type TransferPreparationRow={id:string;source:"매입"|"정기지급"|"급여";reference:string;description:string;documentDate:string;dueDate:string;partnerId:string;partner:string;project:string;bank:string;account:string;holder:string;amount:string;sourceLink:string;paymentLink:string;issues:string[];recipientLink?:string};
export async function transferPreparation(db:PrismaClient|Prisma.TransactionClient,until:string,projectId=""){
 const end=date(until,"송금 준비 기준일");if(!end)throw new InputError("송금 준비 기준일을 입력하세요.");
 const location=projectId==="__company"?{projectId:null,companyExpense:true}:projectId?{projectId}:{};
 const [documents,monthly,missing]=await Promise.all([
  db.tradeDocument.findMany({where:{companyId:COMPANY_ID,kind:"PURCHASE",voidedAt:null,...location,settledAmount:{lt:db.tradeDocument.fields.grossAmount},OR:[{dueDate:null},{dueDate:{lte:end}}]},include:{partner:true,project:true},orderBy:[{dueDate:"asc"},{reference:"asc"}]}),
  db.monthlyPayment.findMany({where:{template:{companyId:COMPANY_ID},voidedAt:null,documentId:null,dueDate:{lte:end},...location},include:{partner:true,project:true,cashPlan:{include:{settlements:true}},template:true},orderBy:[{dueDate:"asc"},{title:"asc"}]}),
  db.recurringPaymentTemplate.count({where:{companyId:COMPANY_ID,active:true,startMonth:{lte:until.slice(0,7)},OR:[{endMonth:null},{endMonth:{gte:until.slice(0,7)}}],months:{none:{period:until.slice(0,7)}},...location}}),
 ]);
 const rows:TransferPreparationRow[]=[];let nonTransfer=0;
 function recipient(partner:typeof documents[number]["partner"],project:string|null,companyExpense:boolean){const issues:string[]=[];if(!partner.active)issues.push("거래처 사용 중지");if(!partner.payeeBank||!partner.payeeAccount||!partner.payeeHolder)issues.push("송금 은행·계좌·예금주 미등록");else if(!partner.payeeVerifiedAt)issues.push("송금 계좌 확인 필요");if(!project&&!companyExpense)issues.push("공사 현장 또는 본사·공통 구분 필요");return issues;}
 for(const d of documents){if(d.paymentMethod==="ISSUED_NOTE"||d.paymentMethod==="OTHER"){nonTransfer++;continue;}const issues=recipient(d.partner,d.projectId,d.companyExpense);if(!d.proofConfirmed)issues.push("청구 원본·금액 확인 필요");if(d.paymentMethod!=="BANK_TRANSFER")issues.push("계좌 송금 여부 확인 필요");if(!d.dueDate)issues.push("지급기한 미지정");rows.push({id:`invoice:${d.id}`,source:"매입",reference:d.reference,description:d.title,documentDate:d.issuedDate.toISOString().slice(0,10),dueDate:d.dueDate?.toISOString().slice(0,10)??"미지정",partnerId:d.partnerId,partner:d.partner.name,project:d.project?.name??(d.companyExpense?"본사·공통":"현장 미지정"),bank:d.partner.payeeBank??"",account:d.partner.payeeAccount??"",holder:d.partner.payeeHolder??"",amount:(BigInt(d.grossAmount.toFixed(0))-BigInt(d.settledAmount.toFixed(0))).toString(),sourceLink:`/trades?edit=${d.id}`,paymentLink:`/trades?edit=${d.id}#bank-payment`,issues});}
 for(const m of monthly){const remaining=m.cashPlan?cashSummary(m.cashPlan).remaining:null;if(remaining===0n)continue;const issues=recipient(m.partner,m.projectId,m.companyExpense);if(!m.confirmed||!m.cashPlan)issues.push("이번 달 금액·중복 여부 확인 필요");rows.push({id:`monthly:${m.id}`,source:"정기지급",reference:`${m.template.reference} · ${m.period}`,description:m.title,documentDate:`${m.period} 지급월`,dueDate:(m.cashPlan?.plannedDate??m.dueDate).toISOString().slice(0,10),partnerId:m.partnerId,partner:m.partner.name,project:m.project?.name??(m.companyExpense?"본사·공통":"현장 미지정"),bank:m.partner.payeeBank??"",account:m.partner.payeeAccount??"",holder:m.partner.payeeHolder??"",amount:remaining?.toString()??m.amount?.toFixed(0)??"",sourceLink:`/recurring-payments?period=${m.period}&confirm=${m.id}`,paymentLink:m.cashPlanId?`/cash?process=${m.cashPlanId}`:`/recurring-payments?period=${m.period}&confirm=${m.id}`,issues});}
 if(!projectId){
  const payrolls=await db.payrollPayment.findMany({where:{employee:{companyId:COMPANY_ID},voidedAt:null,dueDate:{lte:end}},include:{employee:true,cashPlan:{include:{settlements:true}}},orderBy:[{dueDate:"asc"},{id:"asc"}]});
  const months=new Map<string,Awaited<ReturnType<typeof laborMonth>>>();
  for(const p of payrolls){const remaining=cashSummary(p.cashPlan).remaining;if(remaining===0n)continue;const issues:string[]=[];const e=p.employee;
   if(!e.payeeBank||!e.payeeAccount||!e.payeeHolder)issues.push("급여 송금 은행·계좌·예금주 미등록");else if(!e.payeeVerifiedAt)issues.push("급여 수취계좌 확인 필요");
   let sites="본사·공통";
   try{let month=months.get(p.period);if(!month){month=await laborMonth(db,p.period);months.set(p.period,month);}const basis=await payrollBasis(db,p.period,e.id,month);if(basis.basis!==p.basis)issues.push("급여 확인 후 출역·계약 변경 · 재확인 필요");if(basis.daily)sites=`직원 통합 · ${[...new Set(basis.daily.lines.map(r=>`${r.project.code} ${r.project.name}`))].join(" / ")}`;}catch{issues.push("급여 기준 재확인 필요");}
   const sourceLink=`/payroll-payments?period=${p.period}&employee=${e.id}`;
   rows.push({id:`payroll:${p.id}`,source:"급여",reference:`${e.code} · ${p.period}`,description:`${p.period} ${e.name} 실지급 급여`,documentDate:`${p.period} 급여월`,dueDate:p.dueDate.toISOString().slice(0,10),partnerId:`employee:${e.id}`,partner:e.name,project:sites,bank:e.payeeBank??"",account:e.payeeAccount??"",holder:e.payeeHolder??"",amount:remaining.toString(),sourceLink,paymentLink:`/cash?process=${p.cashPlanId}`,recipientLink:`/employees?edit=${e.id}`,issues});
  }
 }
 return{ready:rows.filter(r=>!r.issues.length),held:rows.filter(r=>r.issues.length),nonTransfer,missingTemplates:missing};
}

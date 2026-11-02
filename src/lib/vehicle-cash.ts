import type {Prisma} from "@/generated/prisma/client";
import {koreanToday} from "./forecast";
import {COMPANY_ID} from "./constants";
import {InputError} from "./validation";
import {assertPeriodsOpen} from "./period-guard";
export async function assertBankNotVehicleMatched(tx:Prisma.TransactionClient,bankId:string){
 if(await tx.vehicleExpense.count({where:{cashPlan:{settlements:{some:{bankTransactionId:bankId,voidedAt:null}}}}}))throw new InputError("차량 고지서에 대조한 출금입니다. 차량 화면의 지급 대조를 먼저 해제하세요.");
}
// A payment match changes references only; original settlements and bank amounts remain intact.
export async function matchVehicleCash(tx:Prisma.TransactionClient,expense:{id:string;documentId:string|null;cashPlanId:string|null;payer:string;paymentStatus:string;amount:{toFixed(n:number):string};projectId:string|null;incurredDate:Date},cashPlanId:string|null){
 if(cashPlanId===expense.cashPlanId)throw new InputError("변경할 지급 실적을 선택하세요.");
 if(cashPlanId&&(expense.documentId||expense.payer!=="COMPANY"||expense.paymentStatus==="PAID"))throw new InputError("매입 미연결·회사 부담·수기 납부 확인 전의 차량 비용만 대조하세요.");
 const plans=await tx.cashPlan.findMany({where:{id:{in:[expense.cashPlanId,cashPlanId].filter((s):s is string=>Boolean(s))},companyId:COMPANY_ID},include:{vehicleExpense:true,tradeDocument:true,payroll:true,monthlyPayment:true,issuedNote:true,receivedNote:true,settlements:{where:{voidedAt:null},include:{bankTransaction:{include:{account:true,tradeLinks:{where:{voidedAt:null}}}}}}},orderBy:{id:"asc"}});
 for(const id of[expense.cashPlanId,cashPlanId].filter(Boolean))if(!plans.some(p=>p.id===id))throw new InputError("회사 지급 실적을 다시 조회하세요.");
 const banks=new Map<string,NonNullable<(typeof plans)[number]["settlements"][number]["bankTransaction"]>>();
 for(const p of plans){
  // An old closed expense can be paid in an open month. Protect the actual payment dates.
  await assertPeriodsOpen(tx,...p.settlements.map(s=>s.processedDate));
  if(p.id===cashPlanId){
   if(p.replacedById||p.vehicleExpense||p.tradeDocument||p.payroll||p.monthlyPayment||p.issuedNote||p.receivedNote||p.direction!=="OUT"||!p.completedAt||p.projectId!==expense.projectId||p.plannedAmount.toFixed(0)!==expense.amount.toFixed(0))throw new InputError("금액·공사가 같은 완료된 일반 지급 실적만 선택하세요. 다른 원본에 연결된 실적은 제외합니다.");
   const sum=p.settlements.reduce((a,s)=>a+BigInt(s.amount.toFixed(0)),0n);
   if(!p.settlements.length||sum!==BigInt(expense.amount.toFixed(0))||p.settlements.some(s=>!s.bankTransaction||s.bankTransaction.account.companyId!==COMPANY_ID||s.bankTransaction.account.currency!=="KRW"||s.bankTransaction.internalTransfer||s.bankTransaction.direction!=="OUT"||s.bankTransaction.tradeLinks.length||s.amount.lessThanOrEqualTo(0)||s.processedDate<expense.incurredDate||s.processedDate.toISOString().slice(0,10)>koreanToday()||s.processedDate.getTime()!==s.bankTransaction.tradedDate.getTime()))throw new InputError("고지서 발생일 이후의 실제 은행 출금 전액과 대조하세요. 수기 실적·차액 완료·매입에 쓴 출금은 사용할 수 없습니다.");
  }
  const changed=await tx.cashPlan.updateMany({where:{id:p.id,version:p.version},data:{version:{increment:1}}});if(changed.count!==1)throw new InputError("지급 실적이 변경되었습니다. 다시 조회하세요.");
  for(const s of p.settlements)if(s.bankTransaction)banks.set(s.bankTransaction.id,s.bankTransaction);
 }
 for(const b of [...banks.values()].sort((a,b)=>a.id.localeCompare(b.id))){const changed=await tx.bankTransaction.updateMany({where:{id:b.id,settlementVersion:b.settlementVersion},data:{settlementVersion:{increment:1}}});if(changed.count!==1)throw new InputError("은행 실적이 변경되었습니다. 다시 조회하세요.");}
 return tx.vehicleExpense.update({where:{id:expense.id},data:{cashPlanId,version:{increment:1}}});
}

export async function recordVehicleBank(tx:Prisma.TransactionClient,expense:{id:string;reference:string;title:string;category:string;documentId:string|null;cashPlanId:string|null;payer:string;paymentStatus:string;amount:{toFixed(n:number):string};projectId:string|null;incurredDate:Date},bankId:string,note:string){
 if(expense.documentId||expense.cashPlanId||expense.payer!=="COMPANY"||expense.paymentStatus==="PAID")throw new InputError("기존 매입·지급 대조가 없는 회사 부담 미납 비용만 출금을 처음 반영할 수 있습니다.");
 const bank=await tx.bankTransaction.findFirst({where:{id:bankId,account:{companyId:COMPANY_ID,currency:"KRW"},direction:"OUT",internalTransfer:false},include:{tradeLinks:{where:{voidedAt:null}},cashSettlements:{where:{voidedAt:null}}}});
 if(!bank||bank.amount.toFixed(0)!==expense.amount.toFixed(0)||bank.tradedDate<expense.incurredDate||bank.tradedDate.toISOString().slice(0,10)>koreanToday())throw new InputError("고지서 발생일 이후 같은 원화 금액의 실제 회사 출금을 선택하세요.");
 if(bank.tradeLinks.length||bank.cashSettlements.length)throw new InputError("이미 매입 또는 예산안에 반영한 출금입니다. 기존 지급 실적을 선택해 재사용하세요.");
 await assertPeriodsOpen(tx,bank.tradedDate);
 const {randomUUID}=await import("node:crypto");const {createCashPlan,settleCashPlan}=await import("./cash");
 const requestId=randomUUID(),form=new FormData();
 for(const [key,value]of Object.entries({requestId,projectId:expense.projectId??"",title:`차량 고지서 ${expense.reference} · ${expense.title}`.slice(0,200),category:expense.category==="TAX"?"세금":expense.category==="INSURANCE"?"보험료":"기타",direction:"OUT",certainty:"CONFIRMED",plannedDate:bank.tradedDate.toISOString().slice(0,10),plannedAmount:expense.amount.toFixed(0)}))form.set(key,value);
 await createCashPlan(tx,form);const plan=await tx.cashPlan.findUniqueOrThrow({where:{requestId}});
 const actual=new FormData();for(const [key,value]of Object.entries({requestId:randomUUID(),planId:plan.id,version:"0",bankTransactionId:bank.id,amount:expense.amount.toFixed(0),note:`차량 고지서에서 최초 반영: ${note}`.slice(0,500)}))actual.set(key,value);
 await settleCashPlan(tx,actual);return matchVehicleCash(tx,expense,plan.id);
}

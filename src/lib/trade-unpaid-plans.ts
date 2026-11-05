import {createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError} from './validation';
export const UNPAID_PLAN_CANCELLATION='미정산 전액취소 · 원 예정 보존';
const PREFIX='UNPAID_PLAN:';
async function state(tx:Prisma.TransactionClient,id:string){
 const d=await tx.tradeDocument.findFirst({where:{id,companyId:COMPANY_ID},include:{cashPlan:{include:{settlements:{where:{voidedAt:null}},refundCancellation:true,refundReduction:true,vehicleExpense:true,monthlyPayment:true,payroll:true,issuedNote:true,receivedNote:true}},monthlyPayment:true,links:{where:{voidedAt:null}}}});
 if(!d||!d.settledAmount.isZero()||d.links.length||d.monthlyPayment)throw new InputError('실제 은행 지급이 없는 원본 청구와 예산안을 확인하세요.');
 const p=d.cashPlan;if(!p)return{document:d,plan:null,basis:null};
 if(p.companyId!==COMPANY_ID||p.replacedById||p.refundCancellation||p.refundReduction||p.vehicleExpense||p.monthlyPayment||p.payroll||p.issuedNote||p.receivedNote||p.settlements.length||!p.plannedAmount.equals(d.grossAmount)||p.direction!==(d.kind==='SALE'?'IN':'OUT')||p.projectId!==d.projectId||!d.proofConfirmed||!d.dueDate||p.plannedDate.getTime()!==d.dueDate.getTime()||p.certainty!=='CONFIRMED')throw new InputError('원 청구와 금액·방향·공사·실적이 일치하는 미정산 예산안을 먼저 대조하세요.');
 const basis=PREFIX+createHash('sha256').update(JSON.stringify({id:d.id,partner:d.partnerId,approval:d.taxApprovalNumber,kind:d.kind,supply:d.supplyAmount.toFixed(0),tax:d.taxAmount.toFixed(0),gross:d.grossAmount.toFixed(0),planId:p.id,project:p.projectId,plannedAmount:p.plannedAmount.toFixed(0),plannedDate:p.plannedDate.toISOString(),direction:p.direction,category:p.category,certainty:p.certainty,title:p.title,milestone:p.milestone})).digest('hex');
 return{document:d,plan:p,basis};
}
export async function prepareUnpaidPlanCancellation(tx:Prisma.TransactionClient,id:string){
 const current=await state(tx,id);if(current.plan?.completedAt)throw new InputError('이미 종료한 예산안입니다. 원 예정과 종료 사유를 먼저 확인하세요.');return current;
}
export async function closeUnpaidPlan(tx:Prisma.TransactionClient,id:string,basis:string|null){
 if(!basis)return;
 const current=await state(tx,id),p=current.plan;
 if(!p||current.basis!==basis||p.completedAt&&p.completionNote!=='매입·매출 문서 취소')throw new InputError('원 지급 예정이 변경되었습니다. 취소 원본을 다시 확인하세요.');
 const changed=await tx.cashPlan.updateMany({where:{id:p.id,companyId:COMPANY_ID,version:p.version},data:{completedAt:new Date(),completionNote:UNPAID_PLAN_CANCELLATION,version:{increment:1}}});if(changed.count!==1)throw new InputError('미정산 예산안이 변경되었습니다.');
}
export async function assertUnpaidPlanCancellation(tx:Prisma.TransactionClient,id:string,basis:string|null){
 const current=await state(tx,id),p=current.plan;
 if(!p){if(basis)throw new InputError('복원할 원 예산안 연결이 없습니다.');return;}
 if(!basis?.startsWith(PREFIX)||current.basis!==basis||!p.completedAt||p.completionNote!==UNPAID_PLAN_CANCELLATION)throw new InputError('취소 원본의 예산안·금액·은행 실적 또는 종료 사유가 변경되었습니다.');
}
export async function reopenUnpaidPlan(tx:Prisma.TransactionClient,id:string,basis:string|null){
 await assertUnpaidPlanCancellation(tx,id,basis);if(!basis)return;
 const current=await state(tx,id),p=current.plan!;
 const changed=await tx.cashPlan.updateMany({where:{id:p.id,companyId:COMPANY_ID,version:p.version,completionNote:UNPAID_PLAN_CANCELLATION},data:{completedAt:null,completionNote:null,version:{increment:1}}});if(changed.count!==1)throw new InputError('복원할 미정산 예산안이 변경되었습니다.');
}

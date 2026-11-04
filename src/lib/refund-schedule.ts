import {createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError,text,date,revision} from './validation';
import {koreanToday} from './forecast';
import {cashSummary} from './cash';
import {paidOriginal} from './trade-paid-cancellations';
import {acquirePeriodReviewLock,assertPeriodsOpen} from './period-guard';

export const REFUND_SCHEDULE_OPERATION='refundScheduleAmend';
type HistoryRecord={previous:unknown;next:unknown};
export function refundScheduleChange(row:HistoryRecord){
    const before=row.previous as Record<string,unknown>|null,after=row.next as Record<string,unknown>|null;
    if(!before||!after||typeof before.plannedDate!=='string'||typeof after.plannedDate!=='string'||typeof after.effectiveDate!=='string'||typeof after.cancellationId!=='string'||typeof before.planVersion!=='number'||!Number.isSafeInteger(before.planVersion)||before.planVersion<0||typeof after.actualAmount!=='string'||typeof after.remainingAmount!=='string')throw new InputError('환급 일정 변경 이력을 확인하세요.');
    if(!date(before.plannedDate,'이전 환급 예정일')||!date(after.plannedDate,'변경 환급 예정일')||!date(after.effectiveDate,'일정 변경일')||!/^\d{1,20}$/.test(after.actualAmount)||!/^\d{1,20}$/.test(after.remainingAmount))throw new InputError('환급 일정 변경 이력의 날짜·금액을 확인하세요.');
    return {oldDate:before.plannedDate,newDate:after.plannedDate,effectiveDate:after.effectiveDate,version:before.planVersion,cancellationId:after.cancellationId,actual:after.actualAmount,remaining:after.remainingAmount};
}
/** Later rescheduling must not rewrite an earlier month's handover snapshot. */
export function refundScheduleAt(plannedDate:Date,changes:HistoryRecord[],period:string){
    let value=plannedDate.toISOString().slice(0,10);
    for(const change of changes.map(refundScheduleChange).sort((a,b)=>b.version-a.version)){
        if(change.effectiveDate.slice(0,7)>period)value=change.oldDate;
    }
    return new Date(value);
}
export async function amendRefundSchedule(tx:Prisma.TransactionClient,data:FormData){
    const id=text(data,'cancellationId','환급 수정증빙',true,50),planId=text(data,'planId','환급 예정',true,50),version=revision(data),requestId=text(data,'requestId','요청',true,50),reason=text(data,'reason','환급 일정 변경 사유',true,300);
    const plannedDate=date(text(data,'plannedDate','변경 환급 예정일',true,10),'변경 환급 예정일')!;
    if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new InputError('환급 일정 변경 화면을 다시 여세요.');
    if(data.get('confirmed')!=='on')throw new InputError('이미 환급한 금액과 남은 환급액을 확인하세요.');
    const fingerprint=createHash('sha256').update(JSON.stringify({id,planId,version,requestId,reason,plannedDate:plannedDate.toISOString().slice(0,10)})).digest('hex');
    await acquirePeriodReviewLock(tx);
    const replay=await tx.financeChange.findUnique({where:{requestId}});
    if(replay){if(replay.companyId!==COMPANY_ID||replay.operation!==REFUND_SCHEDULE_OPERATION||replay.entityId!==planId||replay.fingerprint!==fingerprint)throw new InputError('다른 내용으로 사용한 환급 일정 변경 요청입니다.');return id;}
    const c=await tx.tradeCancellation.findFirst({where:{id,companyId:COMPANY_ID},include:{refundPlan:{include:{settlements:{where:{voidedAt:null}}}}}}),p=c?.refundPlan;
    if(!c||c.voidedAt||!p||p.id!==planId||p.companyId!==COMPANY_ID||p.version!==version||p.completedAt||p.replacedById)throw new InputError('환급 예정이 변경되었거나 완료되었습니다. 다시 조회하세요.');
    const {document:original,basis,lastPaid}=await paidOriginal(tx,c.originalDocumentId);
    if(!original.voidedAt||original.version!==c.documentVersionAfter||basis!==c.paymentBasis||!p.plannedAmount.equals(original.settledAmount)||p.direction!==(original.kind==='PURCHASE'?'IN':'OUT'))throw new InputError('취소 원본·원 지급액과 환급 예정을 먼저 대조하세요.');
    const summary=cashSummary(p),effectiveDate=koreanToday();
    if(summary.actual<0n||summary.actual>=summary.planned||summary.remaining<=0n)throw new InputError('남은 환급 금액이 있는 예정만 변경하세요.');
    if(plannedDate.toISOString().slice(0,10)<effectiveDate||plannedDate<c.issuedDate||plannedDate<lastPaid)throw new InputError('변경 예정일은 오늘·수정증빙일·원 지급일 이후로 입력하세요.');
    if(plannedDate.getTime()===p.plannedDate.getTime())throw new InputError('기존 예정일과 다른 날짜를 선택하세요.');
    // Only the current change is made; prior-period schedules are reconstructed from history.
    await assertPeriodsOpen(tx,effectiveDate,plannedDate);
    const changed=await tx.cashPlan.updateMany({where:{id:p.id,companyId:COMPANY_ID,version,completedAt:null},data:{plannedDate,version:{increment:1}}});
    if(changed.count!==1)throw new InputError('환급 실적이나 일정이 변경되었습니다. 다시 조회하세요.');
    await tx.financeChange.create({data:{companyId:COMPANY_ID,entityId:p.id,operation:REFUND_SCHEDULE_OPERATION,requestId,fingerprint,reason,previous:{plannedDate:p.plannedDate.toISOString().slice(0,10),planVersion:p.version},next:{plannedDate:plannedDate.toISOString().slice(0,10),planVersion:p.version+1,effectiveDate,cancellationId:c.id,actualAmount:summary.actual.toString(),remainingAmount:summary.remaining.toString(),plannedAmount:summary.planned.toString()}}});
    return c.id;
}

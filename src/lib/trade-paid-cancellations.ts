import {prepareVehicleSettlement,applyVehicleSettlement,prepareVehicleRestore,vehicleRestoreIdentity} from './trade-vehicle-settlement';
import {prepareCostCancellation,cancelCostSettlement,prepareCostRestore,applyCostSettlement} from './trade-cost-settlement';
import {assertStockCancellationMatch,writeStockCancellationMatches} from './stock-returns';
import {paidReductionRefundAmount} from './trade-reduction-types';
import {LATER_CANCELLATION,assertCreditBalance} from "./trade-period";
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { COMPANY_ID } from './constants';
import { InputError, text, date, revision } from './validation';
import { prepareTradeCancellation,hasActiveReissue } from './trade-cancellations';
import { normalizeBusinessNumber } from './business-number';
import { acquirePeriodReviewLock, assertPeriodsOpen } from './period-guard';
import { koreanToday } from './forecast';
const cancelledPartialPlanNote = '기지급 전액취소 · 원 지급 보존';
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function preparePaidCancellation(data: FormData, fileName: string, content: Uint8Array) {
    if (data.get('paidCancellationConfirmed') !== 'on')
        throw new InputError('기지급 전액취소 원본과 별도 환급 정산을 확인하세요.');
    const due = date(text(data, 'refundDueDate', '환급 예정일', true, 10), '환급 예정일')!;
    const copied = new FormData();
    for (const [k, v] of data.entries())
        copied.append(k, v);
    copied.set('cancellationConfirmed', 'on');
    const source = await prepareTradeCancellation(copied, fileName, content);
    if (due.toISOString().slice(0, 10) < source.row.date)
        throw new InputError('환급 예정일은 수정증빙 작성일 이후로 입력하세요.');
    return { ...source, refundDueDate: due, fingerprint: digest({ operation: 'PAID_CANCELLATION', source: source.fingerprint, due: due.toISOString() }) };
}
export async function prepareLaterPaidCancellation(data:FormData,fileName:string,content:Uint8Array){
    if(data.get('laterPaidCancellationConfirmed')!=='on')throw new InputError('다른 달 원본 보존과 실제 지급액의 별도 환급 정산을 확인하세요.');
    const copied=new FormData();for(const[k,v]of data.entries())copied.append(k,v);copied.set('paidCancellationConfirmed','on');
    const source=await preparePaidCancellation(copied,fileName,content);
    return {...source,fingerprint:digest({operation:LATER_CANCELLATION,source:source.fingerprint})};
}
export async function paidOriginal(tx: Prisma.TransactionClient, id: string) {
    const d = await tx.tradeDocument.findFirst({ where: { id, companyId: COMPANY_ID }, include: { reductions:{where:{voidedAt:null},orderBy:{beforeGross:"desc"},take:1,select:{businessNumber:true}},partner: true, workbookSource: true, monthlyPayment: true, links: { where: { voidedAt: null }, include: { transaction: { include: { account: true } } } }, cashPlan: { include: { settlements: { where: { voidedAt: null } } } } } });
    const credits=await tx.tradeReduction.findMany({where:{companyId:COMPANY_ID,originalDocumentId:id,voidedAt:null,refundPlanId:{not:null}},include:{refundPlan:true},orderBy:{id:'asc'}});
    if(credits.some(r=>!r.refundPlan||r.refundPlan.companyId!==COMPANY_ID||r.refundPlan.plannedAmount.toFixed(0)!==paidReductionRefundAmount(r).toString()))throw new InputError('선행 감액의 환급 정산을 먼저 대조하세요.');
    const paidAmount=d?.settledAmount.minus(credits.reduce((v,r)=>v+BigInt(r.refundPlan!.plannedAmount.toFixed(0)),0n).toString());
    if (!d || d.monthlyPayment || !d.proofConfirmed || d.grossAmount.lte(0) || d.settledAmount.lte(0) || (!paidAmount||paidAmount.lte(0)||paidAmount.gt(d.grossAmount)) || !d.links.length)
        throw new InputError('은행 지급 대조가 완료된 청구를 선택하세요. 정기 지급 연결은 별도 확인이 필요합니다.');
    if (d.links.reduce((s, l) => s + BigInt(l.amount.toFixed(0)), 0n) !== BigInt(d.settledAmount.toFixed(0)) || d.links.some(l => l.amount.lte(0) || l.transaction.account.companyId !== COMPANY_ID || l.transaction.account.currency !== 'KRW' || l.transaction.internalTransfer || l.transaction.direction !== (d.kind === 'PURCHASE' ? 'OUT' : 'IN') || l.transaction.tradedDate.toISOString().slice(0, 10) > koreanToday()))
        throw new InputError('원 지급의 은행 거래·원화·방향·합계를 먼저 확인하세요.');
    if (d.cashPlan) {
        const links = new Map(d.links.map(l => [l.id, l]));
        if (d.cashPlan.companyId!==COMPANY_ID || d.cashPlan.replacedById || d.cashPlan.direction!==(d.kind==='PURCHASE'?'OUT':'IN') || Boolean(d.cashPlan.completedAt)!==Boolean(d.voidedAt || paidAmount!.equals(d.grossAmount)) || d.voidedAt && d.settledAmount.lt(d.grossAmount) && d.cashPlan.completionNote!==cancelledPartialPlanNote || !d.cashPlan.plannedAmount.equals(d.grossAmount) || d.cashPlan.settlements.reduce((s, r) => s + BigInt(r.amount.toFixed(0)), 0n) !== BigInt(d.settledAmount.toFixed(0)) || d.cashPlan.settlements.some(s => {
            const l = s.tradeBankLinkId ? links.get(s.tradeBankLinkId) : null;
            return !l || s.bankTransactionId !== l.transactionId || !s.amount.equals(l.amount);
        }))
            throw new InputError('원래 예산안과 은행 지급액·남은 예정액을 먼저 대조하세요.');
    }
    const basis = digest({ ...(credits.length?{credits:credits.map(r=>({id:r.id,plan:r.refundPlanId,amount:r.refundPlan!.plannedAmount.toFixed(0)}))}:{}), id: d.id, partnerId: d.partnerId, approval: d.taxApprovalNumber, gross: d.grossAmount.toFixed(0), supply: d.supplyAmount.toFixed(0), tax: d.taxAmount.toFixed(0), cashPlanId: d.cashPlanId, links: d.links.map(l => ({ id: l.id, bank: l.transactionId, amount: l.amount.toFixed(0), date: l.transaction.tradedDate.toISOString() })).sort((a, b) => a.id.localeCompare(b.id)) });
    return { document: d, paidAmount:paidAmount!, basis, lastPaid: new Date(Math.max(...d.links.map(l => l.transaction.tradedDate.getTime()))) };
}
async function assertNoCostLinks(tx: Prisma.TransactionClient, id: string, cutoff?:Date,stockVerified=false,vehicleVerified=false,costVerified=false) {
    if(cutoff)await assertCreditBalance(tx,id,cutoff);
    if (!cutoff && await tx.tradeReduction.count({ where: { originalDocumentId: id, companyId: COMPANY_ID, voidedAt: null } }) || !costVerified && await tx.sourceCostReview.count({ where: { companyId: COMPANY_ID, sourceType: 'TRADE', sourceId: id, active: true } }) || !stockVerified && await tx.stockMovement.count({ where: { documentId: id, voidedAt: null } }) || !vehicleVerified && await tx.vehicleExpense.count({ where: { documentId: id } }))
        throw new InputError('부분 감액·자재·차량·원가 배부 연결이 있어 별도 정산이 필요합니다.');
}
export async function registerPaidCancellation(tx: Prisma.TransactionClient, source: Awaited<ReturnType<typeof preparePaidCancellation>>,scope:'SAME'|'LATER'='SAME') {
    await acquirePeriodReviewLock(tx);
    const replay = await tx.tradeCancellation.findUnique({ where: { requestId: source.requestId } });
    if (replay) {
        if (replay.companyId !== COMPANY_ID || replay.fingerprint !== source.fingerprint)
            throw new InputError('다른 기지급 취소로 사용한 요청입니다.');
        return { id: replay.originalDocumentId, cancellationId: replay.id, replayed: true };
    }
    const { document: d, paidAmount, basis, lastPaid } = await paidOriginal(tx, source.originalDocumentId), { row } = source;
    if (source.refundDueDate < lastPaid)
        throw new InputError('환급 예정일은 원 지급일 이후로 입력하세요.');
    if (d.voidedAt || d.version !== source.originalVersion)
        throw new InputError('원본 청구가 변경되었거나 취소되었습니다.');
    if(scope==='LATER')await assertPeriodsOpen(tx,row.date,source.refundDueDate);else await assertPeriodsOpen(tx, d.issuedDate, row.date, source.refundDueDate, ...d.links.map(l => l.transaction.tradedDate));
    if (row.date < d.issuedDate.toISOString().slice(0, 10))
        throw new InputError('수정증빙 작성일은 원본 작성일 이후여야 합니다.');
    if(scope==='LATER'){if(d.issuedDate.toISOString().slice(0,7)>=row.date.slice(0,7))throw new InputError('수정 작성월보다 이전 달의 원본을 선택하세요.');}
    else if (d.issuedDate.toISOString().slice(0, 7) !== row.date.slice(0, 7))throw new InputError('다른 달의 수정증빙은 별도 기간 정산이 필요합니다.');
    if (d.kind !== row.kind || d.evidence !== 'TAX_INVOICE' || !d.taxApprovalNumber || d.taxApprovalNumber === row.approval || BigInt(d.grossAmount.toFixed(0)) !== -BigInt(row.gross) || BigInt(d.supplyAmount.toFixed(0)) !== -BigInt(row.supply) || BigInt(d.taxAmount.toFixed(0)) !== -BigInt(row.tax))
        throw new InputError('원본 구분·서로 다른 승인번호·공급가액·세액·합계 전액을 대조하세요.');
    const cells = Array.isArray(d.workbookSource?.cells) ? d.workbookSource.cells : [], business = normalizeBusinessNumber(String(cells[row.kind === 'SALE' ? 9 : 4] ?? d.reductions[0]?.businessNumber ?? d.partner.businessNumber ?? ''));
    if (!business || business !== normalizeBusinessNumber(row.raw[row.kind === 'SALE' ? 9 : 4] ?? ''))
        throw new InputError('원본과 수정증빙 사업자번호가 다릅니다.');
    const stockVerified=await assertStockCancellationMatch(tx,d.id,source.stockReturnIds,row.supply);
    const vehicleSettlement=await prepareVehicleSettlement(tx,d.id,source.vehicleCost,scope,row.date);
    const costCancellation=await prepareCostCancellation(tx,d.id,source.costAllocation,scope,row.date);let costApplied=costCancellation&&!costCancellation.period?await cancelCostSettlement(tx,d.id,costCancellation,source.requestId,source.reason):null;
    await assertNoCostLinks(tx,d.id,new Date(row.date),stockVerified,Boolean(vehicleSettlement),Boolean(costCancellation));

    if (await tx.tradeDocument.count({ where: { companyId: COMPANY_ID, taxApprovalNumber: row.approval, voidedAt: null } }) || await tx.tradeReduction.count({ where: { companyId: COMPANY_ID, taxApprovalNumber: row.approval, voidedAt: null } }) || await tx.tradeCancellation.count({ where: { companyId: COMPANY_ID, voidedAt: null, OR: [{ originalDocumentId: d.id }, { taxApprovalNumber: row.approval }, { originalApproval: row.approval }] } }))
        throw new InputError('이미 사용한 수정증빙 또는 취소 원본입니다.');
    const changed = await tx.tradeDocument.updateMany({ where: { id: d.id, companyId: COMPANY_ID, version: d.version, voidedAt: null, settledAmount: d.settledAmount }, data: { voidedAt: new Date(), voidReason: `기지급 전액취소 · 환급 별도: ${source.reason}`.slice(0, 300), version: { increment: 1 } } });
    if (changed.count !== 1)
        throw new InputError('원본 지급이 변경되었습니다.');
    // Cancel only the unpaid remainder. The original planned amount and bank history stay intact.
    if (d.cashPlan && d.settledAmount.lt(d.grossAmount)) {
        const closed=await tx.cashPlan.updateMany({where:{id:d.cashPlan.id,companyId:COMPANY_ID,version:d.cashPlan.version,completedAt:null},data:{completedAt:new Date(),completionNote:cancelledPartialPlanNote,version:{increment:1}}});
        if(closed.count!==1)throw new InputError('원 지급 예정이 변경되었습니다. 다시 조회하세요.');
    }
    const plan = await tx.cashPlan.create({ data: { companyId: COMPANY_ID, projectId: d.projectId, direction: d.kind === 'PURCHASE' ? 'IN' : 'OUT', certainty: 'CONFIRMED', title: `${d.kind === 'PURCHASE' ? '매입 환급 회수' : '매출 환급 지급'} ${d.reference} · ${d.title}`.slice(0, 200), category: '기타', plannedDate: source.refundDueDate, plannedAmount: paidAmount } });
    const file = await tx.tradeWorkbookFile.upsert({ where: { companyId_checksum: { companyId: COMPANY_ID, checksum: source.checksum } }, create: { companyId: COMPANY_ID, checksum: source.checksum, fileName: source.fileName, content: Buffer.from(source.content) }, update: {}, select: { id: true } });
    const record = await tx.tradeCancellation.create({ data: { companyId: COMPANY_ID, originalDocumentId: d.id, originalApproval: d.taxApprovalNumber, taxApprovalNumber: row.approval, issuedDate: new Date(row.date), supplyAmount: row.supply, taxAmount: row.tax, grossAmount: row.gross, fileId: file.id, sheet: row.sheet, sourceRow: row.row, headers: source.headers, cells: row.raw, reason: source.reason, requestId: source.requestId, fingerprint: source.fingerprint, documentVersionAfter: d.version + 1, refundPlanId: plan.id, paymentBasis: basis } });
    const vehicleApplied=vehicleSettlement?await applyVehicleSettlement(tx,vehicleSettlement,vehicleSettlement.amount.toFixed(0),true,source.requestId,source.reason,'tradeCancellation',{cancellationId:record.id}):null;
    if(costCancellation?.period)costApplied=await cancelCostSettlement(tx,d.id,costCancellation,source.requestId,source.reason,record.id);
    if(stockVerified)await writeStockCancellationMatches(tx,source.stockReturnIds,record.id,source.requestId,source.reason);
    await tx.tradeDocumentChange.create({ data: { documentId: d.id, requestId: source.requestId, fingerprint: source.fingerprint, previous: { voided: false, settledAmount: d.settledAmount.toFixed(0) }, next: { voided: true, cancellationId: record.id,...(vehicleApplied?{vehicleSettlement:vehicleApplied}:{}),...(costApplied?{costSettlement:costApplied}:{}), refundPlanId: plan.id, paymentPreserved: true, unpaidCancelled:d.grossAmount.gt(paidAmount)?d.grossAmount.minus(paidAmount).toFixed(0):'0', refundAmount:paidAmount.toFixed(0) }, reason: source.reason } });
    await tx.tradeCancellationChange.create({ data: { cancellationId: record.id, requestId: source.requestId, fingerprint: source.fingerprint, operation: scope==='LATER'?LATER_CANCELLATION:'REGISTER_PAID', reason: source.reason } });
    return { id: d.id, cancellationId: record.id, replayed: false };
}
export async function undoPaidCancellation(tx: Prisma.TransactionClient, data: FormData) {
    const id = text(data, 'cancellationId', '취소 증빙', true, 50), version = revision(data), requestId = text(data, 'requestId', '요청', true, 50), reason = text(data, 'reason', '등록 정정 사유', true, 300);
    if (!/^[0-9a-f-]{36}$/i.test(requestId))
        throw new InputError('정정 화면을 다시 여세요.');
    const fingerprint = digest({ id, version, reason, operation: 'UNDO',...vehicleRestoreIdentity(data),...(data.has('costReviewVersion')?{costReviewVersion:data.get('costReviewVersion'),costRestoreConfirmed:data.get('costRestoreConfirmed')}: {}) });
    await acquirePeriodReviewLock(tx);
    const replay = await tx.tradeCancellationChange.findUnique({ where: { requestId }, include: { cancellation: true } });
    if (replay) {
        if (replay.cancellation.companyId !== COMPANY_ID || replay.fingerprint !== fingerprint)
            throw new InputError('다른 정정 내용으로 사용한 요청입니다.');
        return id;
    }
    const c = await tx.tradeCancellation.findFirst({ where: { id, companyId: COMPANY_ID }, include: { stockReturns:true, refundPlan: { include: { settlements: { where: { voidedAt: null } } } } } });
    if (!c || c.voidedAt || c.version !== version || !c.refundPlan || c.refundPlan.settlements.length || c.refundPlan.replacedById)
        throw new InputError('이미 환급한 실적이나 변경 이력이 있습니다. 환급 내역을 먼저 확인하세요.');
    const { document: d, paidAmount, basis } = await paidOriginal(tx, c.originalDocumentId);
    if(await tx.tradeCancellationChange.count({where:{cancellationId:c.id,operation:LATER_CANCELLATION}}))await assertPeriodsOpen(tx,c.issuedDate,c.refundPlan.plannedDate);else await assertPeriodsOpen(tx, d.issuedDate, c.issuedDate, c.refundPlan.plannedDate, ...d.links.map(l => l.transaction.tradedDate));
    if (await hasActiveReissue(tx,c.id))
        throw new InputError('재발급 이력을 먼저 확인하세요.');
    if (await tx.tradeDocument.count({ where: { companyId: COMPANY_ID, taxApprovalNumber: c.originalApproval, voidedAt: null, id: { not: d.id } } }))
        throw new InputError('같은 승인번호의 활성 청구가 있습니다.');
    if (!d.voidedAt || d.version !== c.documentVersionAfter || basis !== c.paymentBasis || !c.refundPlan.plannedAmount.equals(paidAmount) || c.refundPlan.direction !== (d.kind === 'PURCHASE' ? 'IN' : 'OUT'))
        throw new InputError('원래 지급 내역이 변경되어 취소 등록을 복원할 수 없습니다.');
    const stockVerified=await assertStockCancellationMatch(tx,d.id,c.stockReturns.map(r=>r.id),c.supplyAmount.toFixed(0),c.id);
    const costRestore=await prepareCostRestore(tx,{...c,costRecordType:'CANCELLATION'},data);const vehicleRestore=await prepareVehicleRestore(tx,{...c,vehicleRecordType:'CANCELLATION'},data);
    await assertNoCostLinks(tx,d.id,c.issuedDate,stockVerified,Boolean(vehicleRestore),Boolean(costRestore));
    const p = await tx.cashPlan.updateMany({ where: { id: c.refundPlan.id, companyId: COMPANY_ID, version: c.refundPlan.version }, data: { completedAt: new Date(), completionNote: `기지급 취소 등록 정정: ${reason}`.slice(0, 500), version: { increment: 1 } } });
    if (p.count !== 1)
        throw new InputError('환급 일정이 변경되었습니다.');
    const changed = await tx.tradeDocument.updateMany({ where: { id: d.id, companyId: COMPANY_ID, version: d.version, voidedAt: d.voidedAt }, data: { voidedAt: null, voidReason: null, version: { increment: 1 } } });
    if (changed.count !== 1)
        throw new InputError('원본 청구가 변경되었습니다.');
    if(d.cashPlan && d.settledAmount.lt(d.grossAmount)) {
        const reopened=await tx.cashPlan.updateMany({where:{id:d.cashPlan.id,companyId:COMPANY_ID,version:d.cashPlan.version,completedAt:d.cashPlan.completedAt,completionNote:cancelledPartialPlanNote},data:{completedAt:null,completionNote:null,version:{increment:1}}});
        if(reopened.count!==1)throw new InputError('복원할 원 지급 예정이 변경되었습니다.');
    }
    if(costRestore)await applyCostSettlement(tx,d.id,costRestore,requestId,reason);if(vehicleRestore)await applyVehicleSettlement(tx,vehicleRestore.expense,vehicleRestore.amount,false,requestId,reason,'undoTradeCredit');
    await tx.tradeCancellation.update({ where: { id }, data: { voidedAt: new Date(), voidReason: reason, version: { increment: 1 } } });
    if(stockVerified)await writeStockCancellationMatches(tx,c.stockReturns.map(r=>r.id),null,requestId,reason);
    await tx.tradeDocumentChange.create({ data: { documentId: d.id, requestId, fingerprint, previous: { voided: true }, next: { voided: false, cancellationId: id, paymentPreserved: true }, reason } });
    await tx.tradeCancellationChange.create({ data: { cancellationId: id, requestId, fingerprint, operation: 'UNDO', reason } });
    return id;
}
export async function paidCancellationCandidates(db: PrismaClient | Prisma.TransactionClient, input: {
    kind: string;
    date: string;
    gross: string;
    supply: string;
    tax: string;
    businessNumber: string;
},scope:'SAME'|'LATER'='SAME') {
    const kind = input.kind === 'SALE' ? 'SALE' : input.kind === 'PURCHASE' ? 'PURCHASE' : null, issued = date(input.date, '수정일'), business = normalizeBusinessNumber(input.businessNumber);
    if (!kind || !issued || !business || ![input.gross, input.supply, input.tax].every(v => /^-?\d{1,20}$/.test(v)) || BigInt(input.gross) >= 0n || BigInt(input.supply) >= 0n || BigInt(input.tax) > 0n || BigInt(input.gross) !== BigInt(input.supply) + BigInt(input.tax))
        throw new InputError('기지급 취소 증빙을 확인하세요.');
    const from = new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth(), 1)), to = new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth() + 1, 1));
    const rows = await db.tradeDocument.findMany({ where: { companyId: COMPANY_ID, kind, evidence: 'TAX_INVOICE', voidedAt: null, proofConfirmed: true, monthlyPayment: null, taxApprovalNumber: { not: null }, grossAmount: (-BigInt(input.gross)).toString(), supplyAmount: (-BigInt(input.supply)).toString(), taxAmount: (-BigInt(input.tax)).toString(), settledAmount: {gt:0}, issuedDate: scope==='LATER'?{lt:from}:{ gte: from, lt: to }, partner: { businessNumber: business } }, select: { id: true, reference: true, title: true, version: true, taxApprovalNumber: true, issuedDate: true, settledAmount:true,grossAmount:true,reductions:{where:{companyId:COMPANY_ID,voidedAt:null,refundPlanId:{not:null}},select:{refundPlan:{select:{plannedAmount:true}}}} }, orderBy: [{ issuedDate: 'desc' }, { id: 'desc' }], take: 101 });
    if (rows.length > 100)
        throw new InputError('기지급 취소 후보가 많습니다. 원본을 먼저 확인하세요.');
    return rows.map(r => ({ ...r, issuedDate: r.issuedDate.toISOString().slice(0, 10), settledAmount:r.settledAmount.toFixed(0),grossAmount:r.grossAmount.toFixed(0),refundAmount:(BigInt(r.settledAmount.toFixed(0))-r.reductions.reduce((v,c)=>v+BigInt(c.refundPlan!.plannedAmount.toFixed(0)),0n)).toString() }));
}

import {readTaxPeriod} from '../src/lib/trade-period';
import {amendRefundSchedule,REFUND_SCHEDULE_OPERATION,refundScheduleAt} from '../src/lib/refund-schedule';
import {approvalCurrent,transferBasis} from '../src/lib/transfer-approvals';
import {koreanToday} from '../src/lib/forecast';
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../src/generated/prisma/client';
import { getDb } from '../src/lib/db';
import { COMPANY_ID } from '../src/lib/constants';
import { preparePaidCancellation, prepareLaterPaidCancellation, registerPaidCancellation, paidCancellationCandidates } from '../src/lib/trade-paid-cancellations';
import { undoTradeCancellation, replacementCandidates } from '../src/lib/trade-cancellations';
import { linkTradeBank, unlinkTradeBank } from '../src/lib/trades';
import { connectTradeCashPlan } from '../src/lib/trade-cash';
import { settleCashPlan, cashSummary, voidCashSettlement } from '../src/lib/cash';
import { amendCashSchedule } from '../src/lib/cash-schedule';
import { captureAccounting } from '../src/lib/accounting-delivery';
import { transferPreparation } from '../src/lib/transfer-preparation';
import { buildForecast } from '../src/lib/forecast';
const form = (v: Record<string, string>) => {
    const f = new FormData();
    Object.entries(v).forEach(([k, x]) => f.set(k, x));
    return f;
};
async function workbook(kind: 'PURCHASE' | 'SALE', issued = '2026-10-20', business = '0012345678', gross = '-1100', supply = '-1000', tax = '-100') {
    const b = new ExcelJS.Workbook(), s = b.addWorksheet(kind === 'PURCHASE' ? '매 입' : '매 출'), h = Array(43).fill('');
    h[0] = '작성일자';
    h[1] = '승인번호';
    h[14] = '합계금액';
    h[15] = '공급가액';
    h[16] = '세액';
    s.addRow(h);
    const r = Array(43).fill('');
    r[0] = issued;
    r[1] = randomUUID().replace(/-/g, '').toUpperCase();
    r[kind === 'SALE' ? 9 : 4] = business;
    r[kind === 'SALE' ? 11 : 6] = '환급 합성업체';
    r[14] = gross;
    r[15] = supply;
    r[16] = tax;
    r[18] = '수정세금계산서';
    s.addRow(r);
    return new Uint8Array(await b.xlsx.writeBuffer());
}
async function setup(tx: Prisma.TransactionClient, kind: 'PURCHASE' | 'SALE', plan = true, paid = '1100', issued='2026-10-01', paidDate='2026-10-10') {
    await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: '합성 환급 회사' }, update: {} });
    const partner = await tx.partner.create({ data: { companyId: COMPANY_ID, code: randomUUID(), name: '환급 합성업체', businessNumber: '0012345678', type: 'BOTH', payeeBank: '합성은행', payeeAccount: '12345', payeeHolder: '환급 합성업체', payeeVerifiedAt: new Date() } }), account = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: '검증은행', label: randomUUID() } });
    const d = await tx.tradeDocument.create({ data: { companyId: COMPANY_ID, partnerId: partner.id, kind, reference: randomUUID(), title: '합성 기지급 원본', companyExpense: true, taxApprovalNumber: randomUUID().replace(/-/g, '').toUpperCase(), issuedDate: new Date(issued), dueDate: new Date('2026-10-10'), supplyAmount: '1000', taxAmount: '100', grossAmount: '1100', taxKind: 'TAXABLE', evidence: 'TAX_INVOICE', proofConfirmed: true, inputVatReview: 'DEDUCTIBLE', paymentMethod: 'BANK_TRANSFER', note: '합성 검증' } });
    if (plan)
        await connectTradeCashPlan(tx, form({ documentId: d.id, version: '0', requestId: randomUUID(), mode: 'NEW', reason: '합성 원 지급 예정', noDuplicate: 'on' }));
    const bank = await tx.bankTransaction.create({ data: { accountId: account.id, tradedDate: new Date(paidDate), direction: kind === 'PURCHASE' ? 'OUT' : 'IN', amount: paid, bankBalance: '99999999999999999999', description: '합성 원 지급' } });
    const current = () => tx.tradeDocument.findUniqueOrThrow({ where: { id: d.id } });
    await linkTradeBank(tx, form({ documentId: d.id, version: String((await current()).version), transactionId: bank.id, requestId: randomUUID(), amount: paid, note: '합성 실제 지급액 대조' }));
    const prepare = async (bytes = undefined as Uint8Array | undefined, overrides = {} as Record<string, string>) => preparePaidCancellation(form({ requestId: randomUUID(), sheet: kind === 'PURCHASE' ? '매 입' : '매 출', sourceRow: '2', originalDocumentId: d.id, version: String((await current()).version), reason: '동월 계약 해제 및 환급 확인', paidCancellationConfirmed: 'on', refundDueDate: '2026-11-02', ...overrides }), '환급.xlsx', bytes ?? await workbook(kind));
    return { partner, account, d, bank, current, prepare };
}
async function rollbackTest(work: (tx: Prisma.TransactionClient) => Promise<void>) {
    const db = getDb(), rollback = new Error('REFUND_ROLLBACK');
    try {
        await assert.rejects(db.$transaction(async (tx) => {
            await work(tx);
            throw rollback;
        }, { timeout: 60000 }), e => e === rollback);
    }
    finally {
        await db.$disconnect();
    }
}
test('기지급 매입·매출 전액취소는 원 지급을 보존하고 다음 달 부분 환급·정정·회계·송금 잔액을 연결한다', async () => rollbackTest(async (tx) => {
    for (const kind of ['PURCHASE', 'SALE'] as const) {
        const x = await setup(tx, kind), beforeBanks = await tx.bankTransaction.count(), source = await x.prepare(), saved = await registerPaidCancellation(tx, source);
        assert.deepEqual(await registerPaidCancellation(tx, source), { ...saved, replayed: true });
        const c = await tx.tradeCancellation.findUniqueOrThrow({ where: { id: saved.cancellationId } }), getPlan = () => tx.cashPlan.findUniqueOrThrow({ where: { id: c.refundPlanId! }, include: { settlements: true } });
        let p = await getPlan();
        assert.equal(p.direction, kind === 'PURCHASE' ? 'IN' : 'OUT');
        assert.equal(cashSummary(p).remaining, 1100n);
        assert.equal((await x.current()).settledAmount.toFixed(0), '1100');
        assert.ok((await x.current()).voidedAt);
        assert.equal(await tx.bankTransaction.count(), beforeBanks);
        assert.equal((await tx.bankTransaction.findUniqueOrThrow({ where: { id: x.bank.id } })).bankBalance?.toFixed(0), '99999999999999999999');
        const link = await tx.tradeBankLink.findFirstOrThrow({ where: { documentId: x.d.id, voidedAt: null } });
        await assert.rejects(unlinkTradeBank(tx, form({ linkId: link.id, version: String((await x.current()).version), reason: '원 지급 해제 시도' })), /원 지급/);
        assert.ok((await replacementCandidates(tx, { kind, date: '2026-10-20', businessNumber: '0012345678' })).some(v => v.id === c.id));
        await assert.rejects(amendCashSchedule(tx, form({ planId: p.id, version: String(p.version), requestId: randomUUID(), reason: '환급 금액 변경 시도' })), /원본에 연결/);
        const refund = await tx.bankTransaction.create({ data: { accountId: x.account.id, tradedDate: new Date('2026-11-01'), direction: p.direction, amount: '400', description: '합성 첫 환급' } });
        const settle = () => form({ planId: p.id, version: String(p.version), requestId: randomUUID(), bankTransactionId: refund.id, amount: '400', note: '수정 원본 및 환급 통장 대조' });
        const octoberBefore = await captureAccounting(tx, '2026-10');
        const first = settle();
        await settleCashPlan(tx, first);
        await settleCashPlan(tx, first);
        p = await getPlan();
        assert.equal(cashSummary(p).remaining, 700n);
        const forecast = buildForecast({ baseDate: new Date('2026-10-31'), amount: { toFixed: () => '10000' } }, [p], 3);
        assert.equal(forecast.rows.at(-1)?.confirmedBalance, kind === 'PURCHASE' ? 11100n : 8900n);
        const transfers = await transferPreparation(tx, '2026-11-03');
        assert.equal(transfers.ready.find(r => r.id === `refund:${c.id}`)?.amount, kind === 'SALE' ? '700' : undefined);
        assert.equal((await captureAccounting(tx, '2026-10')).digest, octoberBefore.digest);
        const archive = await captureAccounting(tx, '2026-11'), table = archive.snapshot.tables.find(t => t.title === '기지급 취소 환급 정산')!;
        assert.ok(table.rows.some(r => r[0] === c.id && r[8] === '400' && r[9] === '700' && r[10] === '400'));
        assert.ok(archive.snapshot.attachments?.some(f => f.kind === 'TRADE_WORKBOOK' && f.checksum === source.checksum));
        const undo = () => form({ cancellationId: c.id, version: '0', requestId: randomUUID(), reason: '합성 잘못 연결한 취소 정정' });
        await assert.rejects(undoTradeCancellation(tx, undo()), /환급한 실적/);
        const last = await tx.bankTransaction.create({ data: { accountId: x.account.id, tradedDate: new Date('2026-11-02'), direction: p.direction, amount: '700', description: '합성 잔여 환급' } });
        await settleCashPlan(tx, form({ planId: p.id, version: String(p.version), requestId: randomUUID(), bankTransactionId: last.id, amount: '700', note: '잔여 환급 전액 확인' }));
        p = await getPlan();
        assert.equal(cashSummary(p).remaining, 0n);
        assert.ok(p.completedAt);
        assert.equal((await transferPreparation(tx, '2026-11-03')).ready.some(r => r.id === `refund:${c.id}`), false);
        for (const bankId of [last.id, refund.id]) {
            const s = await tx.cashSettlement.findFirstOrThrow({ where: { planId: p.id, bankTransactionId: bankId, voidedAt: null } });
            await voidCashSettlement(tx, form({ settlementId: s.id, version: String(p.version), reason: '합성 환급 대조 정정' }));
            p = await getPlan();
        }
        assert.equal(cashSummary(p).remaining, 1100n);
        const u = undo();
        await undoTradeCancellation(tx, u);
        await undoTradeCancellation(tx, u);
        assert.equal((await x.current()).voidedAt, null);
        assert.equal((await x.current()).settledAmount.toFixed(0), '1100');
        assert.equal((await tx.tradeBankLink.findUniqueOrThrow({ where: { id: link.id } })).voidedAt, null);
        assert.equal(cashSummary(await getPlan()).remaining, 0n);
    }
}));
test('환급은 수기·초과·차액 임의완료·지급 전 은행·다른 원본 승계를 차단한다', async () => rollbackTest(async (tx) => {
    const x = await setup(tx, 'SALE', false), saved = await registerPaidCancellation(tx, await x.prepare()), c = await tx.tradeCancellation.findUniqueOrThrow({ where: { id: saved.cancellationId } }), p = await tx.cashPlan.findUniqueOrThrow({ where: { id: c.refundPlanId! } });
    const values = { planId: p.id, version: '0', requestId: randomUUID(), processedDate: '2026-11-01', amount: '400', note: '합성 환급 확인' };
    await assert.rejects(settleCashPlan(tx, form(values)), /실제 은행/);
    const bank = await tx.bankTransaction.create({ data: { accountId: x.account.id, tradedDate: new Date('2026-11-01'), direction: 'OUT', amount: '1200', description: '환급 보호 합성' } });
    await assert.rejects(settleCashPlan(tx, form({ ...values, bankTransactionId: bank.id, amount: '1200' })), /잔액/);
    await assert.rejects(settleCashPlan(tx, form({ ...values, bankTransactionId: bank.id, finish: 'on' })), /임의 완료/);
    await tx.bankTransaction.update({ where: { id: bank.id }, data: { tradedDate: new Date('2026-10-05') } });
    await assert.rejects(settleCashPlan(tx, form({ ...values, bankTransactionId: bank.id })), /원 지급일/);
    await tx.bankTransaction.update({ where: { id: bank.id }, data: { tradedDate: new Date('2026-11-01') } });
    const other = await tx.tradeDocument.create({ data: { companyId: COMPANY_ID, partnerId: x.partner.id, kind: 'PURCHASE', reference: randomUUID(), title: '다른 합성 청구', issuedDate: new Date('2026-10-01'), dueDate: new Date('2026-11-02'), supplyAmount: '1000', taxAmount: '100', grossAmount: '1100', taxKind: 'TAXABLE', evidence: 'TAX_INVOICE', proofConfirmed: true, paymentMethod: 'BANK_TRANSFER', note: '' } });
    await assert.rejects(connectTradeCashPlan(tx, form({ documentId: other.id, version: '0', requestId: randomUUID(), mode: 'EXISTING', cashPlanId: p.id, reason: '환급 일정 승계 시도', noDuplicate: 'on' })), /일반 예정/);
    await settleCashPlan(tx, form({ ...values, bankTransactionId: bank.id }));
    await assert.rejects(linkTradeBank(tx, form({ documentId: other.id, version: '0', requestId: randomUUID(), transactionId: bank.id, amount: '100', note: '환급 은행 이중 연결 시도' })), /환급에 연결/);
    assert.equal(await tx.cashSettlement.count({ where: { planId: p.id, voidedAt: null } }), 1);
}));
test('기지급 취소는 전액·사업자·작성월·마감 및 실제 원 지급 연결을 검증한다', async () => rollbackTest(async (tx) => {
    const x = await setup(tx, 'PURCHASE');
    await assert.rejects(x.prepare(undefined, { paidCancellationConfirmed: '' }), /별도 환급/);
    await assert.rejects(registerPaidCancellation(tx, await x.prepare(await workbook('PURCHASE', '2026-09-20'))), /원본 작성일|다른 달/);
    await assert.rejects(registerPaidCancellation(tx, await x.prepare(await workbook('PURCHASE', '2026-10-20', '9999999999'))), /사업자번호/);
    await assert.rejects(registerPaidCancellation(tx, await x.prepare(await workbook('PURCHASE', '2026-10-20', '0012345678', '-550', '-500', '-50'))), /전액/);
    const source = await x.prepare();
    await tx.accountingPeriodLock.upsert({ where: { companyId_period: { companyId: COMPANY_ID, period: '2026-10' } }, create: { companyId: COMPANY_ID, period: '2026-10', packageId: '합성', digest: '합성', locked: true }, update: { locked: true } });
    await assert.rejects(registerPaidCancellation(tx, source), /마감/);
    await tx.accountingPeriodLock.update({ where: { companyId_period: { companyId: COMPANY_ID, period: '2026-10' } }, data: { locked: false } });
    const candidates = await paidCancellationCandidates(tx, { kind: 'PURCHASE', date: '2026-10-20', gross: '-1100', supply: '-1000', tax: '-100', businessNumber: '0012345678' });
    assert.ok(candidates.some(r => r.id === x.d.id));
    await tx.tradeDocument.update({ where: { id: x.d.id }, data: { settledAmount: '100' } });
    await assert.rejects(registerPaidCancellation(tx, source), /원 지급.*합계/);
    assert.equal(await tx.tradeCancellation.count({ where: { originalDocumentId: x.d.id } }), 0);
}));
test('동시 기지급 취소 요청은 환급 예정을 한 번만 만들고 동시 환급은 잔액을 초과하지 않는다', async () => {
    const db = getDb();
    let x: Awaited<ReturnType<typeof setup>> | undefined;
    let fileId = '';
    const plans: string[] = [];
    try {
        const prepared = await db.$transaction(async (tx) => {
            const base = await setup(tx, 'PURCHASE', true, '400');
            return { base, source: await base.prepare() };
        });
        x = prepared.base;
        const source = prepared.source;
        const results = await Promise.all([db.$transaction(tx => registerPaidCancellation(tx, source), { timeout: 20000 }), db.$transaction(tx => registerPaidCancellation(tx, source), { timeout: 20000 })]);
        assert.equal(results[0].cancellationId, results[1].cancellationId);
        assert.equal(results.filter(r => !r.replayed).length, 1);
        const c = await db.tradeCancellation.findUniqueOrThrow({ where: { id: results[0].cancellationId } });
        fileId = c.fileId;
        let p = await db.cashPlan.findUniqueOrThrow({ where: { id: c.refundPlanId! } });
        plans.push(p.id);
        const doc = await db.tradeDocument.findUniqueOrThrow({ where: { id: x.d.id } });
        if (doc.cashPlanId)
            plans.push(doc.cashPlanId);
        const amend=(due:string)=>form({cancellationId:c.id,planId:p.id,version:String(p.version),requestId:randomUUID(),plannedDate:due,reason:'동시 환급 일정 협의',confirmed:'on'});
        const schedules=await Promise.allSettled([db.$transaction(tx=>amendRefundSchedule(tx,amend('2026-12-10'))),db.$transaction(tx=>amendRefundSchedule(tx,amend('2026-12-15')))]);
        assert.equal(schedules.filter(r=>r.status==='fulfilled').length,1);
        p=await db.cashPlan.findUniqueOrThrow({where:{id:p.id}});
        const repeated=amend('2027-01-05');
        await Promise.all([db.$transaction(tx=>amendRefundSchedule(tx,repeated)),db.$transaction(tx=>amendRefundSchedule(tx,repeated))]);
        assert.equal(await db.financeChange.count({where:{entityId:p.id,operation:REFUND_SCHEDULE_OPERATION}}),2);
        p=await db.cashPlan.findUniqueOrThrow({where:{id:p.id}});
        const b = await db.bankTransaction.create({ data: { accountId: x.account.id, tradedDate: new Date('2026-11-01'), direction: 'IN', amount: '1400', description: '동시 합성 환급' } });
        const post = () => form({ planId: p.id, version: String(p.version), requestId: randomUUID(), bankTransactionId: b.id, amount: '300', note: '동시 환급 합성 검증' });
        const calls = await Promise.allSettled([db.$transaction(tx => settleCashPlan(tx, post())), db.$transaction(tx => settleCashPlan(tx, post()))]);
        assert.equal(calls.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(await db.cashSettlement.count({ where: { planId: p.id, voidedAt: null } }), 1);
        assert.equal(cashSummary(await db.cashPlan.findUniqueOrThrow({ where: { id: p.id }, include: { settlements: true } })).remaining, 100n);
    }
    finally {
        if (x) {
            const c = await db.tradeCancellation.findFirst({ where: { originalDocumentId: x.d.id } });
            if (c) {
                fileId = c.fileId;
                if (c.refundPlanId && !plans.includes(c.refundPlanId))
                    plans.push(c.refundPlanId);
                await db.tradeCancellationChange.deleteMany({ where: { cancellationId: c.id } });
            }
            const doc = await db.tradeDocument.findUnique({ where: { id: x.d.id } });
            if (doc?.cashPlanId && !plans.includes(doc.cashPlanId))
                plans.push(doc.cashPlanId);
            await db.financeChange.deleteMany({where:{companyId:COMPANY_ID,entityId:{in:plans},operation:REFUND_SCHEDULE_OPERATION}});
            await db.cashSettlement.deleteMany({ where: { planId: { in: plans } } });
            if (c)
                await db.tradeCancellation.delete({ where: { id: c.id } });
            await db.tradeBankLink.deleteMany({ where: { documentId: x.d.id } });
            await db.tradeDocumentChange.deleteMany({ where: { documentId: x.d.id } });
            await db.tradeDocument.delete({ where: { id: x.d.id } });
            await db.cashPlan.deleteMany({ where: { id: { in: plans } } });
            if (fileId)
                await db.tradeWorkbookFile.delete({ where: { id: fileId } });
            await db.bankTransaction.deleteMany({ where: { accountId: x.account.id } });
            await db.bankAccount.delete({ where: { id: x.account.id } });
            await db.partner.delete({ where: { id: x.partner.id } });
        }
        await db.$disconnect();
    }
});

test('일부 지급 원본 전액취소는 미지급만 종료하고 실제 지급액만 환급·복원한다', async()=>rollbackTest(async tx=>{
    for(const kind of ['PURCHASE','SALE'] as const){
        for(const hasPlan of [true,false]){
            const x=await setup(tx,kind,hasPlan,'400');
            const before=await x.current();
            const originalPlanId=before.cashPlanId;
            const getOriginalPlan=()=>tx.cashPlan.findUniqueOrThrow({where:{id:originalPlanId!},include:{settlements:true}});
            if(originalPlanId)assert.equal(cashSummary(await getOriginalPlan()).remaining,700n);
            const source=await x.prepare();
            const candidates=await paidCancellationCandidates(tx,{kind,date:'2026-10-20',gross:'-1100',supply:'-1000',tax:'-100',businessNumber:'0012345678'});
            const candidate=candidates.find(c=>c.id===x.d.id)!;
            assert.equal(candidate.settledAmount,'400');
            assert.equal(candidate.grossAmount,'1100');
            const saved=await registerPaidCancellation(tx,source);
            assert.equal((await registerPaidCancellation(tx,source)).replayed,true);
            const c=await tx.tradeCancellation.findUniqueOrThrow({where:{id:saved.cancellationId}});
            const getRefund=()=>tx.cashPlan.findUniqueOrThrow({where:{id:c.refundPlanId!},include:{settlements:true}});
            let refund=await getRefund();
            assert.equal(refund.plannedAmount.toFixed(0),'400');
            assert.equal(cashSummary(refund).remaining,400n);
            assert.equal((await x.current()).settledAmount.toFixed(0),'400');
            if(originalPlanId){const p=await getOriginalPlan();assert.equal(p.plannedAmount.toFixed(0),'1100');assert.equal(cashSummary(p).actual,400n);assert.equal(cashSummary(p).remaining,0n);assert.ok(p.completedAt);}
            const plans=originalPlanId?[await getOriginalPlan(),refund]:[refund];
            const projection=buildForecast({baseDate:new Date('2026-10-31'),amount:{toFixed:()=> '10000'}},plans,3);
            assert.equal(projection.rows.at(-1)?.confirmedBalance,kind==='PURCHASE'?10400n:9600n);
            const transfers=await transferPreparation(tx,'2026-11-03');
            assert.equal(transfers.ready.some(r=>r.id===`invoice:${x.d.id}`),false);
            assert.equal(transfers.ready.find(r=>r.id===`refund:${c.id}`)?.amount,kind==='SALE'?'400':undefined);
            const accounting=await captureAccounting(tx,'2026-11');
            const table=accounting.snapshot.tables.find(t=>t.title==='기지급 취소 환급 정산')!;
            assert.ok(table.rows.some(r=>r[0]===c.id&&r[5]==='400'&&r[7]==='400'&&r[9]==='400'&&r[14]==='1100'&&r[15]==='700'));
            const tooMuch=await tx.bankTransaction.create({data:{accountId:x.account.id,tradedDate:new Date('2026-11-01'),direction:refund.direction,amount:'500',description:'일부 지급 원본 환급 초과 검증'}});
            await assert.rejects(settleCashPlan(tx,form({planId:refund.id,version:String(refund.version),requestId:randomUUID(),bankTransactionId:tooMuch.id,amount:'500',note:'초과 환급 시도'})),/잔액/);
            const post=form({planId:refund.id,version:String(refund.version),requestId:randomUUID(),bankTransactionId:tooMuch.id,amount:'400',note:'실제 지급액 환급 확인'});
            await settleCashPlan(tx,post);refund=await getRefund();assert.ok(refund.completedAt);
            const settlement=refund.settlements.find(s=>!s.voidedAt)!;
            await voidCashSettlement(tx,form({settlementId:settlement.id,version:String(refund.version),reason:'잘못 연결한 환급 정정'}));
            await undoTradeCancellation(tx,form({cancellationId:c.id,version:'0',requestId:randomUUID(),reason:'일부 지급 취소 입력 오류 정정'}));
            assert.equal((await x.current()).voidedAt,null);
            assert.equal((await x.current()).settledAmount.toFixed(0),'400');
            assert.equal((await tx.tradeBankLink.findFirstOrThrow({where:{documentId:x.d.id,voidedAt:null}})).amount.toFixed(0),'400');
            if(originalPlanId){const reopened=await getOriginalPlan();assert.equal(reopened.completedAt,null);assert.equal(reopened.completionNote,null);assert.equal(cashSummary(reopened).remaining,700n);}
            assert.equal(cashSummary(await getRefund()).remaining,0n);
        }
    }
}));

test('일부 지급 취소는 지급액·예산안이 불일치하거나 별도로 종료된 원본을 보류한다',async()=>rollbackTest(async tx=>{
    const x=await setup(tx,'PURCHASE',true,'400');
    const d=await x.current(),source=await x.prepare();
    await tx.cashPlan.update({where:{id:d.cashPlanId!},data:{completedAt:new Date(),completionNote:'수기 차액 종료'}});
    await assert.rejects(registerPaidCancellation(tx,source),/남은 예정액/);
    await tx.cashPlan.update({where:{id:d.cashPlanId!},data:{completedAt:null,completionNote:null}});
    await tx.tradeDocument.update({where:{id:d.id},data:{settledAmount:'0'}});
    await assert.rejects(registerPaidCancellation(tx,source),/은행 지급 대조/);
    await tx.tradeDocument.update({where:{id:d.id},data:{settledAmount:'1101'}});
    await assert.rejects(registerPaidCancellation(tx,source),/은행 지급 대조/);
    assert.equal(await tx.tradeCancellation.count({where:{originalDocumentId:d.id}}),0);
    assert.equal((await x.current()).voidedAt,null);
}));

test('남은 환급 일정 변경은 실적·금액을 보존하고 이전 월 전달본과 기존 승인 기준을 보호한다',async()=>rollbackTest(async tx=>{
    const x=await setup(tx,'SALE',true,'400'),saved=await registerPaidCancellation(tx,await x.prepare());
    const c=await tx.tradeCancellation.findUniqueOrThrow({where:{id:saved.cancellationId}});
    const getPlan=()=>tx.cashPlan.findUniqueOrThrow({where:{id:c.refundPlanId!},include:{settlements:true}});
    let plan=await getPlan();
    const bank=await tx.bankTransaction.create({data:{accountId:x.account.id,tradedDate:new Date('2026-11-01'),direction:'OUT',amount:'100',description:'일정 변경 전 합성 환급'}});
    await settleCashPlan(tx,form({planId:plan.id,version:String(plan.version),requestId:randomUUID(),bankTransactionId:bank.id,amount:'100',note:'실제 환급 대조'}));plan=await getPlan();
    const october=await captureAccounting(tx,'2026-10');
    const beforeApproval=(await transferPreparation(tx,'2026-11-03')).ready.filter(r=>r.id===`refund:${c.id}`);
    assert.equal(beforeApproval.length,1);
    const bankBefore=await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}}),oldSettlements=JSON.stringify(plan.settlements);
    // A closed original issue month does not block changing the current month's remaining schedule.
    await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-10'}},create:{companyId:COMPANY_ID,period:'2026-10',packageId:'합성',digest:'합성',locked:true},update:{locked:true}});
    const input={cancellationId:c.id,planId:plan.id,version:String(plan.version),requestId:randomUUID(),plannedDate:'2026-12-15',reason:'거래처 잔여 환급 예정일 협의',confirmed:'on'};
    const change=form({...input,plannedAmount:'1',direction:'IN'});
    await amendRefundSchedule(tx,change);await amendRefundSchedule(tx,change);plan=await getPlan();
    assert.equal(plan.plannedDate.toISOString().slice(0,10),'2026-12-15');assert.equal(plan.plannedAmount.toFixed(0),'400');assert.equal(plan.direction,'OUT');assert.equal(cashSummary(plan).actual,100n);assert.equal(cashSummary(plan).remaining,300n);assert.equal(JSON.stringify(plan.settlements),oldSettlements);assert.deepEqual(await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}}),bankBefore);
    assert.equal(await tx.financeChange.count({where:{entityId:plan.id,operation:REFUND_SCHEDULE_OPERATION}}),1);
    assert.equal(await approvalCurrent(tx,'2026-11-03',beforeApproval,transferBasis(beforeApproval)),false);
    assert.equal((await captureAccounting(tx,'2026-10')).digest,october.digest);
    const november=await captureAccounting(tx,'2026-11');assert.ok(november.snapshot.tables.find(t=>t.title==='환급 예정일 변경')?.rows.some(r=>r[1]===c.id&&r[4]==='2026-11-02'&&r[5]==='2026-12-15'&&r[6]==='100'&&r[7]==='300'));
    assert.equal((await transferPreparation(tx,'2026-11-30')).ready.some(r=>r.id===`refund:${c.id}`),false);assert.equal((await transferPreparation(tx,'2026-12-31')).ready.find(r=>r.id===`refund:${c.id}`)?.amount,'300');
    const forecast=buildForecast({baseDate:new Date('2026-10-31'),amount:{toFixed:()=> '10000'}},[plan],3);assert.equal(forecast.monthlyRows.find(r=>r.month==='2026-11')?.actualOut,100n);assert.equal(forecast.monthlyRows.find(r=>r.month==='2026-12')?.expectedOut,300n);
    await assert.rejects(amendRefundSchedule(tx,form({...input,reason:'같은 요청의 다른 사유'})),/다른 내용/);
    await assert.rejects(amendRefundSchedule(tx,form({...input,requestId:randomUUID(),plannedDate:'2026-12-20'})),/변경되었거나/);
    await tx.accountingPeriodLock.update({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-10'}},data:{locked:false}});
}));

test('환급 일정은 확인·마감·과거일·완료 상태를 검증하고 변경 이력을 월별로 복원한다',async()=>rollbackTest(async tx=>{
    const x=await setup(tx,'PURCHASE',false),saved=await registerPaidCancellation(tx,await x.prepare());const c=await tx.tradeCancellation.findUniqueOrThrow({where:{id:saved.cancellationId}}),p=await tx.cashPlan.findUniqueOrThrow({where:{id:c.refundPlanId!}});
    const input={cancellationId:c.id,planId:p.id,version:String(p.version),requestId:randomUUID(),plannedDate:'2026-12-15',reason:'합성 환급 일정 협의',confirmed:'on'};
    await assert.rejects(amendRefundSchedule(tx,form({...input,confirmed:''})),/확인/);await assert.rejects(amendRefundSchedule(tx,form({...input,plannedDate:'2026-10-31'})),/오늘/);
    await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:koreanToday().slice(0,7)}},create:{companyId:COMPANY_ID,period:koreanToday().slice(0,7),packageId:'합성',digest:'합성',locked:true},update:{locked:true}});await assert.rejects(amendRefundSchedule(tx,form(input)),/마감/);await tx.accountingPeriodLock.update({where:{companyId_period:{companyId:COMPANY_ID,period:koreanToday().slice(0,7)}},data:{locked:false}});
    await tx.cashPlan.update({where:{id:p.id},data:{completedAt:new Date()}});await assert.rejects(amendRefundSchedule(tx,form(input)),/완료/);
    assert.equal(await tx.financeChange.count({where:{entityId:p.id,operation:REFUND_SCHEDULE_OPERATION}}),0);
    const history=[{previous:{plannedDate:'2026-11-02',planVersion:1},next:{plannedDate:'2026-12-15',effectiveDate:'2026-11-04',cancellationId:c.id,actualAmount:'100',remainingAmount:'300'}},{previous:{plannedDate:'2026-12-15',planVersion:4},next:{plannedDate:'2027-01-10',effectiveDate:'2026-12-20',cancellationId:c.id,actualAmount:'200',remainingAmount:'200'}}];
    assert.equal(refundScheduleAt(new Date('2027-01-10'),history,'2026-10').toISOString().slice(0,10),'2026-11-02');assert.equal(refundScheduleAt(new Date('2027-01-10'),history,'2026-11').toISOString().slice(0,10),'2026-12-15');assert.equal(refundScheduleAt(new Date('2027-01-10'),history,'2026-12').toISOString().slice(0,10),'2027-01-10');
}));

test('이전 달 일부·전액 지급 취소는 마감 원본을 보존하고 수정월 음수와 실제 지급액 환급을 연결한다',async()=>rollbackTest(async tx=>{
 for(const kind of ['PURCHASE','SALE'] as const){for(const paid of ['400','1100']){
  const x=await setup(tx,kind,true,paid,'2026-09-01','2026-09-20'),d=await x.current(),before=await captureAccounting(tx,'2026-09');
  await tx.accountingPeriodLock.upsert({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-09'}},create:{companyId:COMPANY_ID,period:'2026-09',packageId:'합성',digest:'합성',locked:true},update:{locked:true}});
  const values={requestId:randomUUID(),sheet:kind==='PURCHASE'?'매 입':'매 출',sourceRow:'2',originalDocumentId:d.id,version:String(d.version),reason:'다른 달 기지급 계약 전액취소 및 환급 확인',laterPaidCancellationConfirmed:'on',refundDueDate:'2026-11-02'};
  const source=await prepareLaterPaidCancellation(form(values),'다른달환급.xlsx',await workbook(kind,'2026-10-20'));
  const candidates=await paidCancellationCandidates(tx,{kind,date:'2026-10-20',gross:'-1100',supply:'-1000',tax:'-100',businessNumber:'0012345678'},'LATER');assert.ok(candidates.some(c=>c.id===d.id));
  const saved=await registerPaidCancellation(tx,source,'LATER');assert.equal((await registerPaidCancellation(tx,source,'LATER')).replayed,true);
  const c=await tx.tradeCancellation.findUniqueOrThrow({where:{id:saved.cancellationId}}),getRefund=()=>tx.cashPlan.findUniqueOrThrow({where:{id:c.refundPlanId!},include:{settlements:true}});let p=await getRefund();assert.equal(p.plannedAmount.toFixed(0),paid);assert.equal((await x.current()).settledAmount.toFixed(0),paid);assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);
  const original=await tx.cashPlan.findUniqueOrThrow({where:{id:d.cashPlanId!},include:{settlements:true}});assert.equal(cashSummary(original).actual,BigInt(paid));assert.equal(cashSummary(original).remaining,0n);
  const tax=await readTaxPeriod(tx,COMPANY_ID,new Date('2026-01-01'),new Date('2027-01-01'));assert.equal(tax.rows.filter(r=>r.id===d.id||r.id===c.id).reduce((v,r)=>v+BigInt(r.taxAmount.toFixed(0)),0n),0n);
  const october=await captureAccounting(tx,'2026-10');assert.ok(october.snapshot.tables.find(t=>t.title==='매입 매출')?.rows.some(r=>r[0]===c.id&&r[8]==='-1100'));
  const bank=await tx.bankTransaction.create({data:{accountId:x.account.id,tradedDate:new Date('2026-11-01'),direction:p.direction,amount:paid,description:'다른 달 실제 환급'}});
  await settleCashPlan(tx,form({planId:p.id,version:String(p.version),requestId:randomUUID(),bankTransactionId:bank.id,amount:paid,note:'다른 달 취소 환급 전액 확인'}));p=await getRefund();assert.ok(p.completedAt);assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);assert.equal((await captureAccounting(tx,'2026-10')).digest,october.digest);
  const undo=form({cancellationId:c.id,version:'0',requestId:randomUUID(),reason:'다른 달 기지급 취소 입력 정정'});await assert.rejects(undoTradeCancellation(tx,undo),/환급한/);
  await voidCashSettlement(tx,form({settlementId:p.settlements.find(s=>!s.voidedAt)!.id,version:String(p.version),reason:'환급 연결 잘못 등록하여 정정'}));await undoTradeCancellation(tx,undo);
  assert.equal((await x.current()).voidedAt,null);assert.equal((await captureAccounting(tx,'2026-09')).digest,before.digest);assert.equal(cashSummary(await tx.cashPlan.findUniqueOrThrow({where:{id:d.cashPlanId!},include:{settlements:true}})).remaining,1100n-BigInt(paid));
  await tx.accountingPeriodLock.update({where:{companyId_period:{companyId:COMPANY_ID,period:'2026-09'}},data:{locked:false}});
 }}
}));

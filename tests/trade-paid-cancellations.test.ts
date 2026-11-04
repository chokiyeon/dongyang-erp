import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../src/generated/prisma/client';
import { getDb } from '../src/lib/db';
import { COMPANY_ID } from '../src/lib/constants';
import { preparePaidCancellation, registerPaidCancellation, paidCancellationCandidates } from '../src/lib/trade-paid-cancellations';
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
async function setup(tx: Prisma.TransactionClient, kind: 'PURCHASE' | 'SALE', plan = true) {
    await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: '합성 환급 회사' }, update: {} });
    const partner = await tx.partner.create({ data: { companyId: COMPANY_ID, code: randomUUID(), name: '환급 합성업체', businessNumber: '0012345678', type: 'BOTH', payeeBank: '합성은행', payeeAccount: '12345', payeeHolder: '환급 합성업체', payeeVerifiedAt: new Date() } }), account = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: '검증은행', label: randomUUID() } });
    const d = await tx.tradeDocument.create({ data: { companyId: COMPANY_ID, partnerId: partner.id, kind, reference: randomUUID(), title: '합성 기지급 원본', companyExpense: true, taxApprovalNumber: randomUUID().replace(/-/g, '').toUpperCase(), issuedDate: new Date('2026-10-01'), dueDate: new Date('2026-10-10'), supplyAmount: '1000', taxAmount: '100', grossAmount: '1100', taxKind: 'TAXABLE', evidence: 'TAX_INVOICE', proofConfirmed: true, inputVatReview: 'DEDUCTIBLE', paymentMethod: 'BANK_TRANSFER', note: '합성 검증' } });
    if (plan)
        await connectTradeCashPlan(tx, form({ documentId: d.id, version: '0', requestId: randomUUID(), mode: 'NEW', reason: '합성 원 지급 예정', noDuplicate: 'on' }));
    const bank = await tx.bankTransaction.create({ data: { accountId: account.id, tradedDate: new Date('2026-10-10'), direction: kind === 'PURCHASE' ? 'OUT' : 'IN', amount: '1100', bankBalance: '99999999999999999999', description: '합성 원 지급' } });
    const current = () => tx.tradeDocument.findUniqueOrThrow({ where: { id: d.id } });
    await linkTradeBank(tx, form({ documentId: d.id, version: String((await current()).version), transactionId: bank.id, requestId: randomUUID(), amount: '1100', note: '합성 지급 전액 대조' }));
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
        assert.ok(!(await replacementCandidates(tx, { kind, date: '2026-10-20', businessNumber: '0012345678' })).some(v => v.id === c.id));
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
    await assert.rejects(registerPaidCancellation(tx, source), /은행 전액/);
    assert.equal(await tx.tradeCancellation.count({ where: { originalDocumentId: x.d.id } }), 0);
}));
test('동시 기지급 취소 요청은 환급 예정을 한 번만 만들고 동시 환급은 잔액을 초과하지 않는다', async () => {
    const db = getDb();
    let x: Awaited<ReturnType<typeof setup>> | undefined;
    let fileId = '';
    const plans: string[] = [];
    try {
        const prepared = await db.$transaction(async (tx) => {
            const base = await setup(tx, 'PURCHASE');
            return { base, source: await base.prepare() };
        });
        x = prepared.base;
        const source = prepared.source;
        const results = await Promise.all([db.$transaction(tx => registerPaidCancellation(tx, source), { timeout: 20000 }), db.$transaction(tx => registerPaidCancellation(tx, source), { timeout: 20000 })]);
        assert.equal(results[0].cancellationId, results[1].cancellationId);
        assert.equal(results.filter(r => !r.replayed).length, 1);
        const c = await db.tradeCancellation.findUniqueOrThrow({ where: { id: results[0].cancellationId } });
        fileId = c.fileId;
        const p = await db.cashPlan.findUniqueOrThrow({ where: { id: c.refundPlanId! } });
        plans.push(p.id);
        const doc = await db.tradeDocument.findUniqueOrThrow({ where: { id: x.d.id } });
        if (doc.cashPlanId)
            plans.push(doc.cashPlanId);
        const b = await db.bankTransaction.create({ data: { accountId: x.account.id, tradedDate: new Date('2026-11-01'), direction: 'IN', amount: '1400', description: '동시 합성 환급' } });
        const post = () => form({ planId: p.id, version: String(p.version), requestId: randomUUID(), bankTransactionId: b.id, amount: '700', note: '동시 환급 합성 검증' });
        const calls = await Promise.allSettled([db.$transaction(tx => settleCashPlan(tx, post())), db.$transaction(tx => settleCashPlan(tx, post()))]);
        assert.equal(calls.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(await db.cashSettlement.count({ where: { planId: p.id, voidedAt: null } }), 1);
        assert.equal(cashSummary(await db.cashPlan.findUniqueOrThrow({ where: { id: p.id }, include: { settlements: true } })).remaining, 400n);
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

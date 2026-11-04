import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '../../src/lib/db';
import { COMPANY_ID } from '../../src/lib/constants';
import { linkTradeBank } from '../../src/lib/trades';
import {connectTradeCashPlan} from '../../src/lib/trade-cash';
import {cashSummary} from '../../src/lib/cash';
import { captureAccounting } from '../../src/lib/accounting-delivery';
const form = (v: Record<string, string>) => {
    const f = new FormData();
    Object.entries(v).forEach(([k, x]) => f.set(k, x));
    return f;
};
for(const paid of ['1100','400'])test(`기지급 ${paid}원 매출 취소 후 환급·미지급 종료·다음 달 전달·원본 복원을 연결한다`, async ({ page, browser }) => {
    test.setTimeout(90000);
    const firstRefund=paid==='400'?'200':'400';
    const db = getDb(), tag = randomUUID().slice(0, 8), approval = `REFUND${tag.toUpperCase()}`;
    let partnerId = '', accountId = '', documentId = '', cancellationId = '', fileId = '', planId = '', packageId = '',originalPlanId='';
    const anonymous = await browser.newContext();
    try {
        expect((await anonymous.request.post('/api/trades/cancellation-candidates', { data: { mode: 'PAID_CANCEL' } })).status()).toBe(401);
    }
    finally {
        await anonymous.close();
    }
    try {
        partnerId = (await db.partner.create({ data: { companyId: COMPANY_ID, code: `RF-${tag}`, name: `환급 합성업체 ${tag}`, type: 'BOTH', businessNumber: '0012345678', payeeBank: '검증은행', payeeAccount: '123456', payeeHolder: '환급 합성업체', payeeVerifiedAt: new Date() } })).id;
        accountId = (await db.bankAccount.create({ data: { companyId: COMPANY_ID, label: `RF-${tag}`, bankName: '환급검증은행' } })).id;
        documentId = (await db.tradeDocument.create({ data: { companyId: COMPANY_ID, partnerId, kind: 'SALE', companyExpense: true, reference: `RF-${tag}`, title: `기지급 합성 환급 ${tag}`, taxApprovalNumber: `BASE${tag.toUpperCase()}`, issuedDate: new Date('2026-10-01'),dueDate:new Date('2026-10-10'),paymentMethod:'BANK_TRANSFER', supplyAmount: '1000', taxAmount: '100', grossAmount: '1100', taxKind: 'TAXABLE', evidence: 'TAX_INVOICE', proofConfirmed: true, note: '합성 환급 검증' } })).id;
        await db.$transaction(tx=>connectTradeCashPlan(tx,form({documentId,version:'0',requestId:randomUUID(),mode:'NEW',noDuplicate:'on',reason:'합성 원 수금 예정 연결'})));
        originalPlanId=(await db.tradeDocument.findUniqueOrThrow({where:{id:documentId}})).cashPlanId!;
        const original = await db.bankTransaction.create({ data: { accountId, tradedDate: new Date('2026-10-10'), direction: 'IN', amount: paid, description: `원 수금 ${tag}` } });
        await db.$transaction(tx => linkTradeBank(tx, form({ documentId, version: '1', transactionId: original.id, requestId: randomUUID(), amount: paid, note: '원 수금 합성 확인' })));
        const refundBank = await db.bankTransaction.create({ data: { accountId, tradedDate: new Date('2026-11-01'), direction: 'OUT', amount: firstRefund, description: `실제 환급 ${tag}` } });
        const b = new ExcelJS.Workbook(), s = b.addWorksheet('매 출'), h = Array(43).fill('');
        h[0] = '작성일자';
        h[1] = '승인번호';
        h[14] = '합계금액';
        h[15] = '공급가액';
        h[16] = '세액';
        s.addRow(h);
        const r = Array(43).fill('');
        r[0] = '2026-10-20';
        r[1] = approval;
        r[9] = '0012345678';
        r[11] = `환급 합성업체 ${tag}`;
        r[14] = '-1100';
        r[15] = '-1000';
        r[16] = '-100';
        r[18] = '수정세금계산서';
        s.addRow(r);
        const bytes = Buffer.from(await b.xlsx.writeBuffer());
        await page.goto('/login');
        await page.getByLabel('관리자 비밀번호').fill(process.env.ERP_ADMIN_PASSWORD!);
        await page.getByRole('button', { name: '로그인', exact: true }).click();
        await expect(page).not.toHaveURL(/\/login$/);
        await page.goto('/trades/review');
        await expect(page.getByLabel('매입매출 원본 엑셀')).toBeEnabled();
        await page.getByLabel('매입매출 원본 엑셀').setInputFiles({ name: '환급.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
        await page.getByRole('button', { name: '기지급 취소·환급 검토', exact: true }).click();
        await page.getByLabel('전액취소 원본 청구').selectOption(documentId);
        await expect(page.locator('.erp-workspace')).toContainText(`환급 예정 ${Number(paid).toLocaleString()}원`);
        await page.getByLabel('원본과 실제 은행 지급액을 대조했고, 같은 달의 전액취소 및 별도 환급 정산을 확인했습니다.').check();
        await page.getByLabel('환급 예정일').fill('2026-11-02');
        await page.getByLabel('수정증빙 처리 사유').fill('동월 계약 해제 및 환급 계좌 대조');
        await page.getByRole('button', { name: '기지급 전액취소·환급 예정 등록', exact: true }).click();
        await expect(page.getByRole('link', { name: '수정증빙 처리 내역', exact: true })).toBeVisible();
        const c = await db.tradeCancellation.findFirstOrThrow({ where: { taxApprovalNumber: approval, companyId: COMPANY_ID } });
        cancellationId = c.id;
        fileId = c.fileId;
        planId = c.refundPlanId!;
        const originalPlan=await db.cashPlan.findUniqueOrThrow({where:{id:originalPlanId},include:{settlements:true}});
        expect(originalPlan.completedAt).not.toBeNull();expect(cashSummary(originalPlan).remaining).toBe(0n);
        await page.goto('/transfer-preparation?until=2026-11-03');
        await expect(page.locator('.erp-workspace')).toContainText(`수정승인 ${approval}`);
        await page.goto(`/cash?process=${planId}`);
        await expect(page.getByRole('button', { name: '실제 처리 반영', exact: true })).toHaveCount(0);
        await expect(page.getByText('입출금 일정·예정금액 정정', { exact: true })).toHaveCount(0);
        await page.getByLabel('예정에 연결할 은행 거래').selectOption(refundBank.id);
        await page.getByLabel('은행에서 반영할 금액 (원)').fill(firstRefund);
        await page.getByLabel('은행 반영·정산 사유').fill('실제 환급 출금 400원 대조');
        await page.getByRole('button', { name: '은행 실적 반영', exact: true }).click();
        await expect(page).toHaveURL(/\/cash\?saved=1/);
        await page.goto(`/trade-cancellations?view=${c.id}`);
        await expect(page.locator('.erp-workspace')).toContainText(`환급 연결 ${firstRefund}원`);
        expect((await db.tradeDocument.findUniqueOrThrow({ where: { id: documentId } })).settledAmount.toFixed(0)).toBe(paid);
        expect((await db.tradeBankLink.findFirstOrThrow({ where: { documentId } })).voidedAt).toBeNull();
        const captured = await captureAccounting(db, '2026-11');
        expect(captured.snapshot.tables.find(t => t.title === '기지급 취소 환급 정산')?.rows.some(row => row[0] === c.id && row[9] === String(Number(paid)-Number(firstRefund)))).toBe(true);
        packageId = (await db.accountingPackage.create({ data: { companyId: COMPANY_ID, period: '2026-11', revision: 100000000 + Date.now() % 100000000, digest: captured.digest, snapshot: JSON.parse(JSON.stringify(captured.snapshot)) } })).id;
        const response = await page.context().request.get(`/api/accounting-delivery/${packageId}/bundle`);
        expect(response.status()).toBe(200);
        const zip = await JSZip.loadAsync(await response.body()), hashes = await Promise.all(Object.keys(zip.files).filter(n => n.startsWith('files/')).map(async (n) => createHash('sha256').update(await zip.file(n)!.async('nodebuffer')).digest('hex')));
        expect(hashes).toContain(createHash('sha256').update(bytes).digest('hex'));
        await page.getByText('입력 오류 정정 · 원본 청구 복원', { exact: true }).click();
        await page.getByLabel('수정증빙 등록 정정 사유').fill('잘못 연결한 합성 취소 정정');
        await page.getByRole('button', { name: '등록 정정·원본 복원 저장', exact: true }).click();
        await expect(page.locator('.erp-workspace').getByRole('alert')).toContainText('환급한 실적');
        await page.goto(`/cash?process=${planId}`);
        await page.getByText('최근 실제 처리 취소', { exact: true }).click();
        await page.getByLabel('처리 취소 사유').fill('합성 환급 대조 정정');
        await page.getByRole('button', { name: '실제 처리 취소 저장', exact: true }).click();
        await page.goto(`/trade-cancellations?view=${c.id}`);
        await page.getByText('입력 오류 정정 · 원본 청구 복원', { exact: true }).click();
        await page.getByLabel('수정증빙 등록 정정 사유').fill('합성 취소 입력 오류 정정');
        await page.getByRole('button', { name: '등록 정정·원본 복원 저장', exact: true }).click();
        await expect(page.locator('.erp-workspace').getByRole('status')).toContainText('원본 청구를 복원');
        expect((await db.tradeDocument.findUniqueOrThrow({ where: { id: documentId } })).voidedAt).toBeNull();
        const restored=await db.cashPlan.findUniqueOrThrow({where:{id:originalPlanId},include:{settlements:true}});
        expect(cashSummary(restored).remaining).toBe(BigInt(1100-Number(paid)));
        expect(restored.completedAt===null).toBe(paid!=='1100');
    }
    finally {
        if (packageId)
            await db.accountingPackage.delete({ where: { id: packageId } });
        const c = documentId ? await db.tradeCancellation.findFirst({ where: { originalDocumentId: documentId } }) : null;
        if (c) {
            cancellationId = c.id;
            fileId = c.fileId;
            planId = c.refundPlanId!;
        }
        if (planId)
            await db.cashSettlement.deleteMany({ where: { planId } });
        if (cancellationId) {
            await db.tradeCancellationChange.deleteMany({ where: { cancellationId } });
            await db.tradeCancellation.delete({ where: { id: cancellationId } });
        }
        if(originalPlanId)await db.cashSettlement.deleteMany({where:{planId:originalPlanId}});
        if (documentId) {
            await db.tradeBankLink.deleteMany({ where: { documentId } });
            await db.tradeDocumentChange.deleteMany({ where: { documentId } });
            await db.tradeDocument.delete({ where: { id: documentId } });
        }
        if (planId)
            await db.cashPlan.delete({ where: { id: planId } });
        if(originalPlanId)await db.cashPlan.delete({where:{id:originalPlanId}});
        if (fileId)
            await db.tradeWorkbookFile.delete({ where: { id: fileId } });
        if (accountId) {
            await db.bankTransaction.deleteMany({ where: { accountId } });
            await db.bankAccount.delete({ where: { id: accountId } });
        }
        if (partnerId)
            await db.partner.delete({ where: { id: partnerId } });
    }
});

import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { getDb } from "../../src/lib/db";
import { COMPANY_ID } from "../../src/lib/constants";
import { koreanToday } from "../../src/lib/forecast";

test("원본 예산안의 통장·어음 및 좌우 입출금 배치와 엑셀 출력을 확인한다", async ({ page }) => {
  test.setTimeout(60000);
  const db = getDb(); const tag = randomUUID().slice(0, 8); const title = `예산 배치 검증 ${tag}`;
  const existing = await db.company.findUnique({ where: { id: COMPANY_ID } });
  // This fixture owns a temporary company. It never replaces a user's baseline.
  if (existing) { await db.$disconnect(); test.skip(true, "기존 회사 자료를 변경하지 않습니다."); return; }
  const now = new Date(`${koreanToday()}T00:00:00Z`); const year = now.getUTCFullYear(); const month = now.getUTCMonth();
  const day = (offset: number, d: number) => new Date(Date.UTC(year, month + offset, Math.min(d, new Date(Date.UTC(year, month + offset + 1, 0)).getUTCDate())));
  const baseDate = day(0, 0); const ids: string[] = []; let partnerId = "";
  try {
    await db.company.create({ data: { id: COMPANY_ID, name: title, baselineVersion: 1 } });
    await db.cashBaseline.create({ data: { companyId: COMPANY_ID, baseDate, amount: "32000000", note: "합성 예시 · 실제 회사 자료 아님", revision: 1 } });
    for (const [i, bankName] of ["하나은행", "전북은행", "신한은행"].entries()) {
      const account = await db.bankAccount.create({ data: { companyId: COMPANY_ID, bankName, label: `예시 운영통장 ${i + 1}` } });
      await db.bankTransaction.create({ data: { accountId: account.id, tradedDate: baseDate, direction: "IN", amount: "1", bankBalance: String([20000000, 8000000, 4000000][i]), description: "합성 기초 잔액" } });
    }
    const fixtures = [
      { title: "태양광 A현장 중도금", category: "공사대금", direction: "IN" as const, certainty: "CONFIRMED" as const, plannedDate: day(0, 10), plannedAmount: "50000000" },
      { title: "전기 B현장 잔금", category: "공사대금", direction: "IN" as const, certainty: "ESTIMATED" as const, plannedDate: day(0, 25), plannedAmount: "20000000" },
      { title: "A현장 전기자재 9월분", category: "자재비", direction: "OUT" as const, certainty: "CONFIRMED" as const, plannedDate: day(0, 31), plannedAmount: "18000000" },
      { title: "상용직·일용직 급여", category: "급여", direction: "OUT" as const, certainty: "CONFIRMED" as const, plannedDate: day(0, 10), plannedAmount: "24000000" },
      { title: "현장 숙소 월세", category: "월세", direction: "OUT" as const, certainty: "CONFIRMED" as const, plannedDate: day(0, 25), plannedAmount: "1200000" },
      { title: "현장 전기요금", category: "공과금", direction: "OUT" as const, certainty: "ESTIMATED" as const, plannedDate: day(0, 25), plannedAmount: "800000" },
      { title: "계장 C현장 준공금", category: "공사대금", direction: "IN" as const, certainty: "CONFIRMED" as const, plannedDate: day(1, 20), plannedAmount: "30000000" },
      { title: "다음 달 현장 노무비", category: "노무비", direction: "OUT" as const, certainty: "ESTIMATED" as const, plannedDate: day(1, 25), plannedAmount: "26000000" },
    ];
    for (const data of fixtures) {
      const plan = await db.cashPlan.create({ data: { companyId: COMPANY_ID, ...data } }); ids.push(plan.id);
      if (data.category === "자재비") await db.cashSettlement.create({ data: { planId: plan.id, requestId: randomUUID(), amount: "6000000", processedDate: day(0, 15), note: "합성 일부 지급" } });
    }
    const partner = await db.partner.create({ data: { companyId: COMPANY_ID, code: `BUDGET-${tag}`, name: "예시 발주처", type: "CLIENT" } }); partnerId = partner.id;
    const notePlan = await db.cashPlan.create({ data: { companyId: COMPANY_ID, title: "예시 발주처 보유어음 만기", category: "수취어음", direction: "IN", certainty: "ESTIMATED", plannedDate: day(1, 15), plannedAmount: "15000000" } }); ids.push(notePlan.id);
    await db.receivedNote.create({ data: { companyId: COMPANY_ID, partnerId, reference: `예시어음-${tag}`, receivedDate: baseDate, dueDate: day(1, 15), amount: "15000000", cashPlanId: notePlan.id, note: "합성 예시" } });
    await page.goto("/login"); await page.getByLabel("관리자 비밀번호").fill(process.env.ERP_ADMIN_PASSWORD!); await page.getByRole("button", { name: "로그인", exact: true }).click(); await expect(page).not.toHaveURL(/\/login$/);
    await page.goto("/forecast"); await expect(page.getByRole("heading", { name: "입금 예정액 · 지출 예정액 · 잔액", exact: true })).toBeVisible();
    const sheet = page.locator('table[data-erp-report-title="예산안 입금·지출 대조표"]');
    await expect(sheet).toContainText("6,000,000원"); await expect(sheet).toContainText("12,000,000원");
    await expect(sheet.getByRole("columnheader")).toHaveCount(9);
    await page.screenshot({ path: "/workspace/artifacts/erp-company-budget.png", fullPage: true });
    await copyFile("/workspace/artifacts/erp-company-budget.png", "/tmp/dongyang-erp-company-budget.png");
    await page.getByRole("button", { name: "미리보기", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("예산안 입금·지출 대조표"); await page.getByRole("button", { name: "닫기", exact: true }).click();
    const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "엑셀로 저장", exact: true }).click();
    const download = await downloadEvent; const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(new Uint8Array(await readFile((await download.path())!)).buffer);
    const exported = workbook.worksheets.find(s => s.getCell("A1").text === "예산안 입금·지출 대조표")!;
    expect(exported).toBeTruthy(); expect(exported.getCell("I4").text).toBe("일말 잔액");
    expect(exported.getColumn(4).values).toContain(50000000); expect(exported.getColumn(8).values).toContain(12000000);
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/forecast"); await expect(sheet).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/forecast?months=6"); await expect(page.getByRole("heading", { name: "6개월 잔액 전망", exact: true })).toBeVisible();
    await expect(page.locator('table[data-erp-report-title="월별 자금 예산안"] tbody tr')).toHaveCount(6);
  } finally {
    await db.receivedNote.deleteMany({ where: { companyId: COMPANY_ID, reference: `예시어음-${tag}` } });
    await db.cashSettlement.deleteMany({ where: { planId: { in: ids } } }); await db.cashPlan.deleteMany({ where: { id: { in: ids } } });
    if (partnerId) await db.partner.delete({ where: { id: partnerId } });
    await db.bankTransaction.deleteMany({ where: { account: { companyId: COMPANY_ID, label: { startsWith: "예시 운영통장" } } } });
    await db.bankAccount.deleteMany({ where: { companyId: COMPANY_ID, label: { startsWith: "예시 운영통장" } } });
    await db.cashBaseline.deleteMany({ where: { companyId: COMPANY_ID, note: "합성 예시 · 실제 회사 자료 아님" } });
    await db.company.deleteMany({ where: { id: COMPANY_ID, name: title } }); await db.$disconnect();
  }
});

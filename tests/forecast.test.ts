import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForecast, saveBaseline, signedAmount } from "../src/lib/forecast";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
const money = (value: string) => ({ toFixed: () => value });
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const base = { baseDate: day("2026-10-14"), amount: money("10000000") };

test("이미 잔액에 포함된 실적을 제외하고 일부 지급·입금 확실성을 구분한다", () => {
  const plans = [
    { direction: "OUT" as const, certainty: "CONFIRMED" as const, plannedDate: day("2026-10-15"), plannedAmount: money("10000000"), completedAt: null, settlements: [{ amount: money("6000000"), processedDate: day("2026-10-15") }] },
    { direction: "IN" as const, certainty: "ESTIMATED" as const, plannedDate: day("2026-10-16"), plannedAmount: money("2000000"), completedAt: null, settlements: [] },
    { direction: "IN" as const, certainty: "CONFIRMED" as const, plannedDate: day("2026-10-17"), plannedAmount: money("3000000"), completedAt: null, settlements: [] },
    { direction: "IN" as const, certainty: "CONFIRMED" as const, plannedDate: day("2026-10-01"), plannedAmount: money("9000000"), completedAt: day("2026-10-01"), settlements: [{ amount: money("9000000"), processedDate: day("2026-10-01") }] },
  ];
  const result = buildForecast(base, plans, 3);
  assert.equal(result.rows.find((r) => r.date === "2026-10-15")?.confirmedBalance, 0n);
  assert.equal(result.rows.find((r) => r.date === "2026-10-16")?.confirmedBalance, 0n);
  assert.equal(result.rows.find((r) => r.date === "2026-10-16")?.allBalance, 2000000n);
  assert.equal(result.rows.at(-1)?.confirmedBalance, 3000000n);
  assert.equal(result.rows.at(-1)?.allBalance, 5000000n);
  assert.equal(result.endDate, "2026-12-31");
  assert.equal(result.firstShortage, null);
});

test("감액 완료 후 잔액을 이중 차감하지 않고 기한 지난 예정도 누락하지 않는다", () => {
  const result = buildForecast(base, [
    { direction: "OUT", certainty: "CONFIRMED", plannedDate: day("2026-10-15"), plannedAmount: money("10000000"), completedAt: day("2026-10-16"), settlements: [{ amount: money("9500000"), processedDate: day("2026-10-16") }] },
    { direction: "OUT", certainty: "ESTIMATED", plannedDate: day("2026-10-01"), plannedAmount: money("2000000"), completedAt: null, settlements: [] },
  ], 6);
  assert.equal(result.overdueCount, 1);
  assert.equal(result.rows.at(-1)?.confirmedBalance, -1500000n);
  assert.equal(result.firstShortage, "2026-10-16");
});

test("월말·음수 잔액과 기준 변경 이력·동시 갱신을 검증한다", async () => {
  const monthEnd = buildForecast({ baseDate: day("2026-12-31"), amount: money("-1") }, [], 3);
  assert.equal(monthEnd.firstDate, "2027-01-01"); assert.equal(monthEnd.endDate, "2027-03-31"); assert.equal(monthEnd.firstShortage, "2026-12-31");
  assert.equal(signedAmount("-50000000"), "-50000000");
  assert.throws(() => signedAmount("5,000"));
  const db = getDb(); const rollback = new Error("EXPECTED_ROLLBACK");
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      const company = await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
      const data = new FormData();
      for (const [key, value] of Object.entries({ baseDate: "2026-01-01", baseAmount: "-50000000", baseNote: "검증 기준", version: String(company.baselineVersion) })) data.set(key, value);
      await saveBaseline(tx, data);
      await assert.rejects(saveBaseline(tx, data), /변경/);
      const saved = await tx.cashBaseline.findUniqueOrThrow({ where: { companyId_revision: { companyId: COMPANY_ID, revision: company.baselineVersion + 1 } } });
      assert.equal(saved.amount.toFixed(0), "-50000000");
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.$disconnect(); }
});

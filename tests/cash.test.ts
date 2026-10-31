import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { createCashPlan, settleCashPlan, cashSummary } from "../src/lib/cash";
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

test("부분 지급·최종 감액 정산·중복 요청·잔여 예정액을 검증한다", async () => {
  const db = getDb();
  const rollback = new Error("EXPECTED_ROLLBACK");
  const requestId = randomUUID();
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
      const input = form({ direction: "OUT", certainty: "CONFIRMED", title: "검증 지급 예정", category: "자재대금", plannedDate: "2026-10-15", plannedAmount: "10000000", requestId });
      await createCashPlan(tx, input); await createCashPlan(tx, input);
      assert.equal(await tx.cashPlan.count({ where: { requestId } }), 1);
      let plan = await tx.cashPlan.findUniqueOrThrow({ where: { requestId }, include: { settlements: true } });
      const payment = form({ planId: plan.id, version: String(plan.version), requestId: randomUUID(), processedDate: "2026-10-15", amount: "6000000", note: "1차 지급" });
      await settleCashPlan(tx, payment); await settleCashPlan(tx, payment);
      plan = await tx.cashPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { settlements: true } });
      assert.equal(plan.settlements.length, 1);
      assert.deepEqual(cashSummary(plan), { planned: 10000000n, actual: 6000000n, remaining: 4000000n, difference: 4000000n, status: "일부 처리" });
      const stale = form({ planId: plan.id, version: "0", requestId: randomUUID(), processedDate: "2026-10-16", amount: "1000000" });
      await assert.rejects(settleCashPlan(tx, stale), /변경된 내역/);
      const final = form({ planId: plan.id, version: String(plan.version), requestId: randomUUID(), processedDate: "2026-10-16", amount: "3500000", finish: "on" });
      await assert.rejects(settleCashPlan(tx, final), /사유/);
      final.set("note", "최종 정산금액 조정"); await settleCashPlan(tx, final);
      plan = await tx.cashPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { settlements: true } });
      assert.deepEqual(cashSummary(plan), { planned: 10000000n, actual: 9500000n, remaining: 0n, difference: 500000n, status: "완료" });
      const extra = form({ planId: plan.id, version: String(plan.version), requestId: randomUUID(), processedDate: "2026-10-17", amount: "1" });
      await assert.rejects(settleCashPlan(tx, extra), /이미 처리/);
      payment.set("finish", "on");
      await assert.rejects(settleCashPlan(tx, payment), /이미 사용/);
      throw rollback;
    }, { timeout: 15000 }), (error: unknown) => error === rollback);
    assert.equal(await db.cashPlan.count({ where: { requestId } }), 0);
  } finally { await db.$disconnect(); }
});

test("추가 입금 없이 완료할 수 있고 초과액은 사유를 요구한다", async () => {
  const db = getDb(); const rollback = new Error("EXPECTED_ROLLBACK");
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
      const requestId = randomUUID();
      await createCashPlan(tx, form({ direction: "IN", certainty: "ESTIMATED", title: "검증 수금", category: "공사대금", plannedDate: "2026-10-20", plannedAmount: "100", requestId }));
      const plan = await tx.cashPlan.findUniqueOrThrow({ where: { requestId } });
      const payment = form({ planId: plan.id, version: "0", requestId: randomUUID(), processedDate: "2026-10-20", amount: "110" });
      await assert.rejects(settleCashPlan(tx, payment), /초과/);
      payment.set("amount", "0"); await assert.rejects(settleCashPlan(tx, payment), /추가 처리액/);
      payment.set("finish", "on"); payment.set("note", "예정 취소로 수금 없이 종료");
      await settleCashPlan(tx, payment);
      const saved = await tx.cashPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { settlements: true } });
      assert.equal(cashSummary(saved).remaining, 0n); assert.equal(cashSummary(saved).actual, 0n);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.$disconnect(); }
});

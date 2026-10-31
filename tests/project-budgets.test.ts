import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { budgetComparison, summarizeProjectBudget } from "../src/lib/project-budget-summary";
import { saveProjectBudget } from "../src/lib/project-budgets";
const form = (values: Record<string,string>) => { const f = new FormData(); Object.entries(values).forEach(([k,v]) => f.set(k,v)); return f; };
test("예산 미등록·0원·항목 초과·미완성 합계와 큰 금액을 구분한다", () => {
  assert.deepEqual(budgetComparison(null, "100"), { remaining: null, exceeded: false, rate: null });
  assert.deepEqual(budgetComparison("0", "100"), { remaining: -100n, exceeded: true, rate: null });
  assert.deepEqual(budgetComparison("300", "100"), { remaining: 200n, exceeded: false, rate: "33.3%" });
  assert.equal(budgetComparison("99999999999999999999", "99999999999999999998").remaining, 1n);
  const partial = summarizeProjectBudget({ materialBudget: "100", laborBudget: null, otherBudget: "0" }, { materialBudget: "110", laborBudget: "0", otherBudget: "0" });
  assert.equal(partial.entered, 2); assert.equal(partial.remaining, null); assert.equal(partial.exceeded, true);
  const complete = summarizeProjectBudget({ materialBudget: "100", laborBudget: "500", otherBudget: "0" }, { materialBudget: "110", laborBudget: "0", otherBudget: "0" });
  assert.equal(complete.remaining, 490n); assert.equal(complete.exceeded, true);
});
test("현장 지급예산 저장·사유·회사 범위·재요청·수정 충돌·해제 및 원본 보존을 검증한다", async () => {
  const db = getDb(); const rollback = new Error("ROLLBACK");
  try { await assert.rejects(db.$transaction(async (tx) => {
    await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
    const project = await tx.project.create({ data: { companyId: COMPANY_ID, code: randomUUID(), name: "예산 검증", contractAmount: "20000000" } });
    const account = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "하나은행", label: randomUUID() } });
    const transaction = await tx.bankTransaction.create({ data: { accountId: account.id, tradedDate: new Date("2026-10-01"), direction: "OUT", amount: "100", bankBalance: "900", description: "예산 원본 보존 검증" } });
    const data = form({ projectId: project.id, version: "0", requestId: randomUUID(), materialBudget: "10000000", laborBudget: "8000000", otherBudget: "0", reason: "최초 지급계획" });
    await saveProjectBudget(tx, data); await saveProjectBudget(tx, data);
    let saved = await tx.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(saved.budgetVersion, 1); assert.equal(saved.version, 0); assert.equal(saved.contractAmount?.toFixed(0), "20000000"); assert.equal(saved.otherBudget?.toFixed(0), "0");
    assert.equal(await tx.projectBudgetChange.count({ where: { projectId: project.id } }), 1);
    data.set("materialBudget", "999"); await assert.rejects(saveProjectBudget(tx, data), /다른 내용/);
    data.set("requestId", randomUUID()); await assert.rejects(saveProjectBudget(tx, data), /다른 화면/);
    data.set("version", "1"); data.set("materialBudget", "-1"); await assert.rejects(saveProjectBudget(tx, data), /0 이상 정수/);
    data.set("materialBudget", "1.5"); await assert.rejects(saveProjectBudget(tx, data), /0 이상 정수/);
    data.set("materialBudget", "99999999999999999999"); await saveProjectBudget(tx, data);
    const latest = await tx.projectBudgetChange.findUniqueOrThrow({ where: { requestId: data.get("requestId") as string } });
    assert.equal((latest.previous as Record<string,unknown>).materialBudget, "10000000"); assert.equal((latest.next as Record<string,unknown>).materialBudget, "99999999999999999999");
    data.set("requestId", randomUUID()); data.set("version", "2"); data.set("projectId", "not-company-project"); await assert.rejects(saveProjectBudget(tx, data), /회사에 등록/);
    data.set("projectId", project.id); data.set("materialBudget", ""); data.set("laborBudget", ""); data.set("otherBudget", ""); data.set("reason", ""); await assert.rejects(saveProjectBudget(tx, data), /사유/);
    data.set("reason", "예산 미등록으로 복원"); await saveProjectBudget(tx, data);
    saved = await tx.project.findUniqueOrThrow({ where: { id: project.id } });
    assert.equal(saved.materialBudget, null); assert.equal(saved.laborBudget, null); assert.equal(saved.otherBudget, null); assert.equal(saved.budgetVersion, 3);
    const original = await tx.bankTransaction.findUniqueOrThrow({ where: { id: transaction.id } }); assert.equal(original.amount.toFixed(0), "100"); assert.equal(original.bankBalance?.toFixed(0), "900");
    throw rollback;
  }, { timeout: 15000 }), (e: unknown) => e === rollback); } finally { await db.$disconnect(); }
});

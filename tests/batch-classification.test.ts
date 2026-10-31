import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { applyClassificationBatch, undoClassificationBatch } from "../src/lib/batch-classification";
const form = (values: Record<string, string>) => { const f = new FormData(); Object.entries(values).forEach(([k,v]) => f.set(k,v)); return f; };
test("묶음 분류는 금액·잔액을 보존하고 재요청·되돌리기·변경 충돌을 처리한다", async () => {
  const db = getDb(); const rollback = new Error("ROLLBACK");
  try { await assert.rejects(db.$transaction(async (tx) => {
    await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
    const account = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "하나은행", label: randomUUID() } });
    const first = await tx.bankTransaction.create({ data: { accountId: account.id, tradedDate: new Date("2026-10-01"), description: "검증 전기요금1", direction: "OUT", amount: "100", bankBalance: "900" } });
    const second = await tx.bankTransaction.create({ data: { accountId: account.id, tradedDate: new Date("2026-10-02"), description: "검증 전기요금2", direction: "OUT", amount: "200" } });
    const code = await tx.accountingCode.findUniqueOrThrow({ where: { code: "6120" } });
    const data = form({ rows: JSON.stringify([first,second].map((r) => ({ id: r.id, version: 0 }))), requestId: randomUUID(), accountingCodeId: code.id, reason: "같은 전기요금 검토", confirmed: "on" });
    const batch = await applyClassificationBatch(tx, data);
    assert.equal((await applyClassificationBatch(tx, data)).id, batch.id);
    const applied = await tx.bankTransaction.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(applied.accountingCodeId, code.id); assert.equal(applied.amount.toFixed(0), "100"); assert.equal(applied.bankBalance?.toFixed(0), "900"); assert.equal(applied.classificationVersion, 1);
    const undo = form({ batchId: batch.id, reason: "검토 후 취소" });
    await tx.bankTransaction.update({ where: { id: second.id }, data: { classificationVersion: { increment: 1 } } });
    await assert.rejects(undoClassificationBatch(tx, undo), /별도로 수정/);
    assert.equal((await tx.bankTransaction.findUniqueOrThrow({ where: { id: first.id } })).accountingCodeId, code.id);
    await tx.bankTransaction.update({ where: { id: second.id }, data: { classificationVersion: 1 } });
    await undoClassificationBatch(tx, undo); await undoClassificationBatch(tx, undo);
    const restored = await tx.bankTransaction.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(restored.accountingCodeId, null); assert.equal(restored.classificationVersion, 2); assert.equal(restored.amount.toFixed(0), "100");
    assert.equal(await tx.bankClassificationChange.count({ where: { transactionId: first.id } }), 2);
    assert.ok((await applyClassificationBatch(tx, data)).undoneAt);
    data.set("requestId", randomUUID()); data.set("rows", JSON.stringify([{ id: first.id, version: 0 }]));
    await assert.rejects(applyClassificationBatch(tx, data), /변경된 거래/);
    data.set("rows", JSON.stringify([{ id: first.id, version: 2 }])); data.delete("confirmed");
    await assert.rejects(applyClassificationBatch(tx, data), /확인/);
    throw rollback;
  }, { timeout: 15000 }), (error: unknown) => error === rollback); } finally { await db.$disconnect(); }
});

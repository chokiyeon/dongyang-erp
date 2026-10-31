import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { savePaymentAllocations } from "../src/lib/payment-allocations";
import { reclassifyBankTransaction } from "../src/lib/ledger";
import { applyClassificationBatch, undoClassificationBatch } from "../src/lib/batch-classification";
const form = (values: Record<string,string>) => { const f = new FormData(); Object.entries(values).forEach(([k,v]) => f.set(k,v)); return f; };
test("현장 분할·미배분·초과 차단·재요청·수정 충돌·이체 보호·배분 해제를 검증한다", async () => {
  const db = getDb(); const rollback = new Error("ROLLBACK");
  try { await assert.rejects(db.$transaction(async (tx) => {
    await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
    const account = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "하나은행", label: randomUUID() } });
    const a = await tx.project.create({ data: { companyId: COMPANY_ID, code: randomUUID(), name: "검증 A" } });
    const b = await tx.project.create({ data: { companyId: COMPANY_ID, code: randomUUID(), name: "검증 B" } });
    const transaction = await tx.bankTransaction.create({ data: { accountId: account.id, tradedDate: new Date("2026-10-01"), direction: "OUT", amount: "1000", bankBalance: "12345678901234567890", description: "검증 지급" } });
    const rows = [{ projectId: a.id, category: "MATERIAL", amount: "400", note: "자재" }, { projectId: b.id, category: "LABOR", amount: "300", note: "급여" }, { projectId: "", category: "COMPANY", amount: "100", note: "공통" }];
    const data = form({ transactionId: transaction.id, version: "0", requestId: randomUUID(), reason: "검증 배분", allocations: JSON.stringify(rows) });
    await savePaymentAllocations(tx, data); await savePaymentAllocations(tx, data);
    let saved = await tx.bankTransaction.findUniqueOrThrow({ where: { id: transaction.id }, include: { paymentAllocations: true } });
    assert.equal(saved.allocationVersion, 1); assert.equal(saved.amount.toFixed(0), "1000"); assert.equal(saved.bankBalance?.toFixed(0), "12345678901234567890"); assert.equal(saved.classificationVersion, 0);
    assert.equal(saved.paymentAllocations.reduce((sum,r) => sum + BigInt(r.amount.toFixed(0)), 0n), 800n);
    data.set("requestId", randomUUID()); await assert.rejects(savePaymentAllocations(tx, data), /다른 화면/);
    data.set("version", "1"); data.set("allocations", JSON.stringify([{ ...rows[0], amount: "1001" }])); await assert.rejects(savePaymentAllocations(tx, data), /초과/);
    data.set("allocations", JSON.stringify([{ ...rows[0], projectId: "foreign-project" }])); await assert.rejects(savePaymentAllocations(tx, data), /회사에 등록/);
    data.set("allocations", JSON.stringify([{ ...rows[0], projectId: "" }])); await assert.rejects(savePaymentAllocations(tx, data), /현장을 선택/);
    const transferCode = await tx.accountingCode.findUniqueOrThrow({ where: { code: "1010" } });
    const classification = form({ transactionId: transaction.id, version: "0", accountingCodeId: transferCode.id, businessType: "internal-transfer", reason: "이체 확인" });
    await assert.rejects(reclassifyBankTransaction(tx, classification), /배분을 먼저 해제/);
    const batchData = form({ requestId: randomUUID(), rows: JSON.stringify([{ id: transaction.id, version: 0 }]), accountingCodeId: transferCode.id, businessType: "internal-transfer", confirmed: "on", reason: "검증" });
    await assert.rejects(applyClassificationBatch(tx, batchData), /배분을 먼저 해제/);
    await tx.project.update({ where: { id: b.id }, data: { active: false } });
    data.set("allocations", JSON.stringify(rows)); await savePaymentAllocations(tx, data);
    data.set("version", "2"); data.set("requestId", randomUUID()); data.set("allocations", "[]"); await savePaymentAllocations(tx, data);
    await reclassifyBankTransaction(tx, classification);
    data.set("version", "3"); data.set("requestId", randomUUID()); data.set("allocations", JSON.stringify([rows[0]])); await assert.rejects(savePaymentAllocations(tx, data), /계좌 간 이체/);
    // A batch undo must not turn a newly allocated payment back into an internal transfer.
    const transfer = await tx.bankTransaction.create({ data: { accountId: account.id, tradedDate: new Date("2026-10-01"), direction: "OUT", amount: "1000", description: "검증 이체", internalTransfer: true } });
    batchData.set("requestId", randomUUID()); batchData.set("rows", JSON.stringify([{ id: transfer.id, version: 0 }])); batchData.delete("businessType");
    const code = await tx.accountingCode.findUniqueOrThrow({ where: { code: "6120" } }); batchData.set("accountingCodeId", code.id);
    // A manual account selection preserves an existing transfer flag; use an explicit non-transfer activity.
    batchData.set("businessType", "utilities-office");
    const batch = await applyClassificationBatch(tx, batchData);
    data.set("transactionId", transfer.id); data.set("version", "0");
    await savePaymentAllocations(tx, data);
    await assert.rejects(undoClassificationBatch(tx, form({ batchId: batch.id, reason: "검증 취소" })), /배분을 먼저 해제/);
    saved = await tx.bankTransaction.findUniqueOrThrow({ where: { id: transfer.id }, include: { paymentAllocations: true } });
    assert.equal(saved.internalTransfer, false); assert.equal(saved.paymentAllocations.length, 1);
    assert.equal(await tx.paymentAllocationChange.count({ where: { transactionId: transaction.id } }), 3);
    throw rollback;
  }, { timeout: 15000 }), (error: unknown) => error === rollback); } finally { await db.$disconnect(); }
});

import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { STANDARD_ACCOUNTING_CODES, ACCOUNTING_CHART_VERSION } from "../src/lib/standard-accounting-codes";
import { TRANSACTION_ACTIVITIES } from "../src/lib/transaction-activities";
import { createBankTransaction, reclassifyBankTransaction } from "../src/lib/ledger";
const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };

test("새 코드표와 거래 종류 연결이 완전하고 위험한 혼합 지출은 미분류로 둔다", async () => {
  const keys = new Set(STANDARD_ACCOUNTING_CODES.map(([code]) => code));
  assert.equal(keys.size, STANDARD_ACCOUNTING_CODES.length);
  for (const activity of TRANSACTION_ACTIVITIES) if (activity.code) assert.ok(keys.has(activity.code), activity.key);
  for (const key of ["loan-mixed", "social-insurance-mixed", "rental-unknown"]) assert.equal(TRANSACTION_ACTIVITIES.find((a) => a.key === key)?.code, null);
  const db = getDb();
  try {
    assert.equal(await db.accountingCode.count({ where: { code: { in: [...keys] } } }), STANDARD_ACCOUNTING_CODES.length);
    const transition = await db.accountingCodeTransition.findUniqueOrThrow({ where: { id: ACCOUNTING_CHART_VERSION } });
    assert.ok(transition.snapshot && typeof transition.snapshot === "object" && !Array.isArray(transition.snapshot));
    const snapshot = transition.snapshot as Record<string, unknown>;
    assert.ok(Array.isArray(snapshot.codes)); assert.ok(Array.isArray(snapshot.transactionLinks)); assert.ok(Array.isArray(snapshot.bankCodes));
  } finally { await db.$disconnect(); }
});

test("선택한 업무 종류를 검증하고 분류 정정 시 금액 보존·이력·충돌을 확인한다", async () => {
  const db = getDb(); const rollback = new Error("EXPECTED_ROLLBACK");
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 법인" }, update: {} });
      const account = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "하나은행", label: `분류-${randomUUID()}`, accountingCode: "OLD-WRONG" } });
      const penalty = await tx.accountingCode.findUniqueOrThrow({ where: { code: "6150" } }); const rent = await tx.accountingCode.findUniqueOrThrow({ where: { code: "6070" } });
      const requestId = randomUUID(); const input = form({ requestId, accountId: account.id, tradedDate: "2026-10-01", direction: "OUT", description: "과태료 검증", amount: "37000", bankBalance: "100000", accountingCodeId: rent.id, businessType: "penalty" });
      await assert.rejects(createBankTransaction(tx, input), /연결 계정/);
      input.set("direction", "IN"); input.set("businessType", "penalty"); input.set("accountingCodeId", penalty.id);
      await assert.rejects(createBankTransaction(tx, input), /입금·출금/);
      input.set("direction", "OUT"); input.set("accountingCodeId", rent.id); input.set("businessType", "rental-office"); await createBankTransaction(tx, input);
      const previous = await tx.bankTransaction.findUniqueOrThrow({ where: { requestId } });
      const correction = form({ transactionId: previous.id, version: "0", businessType: "penalty", accountingCodeId: penalty.id, reason: "렌탈 대신 과태료로 정정" });
      await reclassifyBankTransaction(tx, correction);
      const changed = await tx.bankTransaction.findUniqueOrThrow({ where: { id: previous.id }, include: { classificationChanges: true } });
      assert.equal(changed.amount.toFixed(0), "37000"); assert.equal(changed.bankBalance?.toFixed(0), "100000"); assert.equal(changed.tradedDate.getTime(), previous.tradedDate.getTime());
      assert.equal(changed.accountingCodeId, penalty.id); assert.equal(changed.classificationChanges.length, 1); assert.equal(changed.classificationChanges[0].previousCodeId, rent.id);
      await assert.rejects(reclassifyBankTransaction(tx, correction), /다른 화면/);
      const unknownId = randomUUID(); input.set("requestId", unknownId); input.set("businessType", "rental-unknown"); input.set("accountingCodeId", "");
      await createBankTransaction(tx, input);
      assert.equal((await tx.bankTransaction.findUniqueOrThrow({ where: { requestId: unknownId } })).accountingCodeId, null);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.$disconnect(); }
});

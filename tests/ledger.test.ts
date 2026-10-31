import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { createBankTransaction, importBankTransactions } from "../src/lib/ledger";
import { parseBankWorkbook } from "../src/lib/bank-import";
const form = (values: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; };

test("은행 공통 엑셀의 금액·날짜·빈 잔액을 읽고 잘못된 양식을 거부한다", () => {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("거래내역");
  sheet.addRow(["거래일자", "적요", "입금액", "출금액", "거래후잔액"]);
  sheet.addRow(["2026.10.01", "공사대금", "1,000,000", 0, "-500,000"]);
  sheet.addRow(["20261002", "자재비", "", "120,000", ""]);
  const rows = parseBankWorkbook(book);
  assert.equal(rows[0].date, "2026-10-01"); assert.equal(rows[0].amount, "1000000"); assert.equal(rows[0].balance, "-500000");
  assert.equal(rows[1].direction, "OUT"); assert.equal(rows[1].balance, null);
  sheet.addRow(["2026-10-03", "잘못된 거래", 100, 100, 0]);
  assert.throws(() => parseBankWorkbook(book), /한쪽/);
  const missing = new ExcelJS.Workbook(); missing.addWorksheet("빈 양식").addRow(["임의 열"]);
  assert.throws(() => parseBankWorkbook(missing), /열을 찾지/);
});

test("통합 장부는 계좌별 실제 거래를 저장하고 파일 중복·다른 회사·겹치는 파일을 구분한다", async () => {
  const db = getDb(); const rollback = new Error("EXPECTED_ROLLBACK"); const tag = randomUUID();
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
      const first = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "하나은행", label: `장부A-${tag}` } });
      const second = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "우리은행", label: `장부B-${tag}` } });
      const input = form({ accountId: first.id, requestId: randomUUID(), tradedDate: "2026-10-01", description: `검증-${tag}`, direction: "IN", amount: "99999999999999999999", bankBalance: "-50000000" });
      await createBankTransaction(tx, input); await createBankTransaction(tx, input);
      const stored = await tx.bankTransaction.findMany({ where: { accountId: first.id } });
      assert.equal(stored.length, 1); assert.equal(stored[0].amount.toFixed(0), "99999999999999999999"); assert.equal(stored[0].bankBalance?.toFixed(0), "-50000000");
      const other = await tx.company.create({ data: { name: "다른 회사" } }); const otherAccount = await tx.bankAccount.create({ data: { companyId: other.id, bankName: "전북은행", label: "다른 계좌" } });
      input.set("accountId", otherAccount.id); input.set("requestId", randomUUID()); await assert.rejects(createBankTransaction(tx, input), /회사에 등록된/);
      const imported = form({ accountId: second.id, fileHash: "a".repeat(64), rows: JSON.stringify([{ sourceRow: 2, date: "2026-10-02", time: "", description: "수입", direction: "IN", amount: "2000000", balance: null }, { sourceRow: 3, date: "2026-10-02", time: "", description: "지출", direction: "OUT", amount: "100000", balance: "1900000" }]) });
      assert.equal(await importBankTransactions(tx, imported), 2); assert.equal(await importBankTransactions(tx, imported), 0);
      imported.set("fileHash", "b".repeat(64)); await assert.rejects(importBankTransactions(tx, imported), /기존 거래와 같은/);
      imported.set("allowSuspected", "on"); assert.equal(await importBankTransactions(tx, imported), 2);
      const totals = await tx.bankTransaction.groupBy({ by: ["direction"], where: { accountId: second.id }, _sum: { amount: true } });
      assert.equal(totals.find((s) => s.direction === "IN")?._sum.amount?.toFixed(0), "4000000");
      assert.equal(totals.find((s) => s.direction === "OUT")?._sum.amount?.toFixed(0), "200000");
      throw rollback;
    }, { timeout: 15000 }), (error: unknown) => error === rollback);
  } finally { await db.$disconnect(); }
});

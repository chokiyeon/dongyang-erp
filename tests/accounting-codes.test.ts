import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { parseAccountingWorkbook } from "../src/lib/code-import";
import { importAccountingCodes, saveAccountingCode } from "../src/lib/accounting-codes";
import { createBankTransaction } from "../src/lib/ledger";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
const form = (values: Record<string, string>) => { const result = new FormData(); for (const [key, value] of Object.entries(values)) result.set(key, value); return result; };

test("회계 코드표의 문자열·표시 형식 앞자리 0을 보존한다", () => {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("코드표"); sheet.addRow(["계정코드", "계정과목명", "분류"]);
  sheet.addRow(["00103", "시험 계정", "자산"]); const row = sheet.addRow([5, "표시 형식 계정", "기타"]); row.getCell(1).numFmt = "000";
  const codes = parseAccountingWorkbook(book);
  assert.equal(codes[0].code, "00103"); assert.equal(codes[1].code, "005");
});

test("사무소 코드 저장·재가져오기·충돌·거래 선택과 사용 코드 보호를 검증한다", async () => {
  const db = getDb(); const rollback = new Error("EXPECTED_ROLLBACK"); const code = `00-${randomUUID().slice(0, 8)}`;
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      const data = form({ rows: JSON.stringify([{ code, name: "검증 계정", group: "검증", note: "테스트 자료" }]) });
      assert.equal(await importAccountingCodes(tx, data), 1); assert.equal(await importAccountingCodes(tx, data), 0);
      const saved = await tx.accountingCode.findUniqueOrThrow({ where: { code } }); assert.equal(saved.code, code);
      data.set("rows", JSON.stringify([{ code, name: "다른 계정", group: "검증", note: "" }])); await assert.rejects(importAccountingCodes(tx, data), /기존 계정명/);
      await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
      const account = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "전북은행", label: code } });
      await createBankTransaction(tx, form({ accountId: account.id, accountingCodeId: saved.id, requestId: randomUUID(), tradedDate: "2026-10-01", description: "회계코드 선택 검증", amount: "100", direction: "OUT" }));
      const transaction = await tx.bankTransaction.findFirstOrThrow({ where: { accountId: account.id }, include: { accountingCode: true } }); assert.equal(transaction.accountingCode?.code, code);
      await assert.rejects(saveAccountingCode(tx, form({ id: saved.id, version: "0", code: `${code}-NEW`, name: saved.name, group: saved.group, active: "on" })), /사용된 코드/);
      throw rollback;
    }), (error: unknown) => error === rollback);
    assert.equal(await db.accountingCode.count({ where: { code } }), 0);
  } finally { await db.$disconnect(); }
});

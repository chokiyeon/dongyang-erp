import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { analyzeLegacyLedger } from "../src/lib/legacy-ledger";
import { importLegacyLedgerRows } from "../src/lib/legacy-ledger-import";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
function fixture() {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("2026");
  sheet.addRow([]); sheet.addRow(["날  짜", "구분", "", "ㅡ", "내 역", "입금(차입금)", "입 금", "출 금", "잔 액"]);
  sheet.addRow([null, null, null, null, "전년이월", 0, 1000, 0, 1000]);
  sheet.addRow(["2026-10-01", "104 본(경비)", "전북", null, "전기요금", 0, 0, 100, 900]);
  sheet.addRow(["2026-10-02", "5 차입금", "하나", null, "차입 입금", 500, 0, 0, 1400]);
  sheet.addRow([null, "104 본(경비)", "전북", null, "날짜 없음", 0, 0, 10]);
  sheet.addRow(["2026-10-03", null, "전북", null, "중복 입금 열", 10, 10, 0]);
  sheet.addRow(["2026-10-03", null, "전북", null, "양방향", 0, 10, 10]);
  sheet.addRow(["2026-10-03", null, "전북", null, "음수", 0, 0, -10]);
  sheet.addRow(["2027-10-03", null, "전북", null, "미래", 0, 0, 10]);
  sheet.addRow(["2026-10-03", null, "현금", null, "현금", 0, 0, 10]);
  sheet.addRow([null, null, null, null, "합계", 1000, 1000, 1000]);
  return book;
}
const form = (values: Record<string, string>) => { const f = new FormData(); for (const [k,v] of Object.entries(values)) f.set(k,v); return f; };

test("기존 장부의 거래·차입·이월·누락·음수·현금을 구분하고 잔액을 분리한다", () => {
  const review = analyzeLegacyLedger(fixture(), "2026", "2026-10-31");
  assert.equal(review.rows.length, 2); assert.equal(review.issues.length, 6); assert.equal(review.ignored.opening, 1); assert.equal(review.ignored.summaries, 1);
  assert.equal(review.incoming, "500"); assert.equal(review.outgoing, "100"); assert.equal(review.rows[1].incomingType, "LOAN");
  assert.equal(review.rows[0].legacyCategory, "104 본(경비)"); assert.equal(review.rows[0].ledgerBalance, "900");
  assert.ok(review.issues.some((r) => r.reason.includes("앞 행")));
});

test("계좌 확정·원본 행 중복·출처 보관·미분류 유지·누계와 은행 잔액 분리를 검증한다", async () => {
  const db = getDb(); const rollback = new Error("EXPECTED_ROLLBACK");
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.company.upsert({ where: { id: COMPANY_ID }, create: { id: COMPANY_ID, name: "검증 회사" }, update: {} });
      const first = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "전북은행", label: randomUUID() } });
      const second = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "하나은행", label: randomUUID() } });
      const rows = analyzeLegacyLedger(fixture(), "2026", "2026-10-31").rows.map((r) => ({ ...r, accountId: r.bankLabel === "전북" ? first.id : second.id }));
      const data = form({ fileHash: "c".repeat(64), sheet: "2026", rows: JSON.stringify(rows) });
      assert.deepEqual(await importLegacyLedgerRows(tx, data), { added: 2, skipped: 0 });
      const record = await tx.bankTransaction.findFirstOrThrow({ where: { accountId: first.id } });
      assert.equal(record.bankBalance, null); assert.equal(record.legacyLedgerBalance?.toFixed(0), "900"); assert.equal(record.accountingCodeId, null); assert.equal(record.legacyRow, 4); assert.equal(record.source, "LEGACY_XLSX");
      const code = await tx.accountingCode.findUniqueOrThrow({ where: { code: "6120" } });
      await tx.bankTransaction.update({ where: { id: record.id }, data: { accountingCodeId: code.id } });
      assert.deepEqual(await importLegacyLedgerRows(tx, data), { added: 0, skipped: 2 });
      assert.equal((await tx.bankTransaction.findUniqueOrThrow({ where: { id: record.id } })).accountingCodeId, code.id);
      const alternative = await tx.bankAccount.create({ data: { companyId: COMPANY_ID, bankName: "전북은행", label: randomUUID() } });
      const wrong = rows.map((r, i) => ({ ...r, accountId: i === 0 ? alternative.id : second.id })); data.set("rows", JSON.stringify(wrong));
      await assert.rejects(importLegacyLedgerRows(tx, data), /다른 계좌/);
      data.set("fileHash", "d".repeat(64)); data.set("rows", JSON.stringify([{ ...rows[0], accountId: second.id }]));
      await assert.rejects(importLegacyLedgerRows(tx, data), /원장 은행 표기/);
      data.set("rows", JSON.stringify(rows)); await assert.rejects(importLegacyLedgerRows(tx, data), /중복이 의심/);
      data.set("allowSuspected", "on"); assert.deepEqual(await importLegacyLedgerRows(tx, data), { added: 2, skipped: 0 });
      throw rollback;
    }, { timeout: 15000 }), (e: unknown) => e === rollback);
  } finally { await db.$disconnect(); }
});

test("D열 내용과 E열 추가 내용을 모두 보존하며 D열만 있는 거래도 읽는다", () => {
  const book = fixture(); const sheet = book.getWorksheet("2026")!;
  sheet.addRow(["2026-10-04", "104 본(경비)", "전북", "D열 거래", "E열 메모", 0, 0, 50, 100]);
  sheet.addRow(["2026-10-04", "104 본(경비)", "전북", "D열에만 있는 거래", null, 0, 0, 30, 70]);
  const review = analyzeLegacyLedger(book, "2026", "2026-10-31");
  assert.equal(review.rows.at(-2)?.description, "D열 거래 · E열 메모");
  assert.equal(review.rows.at(-1)?.description, "D열에만 있는 거래");
});

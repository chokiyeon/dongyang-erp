import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { STANDARD_ACCOUNTING_CODES } from "../src/lib/standard-accounting-codes";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL이 필요합니다.");
  const schema = `verify_chart_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(connectionString); url.searchParams.set("schema", schema);
  const client = new pg.Client({ connectionString }); await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 0, "격리된 스키마에서 새 마이그레이션 적용 실패");
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query('DELETE FROM "AccountingCodeTransition"');
    await client.query('DELETE FROM "AccountingCode"');
    await client.query(`INSERT INTO "Company" (id,name,"updatedAt") VALUES ('verify-company','검증 법인',CURRENT_TIMESTAMP)`);
    await client.query(`INSERT INTO "AccountingCode" (id,code,name,"group",note,"updatedAt") VALUES ('verify-old-code','OLD','이전 코드','이전 분류','검증',CURRENT_TIMESTAMP)`);
    await client.query(`INSERT INTO "BankAccount" (id,"companyId","bankName",label,"accountingCode","updatedAt") VALUES ('verify-account','verify-company','하나은행','검증 계좌','OLD-BANK',CURRENT_TIMESTAMP)`);
    await client.query(`INSERT INTO "BankTransaction" (id,"accountId","tradedDate",description,direction,amount,"bankBalance","requestId","accountingCodeId") VALUES ('verify-transaction','verify-account','2026-10-01','이전 코드 전환 검증','OUT',1000,5000,'verify-request','verify-old-code')`);
    const sql = readFileSync("prisma/migrations/20261031100000_construction_tax_chart/migration.sql", "utf8");
    await client.query(sql.slice(sql.indexOf("-- One-time user-authorized")));
    const record = (await client.query('SELECT amount::text,"bankBalance"::text,"accountingCodeId" FROM "BankTransaction" WHERE id=\'verify-transaction\'')).rows[0];
    assert.deepEqual(record, { amount: "1000", bankBalance: "5000", accountingCodeId: null });
    const snapshot = (await client.query('SELECT snapshot FROM "AccountingCodeTransition"')).rows[0].snapshot;
    assert.equal(snapshot.codes[0].code, "OLD"); assert.equal(snapshot.bankCodes[0].code, "OLD-BANK"); assert.equal(snapshot.transactionLinks[0].accountingCodeId, "verify-old-code");
    assert.equal(Number((await client.query('SELECT count(*) AS count FROM "AccountingCode"')).rows[0].count), STANDARD_ACCOUNTING_CODES.length);
    await client.query("ROLLBACK");
    console.log("새 환경 마이그레이션·기존 코드 보관·거래 금액 보존·미분류 전환 검증 통과");
  } finally {
    await client.query("ROLLBACK");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

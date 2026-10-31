import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { saveCompany, saveMaster } from "../src/lib/master-data";
import { InputError, amount, date } from "../src/lib/validation";

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

test("금액은 정밀도를 유지하며 미확인·0·잘못된 입력을 구분한다", () => {
  assert.equal(amount("99999999999999999999", "금액"), "99999999999999999999");
  assert.equal(amount("", "금액"), null);
  assert.equal(amount("0", "금액"), "0");
  for (const invalid of ["-1", "1.5", "1,000", "1e5", "0001", "100000000000000000000"]) assert.throws(() => amount(invalid, "금액"), InputError);
});

test("실제로 존재하는 날짜만 받는다", () => {
  assert.equal(date("2028-02-29", "날짜")?.toISOString(), "2028-02-29T00:00:00.000Z");
  for (const invalid of ["2026-02-29", "2026-04-31", "2026-13-01"]) assert.throws(() => date(invalid, "날짜"), InputError);
});

test("기준정보 저장·범위·중복·동시 수정·비활성화를 검증한다", async () => {
  const db = getDb();
  const rollback = new Error("EXPECTED_ROLLBACK");
  const tag = randomUUID().slice(0, 8).toUpperCase();
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      let company = await tx.company.findUnique({ where: { id: COMPANY_ID } });
      await saveCompany(tx, form({ name: "검증용 법인", representatives: "대표A\n대표B", version: String(company?.version ?? 0) }));
      company = await tx.company.findUniqueOrThrow({ where: { id: COMPANY_ID } });
      assert.deepEqual(company.representatives, ["대표A", "대표B"]);
      await saveMaster(tx, "partners", form({ code: `C-${tag}`, name: "검증 발주처", type: "CLIENT", active: "on" }));
      const partner = await tx.partner.findUniqueOrThrow({ where: { companyId_code: { companyId: COMPANY_ID, code: `C-${tag}` } } });
      const project = form({ code: `P-${tag}`, name: "검증 현장", status: "PLANNED", active: "on", clientId: partner.id, contractAmount: "99999999999999999999", startDate: "2026-01-01", endDate: "2026-12-31" });
      project.append("workTypes", "전기"); project.append("workTypes", "계장");
      await saveMaster(tx, "projects", project);
      const saved = await tx.project.findUniqueOrThrow({ where: { companyId_code: { companyId: COMPANY_ID, code: `P-${tag}` } } });
      assert.equal(saved.contractAmount?.toFixed(0), "99999999999999999999");
      assert.deepEqual(saved.workTypes, ["전기", "계장"]);
      project.set("id", saved.id); project.set("version", String(saved.version)); project.set("name", "변경된 현장"); project.delete("active");
      await saveMaster(tx, "projects", project);
      assert.equal((await tx.project.findUniqueOrThrow({ where: { id: saved.id } })).active, false);
      await assert.rejects(saveMaster(tx, "projects", project), /다른 화면/);
      project.delete("id"); project.set("startDate", "2026-12-31"); project.set("endDate", "2026-01-01");
      await assert.rejects(saveMaster(tx, "projects", project), /준공 예정일/);
      const otherCompany = await tx.company.create({ data: { name: "다른 회사" } });
      const other = await tx.partner.create({ data: { companyId: otherCompany.id, code: `O-${tag}`, name: "다른 회사 거래처" } });
      project.set("clientId", other.id);
      await assert.rejects(saveMaster(tx, "projects", project), /등록된 발주처/);
      await saveMaster(tx, "accounts", form({ name: `미확인-${tag}`, bankName: "전북은행", overdraftLimit: "", active: "on" }));
      const account = await tx.bankAccount.findUniqueOrThrow({ where: { companyId_label: { companyId: COMPANY_ID, label: `미확인-${tag}` } } });
      assert.equal(account.overdraftLimit, null);
      await saveMaster(tx, "accounts", form({ id: account.id, version: String(account.version), name: account.label, bankName: "전북은행", overdraftLimit: "0", active: "on" }));
      assert.equal((await tx.bankAccount.findUniqueOrThrow({ where: { id: account.id } })).overdraftLimit?.toFixed(0), "0");
      await assert.rejects(saveMaster(tx, "partners", form({ code: partner.code, name: "중복", type: "CLIENT", active: "on" })), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002"));
      throw rollback;
    }, { timeout: 15000 }), (error: unknown) => error === rollback);
    assert.equal(await db.partner.count({ where: { code: `C-${tag}` } }), 0);
  } finally { await db.$disconnect(); }
});

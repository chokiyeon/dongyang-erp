import "dotenv/config";
import assert from "node:assert/strict";
import { getDb } from "../src/lib/db";

async function main() {
  const db = getDb();
  const rollback = new Error("ROLLBACK_CHECK");
  let companyId: string | undefined;
  try {
    try {
      await db.$transaction(async (tx) => {
        const company = await tx.company.create({ data: { name: "연결 검증용 임시 법인" } });
        companyId = company.id;
        await tx.bankAccount.create({ data: { companyId, bankName: "검증은행", label: "검증계좌", overdraftLimit: "200000000" } });
        await tx.bankAccount.create({ data: { companyId, bankName: "검증은행", label: "미확인 한도 계좌" } });
        await tx.project.create({ data: { companyId, code: "CHECK", name: "검증현장" } });
        const saved = await tx.company.findUniqueOrThrow({ where: { id: companyId }, include: { accounts: true, projects: true } });
        assert.equal(saved.accounts.find((a) => a.label === "검증계좌")?.overdraftLimit?.toFixed(0), "200000000");
        assert.equal(saved.accounts.find((a) => a.label === "미확인 한도 계좌")?.overdraftLimit, null);
        assert.equal(saved.projects[0].status, "PLANNED");
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.ok(companyId);
    assert.equal(await db.company.count({ where: { id: companyId } }), 0);
    console.log("Prisma 생성·관계 조회·금액 보존·미확인 한도·롤백 검증 통과");
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { amount, InputError, revision, text } from "./validation";
import { type BudgetValues } from "./project-budget-summary";
export async function saveProjectBudget(tx: Prisma.TransactionClient, data: FormData) {
  const id = text(data, "projectId", "현장", true, 50); const version = revision(data);
  const reason = text(data, "reason", "예산 등록·수정 사유", true, 300);
  const requestId = text(data, "requestId", "요청 식별자", true, 50);
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new InputError("화면을 다시 열어 주세요.");
  const next: BudgetValues = { materialBudget: amount(text(data, "materialBudget", "자재비 지급예산", false, 20), "자재비 지급예산"), laborBudget: amount(text(data, "laborBudget", "인건비 지급예산", false, 20), "인건비 지급예산"), otherBudget: amount(text(data, "otherBudget", "기타비 지급예산", false, 20), "기타비 지급예산") };
  const fingerprint = createHash("sha256").update(JSON.stringify({ id, version, next, reason })).digest("hex");
  const replay = await tx.projectBudgetChange.findUnique({ where: { requestId }, include: { project: { select: { companyId: true } } } });
  if (replay) {
    if (replay.project.companyId !== COMPANY_ID || replay.fingerprint !== fingerprint) throw new InputError("다른 내용으로 사용된 요청입니다. 화면을 다시 열어 주세요.");
    return id;
  }
  const project = await tx.project.findFirst({ where: { id, companyId: COMPANY_ID } });
  if (!project) throw new InputError("회사에 등록된 현장을 선택해 주세요.");
  const previous: BudgetValues = { materialBudget: project.materialBudget?.toFixed(0) ?? null, laborBudget: project.laborBudget?.toFixed(0) ?? null, otherBudget: project.otherBudget?.toFixed(0) ?? null };
  const changed = await tx.project.updateMany({ where: { id, companyId: COMPANY_ID, budgetVersion: version }, data: { ...next, budgetVersion: { increment: 1 } } });
  if (changed.count !== 1) throw new InputError("다른 화면에서 예산을 수정했습니다. 다시 조회해 주세요.");
  await tx.projectBudgetChange.create({ data: { projectId: id, requestId, fingerprint, previous, next, reason } });
  return id;
}

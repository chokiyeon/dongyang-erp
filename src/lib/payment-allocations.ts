import {assertPeriodsOpen} from "./period-guard";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { amount, choice, InputError, revision, text } from "./validation";
import { PAYMENT_CATEGORIES, type PaymentAllocationInput } from "./payment-allocation-types";
export async function savePaymentAllocations(tx: Prisma.TransactionClient, data: FormData) {
  const transactionId = text(data, "transactionId", "거래", true, 50);
  const version = revision(data); const reason = text(data, "reason", "배분 사유", true, 300);
  const requestId = text(data, "requestId", "요청 식별자", true, 50);
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new InputError("화면을 다시 열어 주세요.");
  let raw: unknown;
  try { raw = JSON.parse(text(data, "allocations", "현장 배분", true, 20000)); } catch { throw new InputError("배분 내역을 다시 확인해 주세요."); }
  if (!Array.isArray(raw) || raw.length > 20) throw new InputError("출금 한 건을 최대 20개 항목으로 배분할 수 있습니다.");
  const rows: PaymentAllocationInput[] = raw.map((r) => {
    if (!r || typeof r !== "object" || typeof r.projectId !== "string" || r.projectId.length > 50 || typeof r.category !== "string" || typeof r.amount !== "string" || typeof r.note !== "string" || r.note.length > 200) throw new InputError("배분 내역 형식을 확인해 주세요.");
    const category = choice(r.category, Object.keys(PAYMENT_CATEGORIES) as (keyof typeof PAYMENT_CATEGORIES)[], "지급 구분");
    const value = amount(r.amount.trim(), "배분 금액"); if (!value || BigInt(value) <= 0n) throw new InputError("배분 금액은 0보다 커야 합니다.");
    if (category === "COMPANY" ? Boolean(r.projectId) : !r.projectId) throw new InputError("현장 지급은 현장을 선택하고, 본사·공통·공사 외 지급은 현장 없이 기록해 주세요.");
    return { projectId: r.projectId, category, amount: value, note: r.note.trim() };
  });
  const fingerprint = createHash("sha256").update(JSON.stringify({ transactionId, version, rows, reason })).digest("hex");
  const replay = await tx.paymentAllocationChange.findUnique({ where: { requestId }, include: { transaction: { select: { account: { select: { companyId: true } } } } } });
  if (replay) {
    if (replay.fingerprint !== fingerprint || replay.transaction.account.companyId !== COMPANY_ID) throw new InputError("다른 내용으로 사용된 요청입니다. 화면을 다시 열어 주세요.");
    return transactionId;
  }
  const transaction = await tx.bankTransaction.findFirst({ where: { id: transactionId, account: { companyId: COMPANY_ID } }, include: { paymentAllocations: true } });
  if (!transaction || transaction.direction !== "OUT") throw new InputError("회사 출금 거래를 선택해 주세요.");
  if (transaction.internalTransfer && rows.length) throw new InputError("계좌 간 이체는 현장 지급으로 배분할 수 없습니다.");
  if (transaction.allocationVersion !== version) throw new InputError("다른 화면에서 배분을 변경했습니다. 다시 조회해 주세요.");
  if (rows.reduce((sum, r) => sum + BigInt(r.amount), 0n) > BigInt(transaction.amount.toFixed(0))) throw new InputError("배분 합계가 실제 출금액을 초과합니다.");
  const ids = [...new Set(rows.map((r) => r.projectId).filter(Boolean))];
  const projects = await tx.project.findMany({ where: { id: { in: ids }, companyId: COMPANY_ID } });
  if (projects.length !== ids.length) throw new InputError("회사에 등록된 현장을 선택해 주세요.");
  const previousIds = new Set(transaction.paymentAllocations.map((r) => r.projectId));
  if (projects.some((p) => !p.active && !previousIds.has(p.id))) throw new InputError("새 배분은 사용 중인 현장에만 등록할 수 있습니다.");
  await assertPeriodsOpen(tx,transaction.tradedDate);
  const changed = await tx.bankTransaction.updateMany({ where: { id: transactionId, account: { companyId: COMPANY_ID }, allocationVersion: version, classificationVersion: transaction.classificationVersion }, data: { allocationVersion: { increment: 1 } } });
  if (changed.count !== 1) throw new InputError("거래가 변경되었습니다. 다시 조회해 주세요.");
  const previous = transaction.paymentAllocations.map((r) => ({ projectId: r.projectId ?? "", category: r.category, amount: r.amount.toFixed(0), note: r.note }));
  await tx.paymentAllocation.deleteMany({ where: { transactionId } });
  if (rows.length) await tx.paymentAllocation.createMany({ data: rows.map((r) => ({ ...r, transactionId, projectId: r.projectId || null })) });
  await tx.paymentAllocationChange.create({ data: { transactionId, requestId, fingerprint, previous, next: rows, reason } });
  return transactionId;
}

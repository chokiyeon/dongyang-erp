import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { resolveClassification } from "./ledger";
import { InputError, text } from "./validation";
export type ClassificationSelection = { id: string; version: number };
function selections(data: FormData): ClassificationSelection[] {
  let raw: unknown;
  try { raw = JSON.parse(text(data, "rows", "선택 내역", true, 20000)); } catch { throw new InputError("선택한 거래를 다시 확인해 주세요."); }
  if (!Array.isArray(raw) || !raw.length || raw.length > 100) throw new InputError("1~100건의 미분류 거래를 선택해 주세요.");
  const ids = new Set<string>();
  return raw.map((r) => {
    if (!r || typeof r.id !== "string" || !r.id || r.id.length > 50 || !Number.isSafeInteger(r.version) || r.version < 0 || r.version > 2147483647 || ids.has(r.id)) throw new InputError("선택한 거래의 식별 정보가 올바르지 않습니다.");
    ids.add(r.id); return { id: r.id, version: r.version };
  }).sort((a,b) => a.id.localeCompare(b.id));
}
export async function applyClassificationBatch(tx: Prisma.TransactionClient, data: FormData) {
  const selected = selections(data); const reason = text(data, "reason", "분류 사유", true, 300);
  const requestId = text(data, "requestId", "요청 식별자", true, 50);
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new InputError("화면을 다시 열어 주세요.");
  if (data.get("confirmed") !== "on") throw new InputError("선택한 거래가 같은 지출·수금 목적임을 확인해 주세요.");
  const codeId = text(data, "accountingCodeId", "계정", false, 50); const businessType = text(data, "businessType", "거래 종류", false, 80);
  if (!codeId && !businessType) throw new InputError("적용할 거래 종류 또는 계정을 선택해 주세요.");
  const fingerprint = createHash("sha256").update(JSON.stringify({ selected, codeId, businessType, reason })).digest("hex");
  const previousBatch = await tx.classificationBatch.findUnique({ where: { requestId } });
  if (previousBatch) {
    if (previousBatch.companyId !== COMPANY_ID || previousBatch.fingerprint !== fingerprint) throw new InputError("이미 다른 내용으로 사용한 요청입니다. 화면을 다시 열어 주세요.");
    return previousBatch;
  }
  const rows = await tx.bankTransaction.findMany({ where: { id: { in: selected.map((r) => r.id) }, account: { companyId: COMPANY_ID } }, include: { _count: { select: { paymentAllocations: true, tradeLinks: { where: { voidedAt: null } }, cashSettlements: { where: { voidedAt: null } } } } } });
  if (rows.length !== selected.length) throw new InputError("회사 거래인지 확인한 뒤 다시 선택해 주세요.");
  const versions = new Map(selected.map((r) => [r.id, r.version]));
  if (rows.some((r) => r.accountingCodeId !== null || r.classificationVersion !== versions.get(r.id))) throw new InputError("이미 분류되었거나 변경된 거래가 포함되어 있습니다. 다시 조회해 주세요.");
  const direction = rows[0].direction;
  if (rows.some((r) => r.direction !== direction)) throw new InputError("입금과 출금을 나눠 선택해 주세요.");
  const next = await resolveClassification(tx, data, direction);
  if (next.businessType === "internal-transfer" && rows.some((r) => r._count.paymentAllocations)) throw new InputError("현장 배분을 먼저 해제한 뒤 계좌 간 이체로 변경해 주세요.");
  if (next.businessType === "internal-transfer" && rows.some((r) => r._count.tradeLinks)) throw new InputError("매입·매출 은행 연결을 먼저 해제한 뒤 계좌 간 이체로 변경해 주세요.");
  if (next.businessType === "internal-transfer" && rows.some((r) => r._count.cashSettlements)) throw new InputError("입출금 예정의 은행 연결 실적을 먼저 취소한 뒤 계좌 간 이체로 변경해 주세요.");
  const code = next.accountingCodeId ? await tx.accountingCode.findUniqueOrThrow({ where: { id: next.accountingCodeId } }) : null;
  const batch = await tx.classificationBatch.create({ data: { companyId: COMPANY_ID, requestId, fingerprint, targetCodeId: next.accountingCodeId, targetBusinessType: next.businessType, targetLabel: code ? `${code.code} · ${code.name}` : "미분류 · 확인 필요", reason } });
  for (const row of rows) {
    const internalTransfer = next.businessType === "internal-transfer" || (next.businessType === null && row.internalTransfer);
    const changed = await tx.bankTransaction.updateMany({ where: { id: row.id, settlementVersion: row.settlementVersion, allocationVersion: row.allocationVersion, classificationVersion: versions.get(row.id), accountingCodeId: null, account: { companyId: COMPANY_ID } }, data: { ...next, internalTransfer, classificationVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new InputError("다른 화면에서 거래를 변경했습니다. 묶음 전체를 다시 확인해 주세요.");
    await tx.classificationBatchItem.create({ data: { batchId: batch.id, transactionId: row.id, previousCodeId: row.accountingCodeId, newCodeId: next.accountingCodeId, previousBusinessType: row.businessType, newBusinessType: next.businessType, previousInternalTransfer: row.internalTransfer, newInternalTransfer: internalTransfer, appliedVersion: row.classificationVersion + 1 } });
    await tx.bankClassificationChange.create({ data: { transactionId: row.id, previousCodeId: row.accountingCodeId, newCodeId: next.accountingCodeId, previousBusinessType: row.businessType, newBusinessType: next.businessType, reason: `[묶음 ${batch.id}] ${reason}` } });
  }
  return batch;
}
export async function undoClassificationBatch(tx: Prisma.TransactionClient, data: FormData) {
  const id = text(data, "batchId", "분류 작업", true, 50); const reason = text(data, "reason", "되돌리기 사유", true, 300);
  const batch = await tx.classificationBatch.findFirst({ where: { id, companyId: COMPANY_ID }, include: { items: { include: { transaction: { include: { account: true, _count: { select: { paymentAllocations: true, tradeLinks: { where: { voidedAt: null } }, cashSettlements: { where: { voidedAt: null } } } } } } } } } });
  if (!batch) throw new InputError("분류 작업을 확인해 주세요.");
  if (batch.undoneAt) return batch.id;
  if (batch.items.some((item) => item.transaction.account.companyId !== COMPANY_ID || item.transaction.classificationVersion !== item.appliedVersion || item.transaction.accountingCodeId !== item.newCodeId || item.transaction.businessType !== item.newBusinessType || item.transaction.internalTransfer !== item.newInternalTransfer)) throw new InputError("작업 이후 별도로 수정한 거래가 있어 전체 되돌리기를 중단했습니다. 변경 내역을 확인해 주세요.");
  if (batch.items.some((item) => item.previousInternalTransfer && item.transaction._count.paymentAllocations)) throw new InputError("되돌리면 계좌 간 이체가 되는 거래에 현장 배분이 있습니다. 배분을 먼저 해제해 주세요.");
  if (batch.items.some((item) => item.previousInternalTransfer && item.transaction._count.tradeLinks)) throw new InputError("되돌리면 계좌 간 이체가 되는 거래에 매입·매출 은행 연결이 있습니다. 연결을 먼저 해제해 주세요.");
  if (batch.items.some((item) => item.previousInternalTransfer && item.transaction._count.cashSettlements)) throw new InputError("되돌리면 계좌 간 이체가 되는 거래에 예정 처리 실적이 있습니다. 실적을 먼저 취소해 주세요.");
  const marked = await tx.classificationBatch.updateMany({ where: { id, companyId: COMPANY_ID, undoneAt: null }, data: { undoneAt: new Date(), undoReason: reason } });
  if (marked.count !== 1) throw new InputError("다른 화면에서 이 작업을 처리했습니다. 다시 조회해 주세요.");
  for (const item of batch.items) {
    const changed = await tx.bankTransaction.updateMany({ where: { id: item.transactionId, settlementVersion: item.transaction.settlementVersion, allocationVersion: item.transaction.allocationVersion, classificationVersion: item.appliedVersion, account: { companyId: COMPANY_ID } }, data: { accountingCodeId: item.previousCodeId, businessType: item.previousBusinessType, internalTransfer: item.previousInternalTransfer, classificationVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new InputError("거래가 변경되어 전체 되돌리기를 중단했습니다.");
    await tx.bankClassificationChange.create({ data: { transactionId: item.transactionId, previousCodeId: item.newCodeId, newCodeId: item.previousCodeId, previousBusinessType: item.newBusinessType, newBusinessType: item.previousBusinessType, reason: `[묶음 되돌리기 ${batch.id}] ${reason}` } });
  }
  return batch.id;
}

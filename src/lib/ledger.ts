import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { getTransactionActivity, activityDirection } from "./transaction-activities";
import { koreanToday } from "./forecast";
import { amount, choice, date, InputError, revision, text } from "./validation";

export type ImportRow = { sourceRow: number; date: string; time: string; description: string; direction: "IN" | "OUT"; amount: string; balance: string | null };
function uuid(value: string) {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new InputError("화면을 새로 열고 다시 저장해 주세요.");
  return value;
}
function balance(value: string) {
  if (!value) return null;
  if (!/^-?(0|[1-9]\d{0,19})$/.test(value)) throw new InputError("거래 후 잔액은 쉼표 없이 20자리 이하의 정수로 입력해 주세요.");
  return BigInt(value).toString();
}
function transaction(data: FormData) {
  const tradedDate = date(text(data, "tradedDate", "거래일", true), "거래일");
  if (!tradedDate || tradedDate.toISOString().slice(0, 10) > koreanToday()) throw new InputError("실제 거래일은 오늘 이후일 수 없습니다.");
  const tradedTime = text(data, "tradedTime", "거래시각", false, 8);
  if (tradedTime && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(tradedTime)) throw new InputError("거래시각을 확인해 주세요.");
  const value = amount(text(data, "amount", "거래금액", true, 20), "거래금액");
  if (!value || BigInt(value) === 0n) throw new InputError("거래금액은 0보다 커야 합니다.");
  return { tradedDate, tradedTime: tradedTime ? tradedTime.length === 5 ? `${tradedTime}:00` : tradedTime : null, description: text(data, "description", "거래내용", true, 300), direction: choice(text(data, "direction", "입출금 구분"), ["IN", "OUT"] as const, "입출금 구분"), amount: value, bankBalance: balance(text(data, "bankBalance", "거래 후 잔액", false, 21)), internalTransfer: data.get("internalTransfer") === "on" };
}
async function requireAccount(tx: Prisma.TransactionClient, accountId: string) {
  if (!(await tx.bankAccount.findFirst({ where: { id: accountId, companyId: COMPANY_ID, active: true } }))) throw new InputError("회사에 등록된 사용 중인 계좌를 선택해 주세요.");
}
export async function createBankTransaction(tx: Prisma.TransactionClient, data: FormData) {
  const accountId = text(data, "accountId", "계좌", true, 50);
  await requireAccount(tx, accountId);
  const values = transaction(data);
  const classification = await resolveClassification(tx, data, values.direction);
  const { accountingCodeId, businessType } = classification;
  if (businessType === "internal-transfer") values.internalTransfer = true;
  const requestId = uuid(text(data, "requestId", "요청 식별자", true, 50));
  const previous = await tx.bankTransaction.findUnique({ where: { requestId } });
  if (previous) {
    if (previous.accountId === accountId && previous.tradedDate.getTime() === values.tradedDate.getTime() && previous.tradedTime === values.tradedTime && previous.amount.toFixed(0) === values.amount && previous.direction === values.direction && previous.description === values.description && (previous.bankBalance?.toFixed(0) ?? null) === values.bankBalance && previous.internalTransfer === values.internalTransfer && previous.accountingCodeId === accountingCodeId && previous.businessType === businessType) return;
    throw new InputError("이미 사용된 요청입니다. 화면을 다시 열어 주세요.");
  }
  await tx.bankTransaction.create({ data: { accountId, ...values, requestId, accountingCodeId, businessType } });
}
export async function importBankTransactions(tx: Prisma.TransactionClient, data: FormData) {
  const accountId = text(data, "accountId", "계좌", true, 50);
  await requireAccount(tx, accountId);
  const hash = text(data, "fileHash", "파일 식별자", true, 64);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new InputError("엑셀 파일을 다시 선택해 주세요.");
  let rows: unknown;
  try { rows = JSON.parse(text(data, "rows", "가져오기 자료", true, 500000)); } catch { throw new InputError("가져오기 자료 형식을 확인해 주세요."); }
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new InputError("한 번에 1~1,000건을 가져올 수 있습니다.");
  const seen = new Set<number>();
  const records: Prisma.BankTransactionCreateManyInput[] = [];
  for (const input of rows) {
    if (!input || typeof input !== "object") throw new InputError("가져오기 자료를 확인해 주세요.");
    const row = input as Record<string, unknown>;
    if (!Number.isInteger(row.sourceRow) || Number(row.sourceRow) < 1 || Number(row.sourceRow) > 10000 || seen.has(Number(row.sourceRow))) throw new InputError("엑셀 행 번호를 확인해 주세요.");
    seen.add(Number(row.sourceRow));
    const form = new FormData();
    const mapping = { tradedDate: "date", tradedTime: "time", description: "description", direction: "direction", amount: "amount", bankBalance: "balance" };
    for (const [target, source] of Object.entries(mapping)) {
      if (row[source] !== null && row[source] !== undefined && typeof row[source] !== "string") throw new InputError(`${row.sourceRow}행의 값을 확인해 주세요.`);
      form.set(target, (row[source] as string | null) ?? "");
    }
    const values = transaction(form);
    const importKey = createHash("sha256").update(`${accountId}:${hash}:${row.sourceRow}`).digest("hex");
    if (await tx.bankTransaction.findUnique({ where: { importKey } })) continue;
    const suspected = await tx.bankTransaction.findFirst({ where: { accountId, tradedDate: values.tradedDate, amount: values.amount, direction: values.direction, description: values.description } });
    if (suspected && data.get("allowSuspected") !== "on") throw new InputError(`${row.sourceRow}행은 기존 거래와 같은 내역이 있습니다. 조회 기간 중복을 확인해 주세요. 서로 다른 실제 거래라면 '중복 의심 내역도 추가'를 선택할 수 있습니다.`);
    records.push({ accountId, ...values, requestId: randomUUID(), importKey, source: "XLSX" });
  }
  if (records.length) await tx.bankTransaction.createMany({ data: records, skipDuplicates: true });
  return records.length;
}

export async function resolveClassification(tx: Prisma.TransactionClient, data: FormData, direction: "IN" | "OUT") {
  const businessType = text(data, "businessType", "거래 종류", false, 80) || null;
  const accountingCodeId = text(data, "accountingCodeId", "거래 회계코드", false, 50) || null;
  const selected = accountingCodeId ? await tx.accountingCode.findFirst({ where: { id: accountingCodeId, active: true } }) : null;
  if (accountingCodeId && !selected) throw new InputError("등록된 사용 중인 회계코드를 선택해 주세요.");
  if (businessType) {
    const activity = getTransactionActivity(businessType);
    if (activity && activityDirection(businessType) && activityDirection(businessType) !== direction) throw new InputError("입금·출금 구분에 맞는 거래 종류를 선택해 주세요.");
    if (!activity || (activity.code ? selected?.code !== activity.code : accountingCodeId !== null)) throw new InputError("거래 종류와 연결 계정이 다릅니다. 거래 종류를 다시 선택해 주세요.");
  }
  return { accountingCodeId, businessType };
}
export async function reclassifyBankTransaction(tx: Prisma.TransactionClient, data: FormData) {
  const id = text(data, "transactionId", "거래", true, 50);
  const previous = await tx.bankTransaction.findFirst({ where: { id, account: { companyId: COMPANY_ID } }, include: { _count: { select: { paymentAllocations: true, tradeLinks: { where: { voidedAt: null } }, cashSettlements: { where: { voidedAt: null } } } } } });
  if (!previous) throw new InputError("분류할 거래를 다시 선택해 주세요.");
  const version = revision(data);
  const reason = text(data, "reason", "수정 사유", true, 300);
  const next = await resolveClassification(tx, data, previous.direction);
  if (next.businessType === "internal-transfer" && previous._count.paymentAllocations) throw new InputError("현장 배분을 먼저 해제한 뒤 계좌 간 이체로 변경해 주세요.");
  if (next.businessType === "internal-transfer" && previous._count.tradeLinks) throw new InputError("매입·매출 은행 연결을 먼저 해제한 뒤 계좌 간 이체로 변경해 주세요.");
  if (next.businessType === "internal-transfer" && previous._count.cashSettlements) throw new InputError("입출금 예정의 은행 연결 실적을 먼저 취소한 뒤 계좌 간 이체로 변경해 주세요.");
  const changed = await tx.bankTransaction.updateMany({ where: { id, settlementVersion: previous.settlementVersion, allocationVersion: previous.allocationVersion, classificationVersion: version, account: { companyId: COMPANY_ID } }, data: { ...next, internalTransfer: next.businessType === "internal-transfer" || (next.businessType === null && previous.internalTransfer), classificationVersion: { increment: 1 } } });
  if (changed.count !== 1) throw new InputError("다른 화면에서 분류를 변경했습니다. 목록에서 다시 열어 주세요.");
  await tx.bankClassificationChange.create({ data: { transactionId: id, previousCodeId: previous.accountingCodeId, newCodeId: next.accountingCodeId, previousBusinessType: previous.businessType, newBusinessType: next.businessType, reason } });
  return previous.tradedDate.toISOString().slice(0, 10);
}

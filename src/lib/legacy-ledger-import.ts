import {assertPeriodsOpen} from "./period-guard";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { legacyBankName } from "./legacy-ledger";
import { koreanToday } from "./forecast";
import { amount, date, InputError, text } from "./validation";
export async function importLegacyLedgerRows(tx: Prisma.TransactionClient, data: FormData) {
  const fileHash = text(data, "fileHash", "파일 식별자", true, 64);
  const sheet = text(data, "sheet", "시트", true, 80);
  if (!/^[a-f0-9]{64}$/.test(fileHash)) throw new InputError("원본 파일을 다시 선택해 주세요.");
  let raw: unknown;
  try { raw = JSON.parse(text(data, "rows", "장부 자료", true, 500000)); } catch { throw new InputError("장부 자료 형식을 확인해 주세요."); }
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000) throw new InputError("한 번에 1~1,000건을 선택해 주세요.");
  const ids = new Set<number>();
  const records: Prisma.BankTransactionCreateManyInput[] = [];
  let skipped = 0;
  for (const rawRow of raw) {
    if (!rawRow || typeof rawRow !== "object") throw new InputError("가져오기 행을 확인해 주세요.");
    const r = rawRow as Record<string, unknown>;
    if (!Number.isInteger(r.sourceRow) || Number(r.sourceRow) < 1 || Number(r.sourceRow) > 10000 || ids.has(Number(r.sourceRow))) throw new InputError("원본 행 번호를 확인해 주세요.");
    ids.add(Number(r.sourceRow));
    const form = new FormData();
    for (const field of ["accountId", "date", "bankLabel", "description", "legacyCategory", "incomingType", "direction", "amount", "ledgerBalance"]) {
      if (r[field] !== undefined && r[field] !== null && typeof r[field] !== "string") throw new InputError(`${r.sourceRow}행: 값 형식을 확인해 주세요.`);
      form.set(field, (r[field] as string | null) ?? "");
    }
    const accountId = text(form, "accountId", "연결 계좌", true, 50);
    const bankLabel = text(form, "bankLabel", "원장 은행", true, 100);
    const account = await tx.bankAccount.findFirst({ where: { id: accountId, companyId: COMPANY_ID, active: true } });
    if (!account || !legacyBankName(bankLabel) || legacyBankName(bankLabel) !== account.bankName) throw new InputError(`${r.sourceRow}행: 원장 은행 표기와 연결 계좌를 확인해 주세요.`);
    const tradedDate = date(text(form, "date", "거래일", true), "거래일");
    const value = amount(text(form, "amount", "금액", true, 20), "금액");
    const description = text(form, "description", "내용", true, 300);
    const direction = text(form, "direction", "구분", true);
    const incomingType = text(form, "incomingType", "입금 구분", true);
    if (!tradedDate || tradedDate.toISOString().slice(0, 10) > koreanToday() || !value || BigInt(value) <= 0n || !["IN", "OUT"].includes(direction)) throw new InputError(`${r.sourceRow}행: 날짜·입출금 금액을 확인해 주세요.`);
    if (direction === "OUT" ? incomingType !== "NONE" : !["LOAN", "GENERAL"].includes(incomingType)) throw new InputError(`${r.sourceRow}행: 차입금·일반 입금 구분을 확인해 주세요.`);
    const legacyCategory = text(form, "legacyCategory", "이전 분류", false, 100);
    const ledgerBalance = text(form, "ledgerBalance", "원장 누계", false, 21) || null;
    if (ledgerBalance !== null && !/^-?(0|[1-9]\d{0,19})$/.test(ledgerBalance)) throw new InputError(`${r.sourceRow}행: 원장 누계를 확인해 주세요.`);
    const importKey = createHash("sha256").update(`LEGACY:${COMPANY_ID}:${fileHash}:${sheet}:${r.sourceRow}`).digest("hex");
    const existing = await tx.bankTransaction.findUnique({ where: { importKey } });
    if (existing) {
      if (existing.accountId !== accountId || existing.tradedDate.getTime() !== tradedDate.getTime() || existing.direction !== direction || existing.amount.toFixed(0) !== value || existing.description !== description) throw new InputError(`${r.sourceRow}행은 이미 다른 계좌·내용으로 가져왔습니다. 기존 거래를 확인해 주세요.`);
      skipped++; continue;
    }
    const suspected = await tx.bankTransaction.findFirst({ where: { accountId, tradedDate, direction: direction as "IN" | "OUT", amount: value, description } });
    if (suspected && data.get("allowSuspected") !== "on") throw new InputError(`${r.sourceRow}행은 기존 거래와 중복이 의심됩니다. 서로 다른 실제 거래인지 확인해 주세요.`);
    records.push({ accountId, tradedDate, direction: direction as "IN" | "OUT", amount: value, description, bankBalance: null, accountingCodeId: null, businessType: null, requestId: randomUUID(), importKey, source: "LEGACY_XLSX", legacySheet: sheet, legacyRow: Number(r.sourceRow), legacyCategory, legacyBankLabel: bankLabel, legacyIncomingType: incomingType, legacyLedgerBalance: ledgerBalance });
  }
  await assertPeriodsOpen(tx,...records.map(r=>r.tradedDate as Date|string));
  const added = records.length ? (await tx.bankTransaction.createMany({ data: records, skipDuplicates: true })).count : 0;
  return { added, skipped: skipped + records.length - added };
}

import type { Prisma } from "@/generated/prisma/client";
import { InputError, revision, text } from "./validation";
export type CodeInput = { code: string; name: string; group: string; note: string };
function values(data: FormData): CodeInput {
  return { code: text(data, "code", "회계코드", true, 30), name: text(data, "name", "계정과목명", true, 100), group: text(data, "group", "분류", false, 50) || "미분류", note: text(data, "note", "비고", false, 500) };
}
export async function saveAccountingCode(tx: Prisma.TransactionClient, data: FormData) {
  const input = values(data); const id = text(data, "id", "항목", false, 50);
  if (!id) return tx.accountingCode.create({ data: { ...input, active: data.get("active") === "on" } });
  const previous = await tx.accountingCode.findUnique({ where: { id } });
  if (!previous) throw new InputError("회계코드를 다시 선택해 주세요.");
  if (previous.code !== input.code && await tx.bankTransaction.count({ where: { accountingCodeId: id } })) throw new InputError("거래에 사용된 코드 번호는 변경할 수 없습니다. 계정명·비고를 수정하거나 새 코드를 등록해 주세요.");
  const result = await tx.accountingCode.updateMany({ where: { id, version: revision(data) }, data: { ...input, active: data.get("active") === "on", version: { increment: 1 } } });
  if (result.count !== 1) throw new InputError("다른 화면에서 변경했습니다. 목록에서 다시 열어 주세요.");
}
export async function importAccountingCodes(tx: Prisma.TransactionClient, data: FormData) {
  let rows: unknown;
  try { rows = JSON.parse(text(data, "rows", "코드 자료", true, 400000)); } catch { throw new InputError("코드 자료를 확인해 주세요."); }
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new InputError("코드는 1~1,000건씩 가져올 수 있습니다.");
  const unique = new Set<string>();
  let added = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new InputError("코드 자료를 확인해 주세요.");
    const form = new FormData();
    for (const key of ["code", "name", "group", "note"]) { const value = row[key]; if (value !== undefined && typeof value !== "string") throw new InputError("코드와 계정명은 문자열이어야 합니다."); form.set(key, value ?? ""); }
    const input = values(form);
    if (unique.has(input.code)) throw new InputError(`${input.code}: 파일 안에서 코드가 중복됩니다.`);
    unique.add(input.code);
    const previous = await tx.accountingCode.findUnique({ where: { code: input.code } });
    if (previous) {
      if (previous.name !== input.name) throw new InputError(`${input.code}: 기존 계정명과 다릅니다. 기존 자료를 확인한 뒤 수정해 주세요.`);
      continue;
    }
    await tx.accountingCode.create({ data: input }); added++;
  }
  return added;
}

"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { InputError } from "@/lib/validation";
import { importLegacyLedgerRows } from "@/lib/legacy-ledger-import";
import type { FormState } from "@/components/record-form";
export async function importLegacyAction(_state: FormState, data: FormData): Promise<FormState> {
  await requireAdmin();
  try {
    const result = await getDb().$transaction((tx) => importLegacyLedgerRows(tx, data), { timeout: 30000 });
    revalidatePath("/ledger");
    return { error: "", success: `${result.added}건을 가져왔습니다. 같은 원본으로 이미 등록한 ${result.skipped}건은 건너뛰었습니다. 가져온 거래는 새 코드로 확정하지 않은 미분류 상태입니다.` };
  } catch (e) { return { error: e instanceof InputError ? e.message : "장부를 가져오지 못했습니다. 원본과 계좌 연결을 확인해 주세요." }; }
}

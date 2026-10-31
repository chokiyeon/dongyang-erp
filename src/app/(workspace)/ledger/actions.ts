"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createBankTransaction, importBankTransactions, reclassifyBankTransaction } from "@/lib/ledger";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";
async function perform(action: "create" | "import", data: FormData): Promise<FormState> {
  await requireAdmin();
  try {
    await getDb().$transaction((tx) => action === "create" ? createBankTransaction(tx, data) : importBankTransactions(tx, data).then(() => undefined), { timeout: 30000 });
  } catch (error) { return { error: error instanceof InputError ? error.message : "장부를 저장하지 못했습니다. 계좌와 자료를 확인해 주세요." }; }
  revalidatePath("/", "layout");
  redirect("/ledger?saved=1");
}
export async function createTransactionAction(_previous: FormState, data: FormData) { return perform("create", data); }
export async function importTransactionsAction(_previous: FormState, data: FormData) { return perform("import", data); }

export async function reclassifyTransactionAction(_state: FormState, data: FormData): Promise<FormState> {
  await requireAdmin();
  let tradedDate = "";
  try { tradedDate = await getDb().$transaction((tx) => reclassifyBankTransaction(tx, data)); }
  catch (error) { return { error: error instanceof InputError ? error.message : "분류를 저장하지 못했습니다. 다시 확인해 주세요." }; }
  revalidatePath("/", "layout");
  redirect(`/ledger?from=${tradedDate}&to=${tradedDate}&saved=1`);
}

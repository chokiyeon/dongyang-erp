"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { applyClassificationBatch, undoClassificationBatch } from "@/lib/batch-classification";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";
export async function applyBatchAction(_previous: FormState, data: FormData): Promise<FormState> {
  await requireAdmin(); let id = ""; let undone = false;
  try { const batch = await getDb().$transaction((tx) => applyClassificationBatch(tx, data), { timeout: 30000 }); id = batch.id; undone = batch.undoneAt !== null; }
  catch (error) { return { error: error instanceof InputError ? error.message : "묶음 분류를 저장하지 못했습니다. 다시 확인해 주세요." }; }
  revalidatePath("/", "layout"); redirect(`/ledger/classify?batch=${id}&result=${undone ? "already-undone" : "applied"}`);
}
export async function undoBatchAction(_previous: FormState, data: FormData): Promise<FormState> {
  await requireAdmin(); let id = "";
  try { id = await getDb().$transaction((tx) => undoClassificationBatch(tx, data), { timeout: 30000 }); }
  catch (error) { return { error: error instanceof InputError ? error.message : "묶음 분류를 되돌리지 못했습니다. 다시 확인해 주세요." }; }
  revalidatePath("/", "layout"); redirect(`/ledger/classify?batch=${id}&result=undone`);
}

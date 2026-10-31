"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { savePaymentAllocations } from "@/lib/payment-allocations";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";
export async function saveAllocationsAction(_state: FormState, data: FormData): Promise<FormState> {
  await requireAdmin(); let id = "";
  try { id = await getDb().$transaction((tx) => savePaymentAllocations(tx, data)); }
  catch (e) { return { error: e instanceof InputError ? e.message : "현장 배분을 저장하지 못했습니다. 다시 확인해 주세요." }; }
  revalidatePath("/", "layout"); redirect(`/project-costs?edit=${id}&saved=1`);
}

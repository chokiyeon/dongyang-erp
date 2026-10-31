"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { saveProjectBudget } from "@/lib/project-budgets";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";
export async function saveBudgetAction(_state: FormState, data: FormData): Promise<FormState> {
  await requireAdmin(); let id = "";
  try { id = await getDb().$transaction((tx) => saveProjectBudget(tx, data)); }
  catch (e) { return { error: e instanceof InputError ? e.message : "예산을 저장하지 못했습니다. 다시 확인해 주세요." }; }
  revalidatePath("/", "layout"); redirect(`/project-budgets?edit=${id}&saved=1`);
}

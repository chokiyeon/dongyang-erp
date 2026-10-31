"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { saveBaseline } from "@/lib/forecast";
import { createCashPlan, settleCashPlan, voidCashSettlement } from "@/lib/cash";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";
async function perform(action: "create" | "settle" | "baseline", data: FormData): Promise<FormState> {
  await requireAdmin();
  try {
    await getDb().$transaction((tx) => action === "baseline" ? saveBaseline(tx, data) : action === "create" ? createCashPlan(tx, data) : settleCashPlan(tx, data));
  } catch (error) {
    return { error: error instanceof InputError ? error.message : "저장하지 못했습니다. 목록을 새로 열고 다시 시도해 주세요." };
  }
  revalidatePath("/", "layout");
  redirect("/cash?saved=1");
}
export async function createCashAction(_previous: FormState, data: FormData) { return perform("create", data); }
export async function settleCashAction(_previous: FormState, data: FormData) { return perform("settle", data); }

export async function saveBaselineAction(_previous: FormState, data: FormData) { return perform("baseline", data); }

export async function voidSettlementAction(_previous: FormState, data: FormData): Promise<FormState> {
  await requireAdmin(); let id = "";
  try { id = await getDb().$transaction((tx) => voidCashSettlement(tx, data)); }
  catch (error) { return { error: error instanceof InputError ? error.message : "처리 내역을 취소하지 못했습니다. 다시 확인해 주세요." }; }
  revalidatePath("/", "layout"); redirect(`/cash?process=${id}&saved=1`);
}

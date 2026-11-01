"use server";
import {connectTradeCashPlan} from "@/lib/trade-cash";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { saveTradeDocument, voidTradeDocument, linkTradeBank, unlinkTradeBank } from "@/lib/trades";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";
type Operation = "save" | "void" | "link" | "unlink" | "cash";
async function perform(operation: Operation, data: FormData): Promise<FormState> {
  await requireAdmin(); let id = "";
  try { id = await getDb().$transaction((tx) => ({ cash:connectTradeCashPlan, save: saveTradeDocument, void: voidTradeDocument, link: linkTradeBank, unlink: unlinkTradeBank })[operation](tx,data), { timeout: 15000 }); }
  catch (e) { return { error: e instanceof InputError ? e.message : e && typeof e === "object" && "code" in e && e.code === "P2002" ? "이미 등록된 관리번호 또는 요청입니다. 목록을 확인해 주세요." : "자료를 저장하지 못했습니다. 다시 확인해 주세요." }; }
  revalidatePath("/", "layout"); redirect(`/trades?edit=${id}&saved=${operation}`);
}
export async function saveTradeAction(_s: FormState, data: FormData) { return perform("save", data); }
export async function voidTradeAction(_s: FormState, data: FormData) { return perform("void", data); }
export async function linkTradeAction(_s: FormState, data: FormData) { return perform("link", data); }
export async function unlinkTradeAction(_s: FormState, data: FormData) { return perform("unlink", data); }

export async function connectCashAction(_s:FormState,data:FormData){return perform("cash",data);}

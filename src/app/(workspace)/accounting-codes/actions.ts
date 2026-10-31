"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { importAccountingCodes, saveAccountingCode } from "@/lib/accounting-codes";
import { InputError } from "@/lib/validation";
import { Prisma } from "@/generated/prisma/client";
import type { FormState } from "@/components/record-form";
async function perform(mode: "save" | "import", data: FormData): Promise<FormState> {
  await requireAdmin();
  try { await getDb().$transaction(async (tx) => { if (mode === "save") await saveAccountingCode(tx, data); else await importAccountingCodes(tx, data); }, { timeout: 30000 }); }
  catch (error) { return { error: error instanceof InputError ? error.message : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "이미 등록된 회계코드입니다." : "회계코드를 저장하지 못했습니다. 자료를 확인해 주세요." }; }
  revalidatePath("/", "layout"); redirect("/accounting-codes?saved=1");
}
export async function saveCodeAction(_state: FormState, data: FormData) { return perform("save", data); }
export async function importCodesAction(_state: FormState, data: FormData) { return perform("import", data); }

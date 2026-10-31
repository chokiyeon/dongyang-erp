"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { saveCompany, saveMaster, type Kind } from "@/lib/master-data";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";

function message(error: unknown): FormState {
  if (error instanceof InputError) return { error: error.message };
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { error: "이미 등록된 코드 또는 계좌 별칭입니다. 목록을 확인해 주세요." };
  return { error: "저장하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요." };
}
async function master(kind: Kind, data: FormData): Promise<FormState> {
  await requireAdmin();
  try { await saveMaster(getDb(), kind, data); } catch (error) { return message(error); }
  revalidatePath("/", "layout");
  redirect(`/${kind}?saved=1`);
}
export async function savePartnerAction(_previous: FormState, data: FormData) { return master("partners", data); }
export async function saveProjectAction(_previous: FormState, data: FormData) { return master("projects", data); }
export async function saveAccountAction(_previous: FormState, data: FormData) { return master("accounts", data); }
export async function saveCompanyAction(_previous: FormState, data: FormData): Promise<FormState> {
  await requireAdmin();
  try { await saveCompany(getDb(), data); } catch (error) { return message(error); }
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

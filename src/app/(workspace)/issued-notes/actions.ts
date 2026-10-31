"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createIssuedNote, voidIssuedNote } from "@/lib/issued-notes";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";
async function perform(operation:"create"|"void",data:FormData):Promise<FormState>{
  await requireAdmin();let id="";
  try{id=await getDb().$transaction(tx=>operation==="create"?createIssuedNote(tx,data):voidIssuedNote(tx,data));}catch(e){return{error:e instanceof InputError?e.message:e&&typeof e==="object"&&"code"in e&&e.code==="P2002"?"같은 어음번호·요청 또는 이미 연결한 예정이 있습니다. 기존 내역을 확인하세요.":"어음대장을 저장하지 못했습니다. 다시 확인해 주세요."};}
  revalidatePath("/","layout");redirect(`/issued-notes?view=${id}&saved=${operation}`);
}
export async function createIssuedNoteAction(_s:FormState,data:FormData){return perform("create",data);}
export async function voidIssuedNoteAction(_s:FormState,data:FormData){return perform("void",data);}

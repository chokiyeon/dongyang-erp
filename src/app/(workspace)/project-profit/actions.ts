"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { saveProjectProfit } from "@/lib/project-profit";
import { InputError } from "@/lib/validation";
import type { FormState } from "@/components/record-form";
async function perform(operation:"estimate"|"cost"|"void",data:FormData):Promise<FormState>{
  await requireAdmin();let id="";
  try{id=await getDb().$transaction(tx=>saveProjectProfit(tx,data,operation));}catch(e){return{error:e instanceof InputError?e.message:e&&typeof e==="object"&&"code"in e&&e.code==="P2002"?"같은 추가원가 관리번호가 있습니다. 기존 내역을 확인하세요.":"원가·전망을 저장하지 못했습니다. 다시 확인해 주세요."};}
  revalidatePath("/","layout");redirect(`/project-profit?project=${id}&saved=${operation}`);
}
export async function saveEstimateAction(_s:FormState,data:FormData){return perform("estimate",data);}
export async function saveCostAction(_s:FormState,data:FormData){return perform("cost",data);}
export async function voidCostAction(_s:FormState,data:FormData){return perform("void",data);}

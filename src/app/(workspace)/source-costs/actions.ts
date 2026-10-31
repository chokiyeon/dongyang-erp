"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveSourceCosts} from "@/lib/source-costs";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:"review"|"void",d:FormData):Promise<FormState>{await requireAdmin();try{await getDb().$transaction(tx=>saveSourceCosts(tx,op,d),{timeout:20000});}catch(e){return{error:e instanceof InputError?e.message:"원가 배부를 저장하지 못했습니다. 다시 조회하세요."};}revalidatePath("/","layout");redirect(`/source-costs?type=${d.get("sourceType")}&source=${d.get("sourceId")}&saved=1`);}
export async function reviewCostsAction(_s:FormState,d:FormData){return perform("review",d);}
export async function voidCostsAction(_s:FormState,d:FormData){return perform("void",d);}

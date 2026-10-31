"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveFinance} from "@/lib/finance-review";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:Parameters<typeof saveFinance>[1],d:FormData):Promise<FormState>{await requireAdmin();let id="";try{id=await getDb().$transaction(tx=>saveFinance(tx,op,d),{isolationLevel:"RepeatableRead",timeout:30000});}catch(e){return{error:e instanceof InputError?e.message:"자료가 변경되었거나 저장하지 못했습니다. 새로 조회해 다시 시도하세요."};}revalidatePath("/","layout");redirect(op==="tax"?`/corporate-tax?period=${d.get("period")}&saved=1`:`/accounting-delivery?period=${d.get("period")}&package=${id}&saved=1`);}
export async function saveTaxAction(_s:FormState,d:FormData){return perform("tax",d);}
export async function captureAction(_s:FormState,d:FormData){return perform("capture",d);}
export async function deliverAction(_s:FormState,d:FormData){return perform("deliver",d);}
export async function closeAction(_s:FormState,d:FormData){return perform("close",d);}
export async function reopenAction(_s:FormState,d:FormData){return perform("reopen",d);}

"use server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {savePeriodReview} from "@/lib/period-review";
import {InputError} from "@/lib/validation";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import type {FormState} from "@/components/record-form";
async function perform(op:"close"|"reopen",d:FormData):Promise<FormState>{await requireAdmin();try{await getDb().$transaction(tx=>savePeriodReview(tx,op,d),{isolationLevel:"ReadCommitted",timeout:30000});}catch(e){return{error:e instanceof InputError?e.message:"마감 상태가 변경되었거나 저장하지 못했습니다. 다시 조회하세요."};}revalidatePath("/","layout");redirect(`/period-review?period=${encodeURIComponent(String(d.get("period")))}&saved=1`);}
export async function closePeriodAction(_s:FormState,d:FormData){return perform("close",d);}
export async function reopenPeriodAction(_s:FormState,d:FormData){return perform("reopen",d);}

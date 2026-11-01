"use server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveBankReconciliation,baselineFromReconciliation} from "@/lib/bank-reconciliation";
import {InputError} from "@/lib/validation";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import type {FormState} from "@/components/record-form";
async function perform(op:"save"|"baseline",d:FormData):Promise<FormState>{await requireAdmin();try{await getDb().$transaction(tx=>op==="save"?saveBankReconciliation(tx,d):baselineFromReconciliation(tx,d),{timeout:30000});}catch(e){return{error:e instanceof InputError?e.message:"잔액 대조를 저장하지 못했습니다. 다시 조회하세요."};}revalidatePath("/","layout");redirect(`/bank-reconciliation?period=${encodeURIComponent(String(d.get("period")))}&account=${encodeURIComponent(String(d.get("accountId")??""))}&saved=1`);}
export async function saveReconciliationAction(_s:FormState,d:FormData){return perform("save",d);}
export async function baselineFromReconciliationAction(_s:FormState,d:FormData){return perform("baseline",d);}

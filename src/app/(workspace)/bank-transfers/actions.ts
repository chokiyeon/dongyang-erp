"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveBankTransfer} from "@/lib/bank-transfers";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:"pair"|"unpair",d:FormData):Promise<FormState>{await requireAdmin();let id="";try{id=await getDb().$transaction(tx=>saveBankTransfer(tx,op,d),{timeout:15000});}catch(e){return{error:e instanceof InputError?e.message:"이체 연결을 저장하지 못했습니다. 다시 조회하세요."};}revalidatePath("/","layout");redirect(`/bank-transfers?view=${id}&saved=1`);}
export async function pairTransferAction(_s:FormState,d:FormData){return perform("pair",d);}
export async function unpairTransferAction(_s:FormState,d:FormData){return perform("unpair",d);}

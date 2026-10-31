"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {savePayroll} from "@/lib/payroll";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:"confirm"|"void",d:FormData):Promise<FormState>{await requireAdmin();try{await getDb().$transaction(tx=>savePayroll(tx,op,d),{timeout:15000});}catch(e){return{error:e instanceof InputError?e.message:"급여 지급 예정을 저장하지 못했습니다. 다시 조회하세요."};}revalidatePath("/","layout");redirect(`/payroll-payments?period=${d.get("period")}&employee=${d.get("employeeId")}&saved=1`);}
export async function confirmPayrollAction(_s:FormState,d:FormData){return perform("confirm",d);}
export async function voidPayrollAction(_s:FormState,d:FormData){return perform("void",d);}

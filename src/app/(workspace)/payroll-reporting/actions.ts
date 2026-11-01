"use server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {savePayrollReporting} from "@/lib/payroll-reporting";
import {InputError} from "@/lib/validation";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import type {FormState} from "@/components/record-form";
export async function saveReportingAction(_s:FormState,d:FormData):Promise<FormState>{
 await requireAdmin();try{await getDb().$transaction(tx=>savePayrollReporting(tx,d),{timeout:30000});}catch(e){return{error:e instanceof InputError?e.message:"신고자료를 저장하지 못했습니다. 다시 조회하세요."};}
 revalidatePath("/","layout");redirect(`/payroll-reporting?period=${encodeURIComponent(String(d.get("period")))}&employee=${encodeURIComponent(String(d.get("employeeId")))}&saved=1`);
}

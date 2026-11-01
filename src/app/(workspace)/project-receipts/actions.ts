"use server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {createProjectReceipt} from "@/lib/cash-schedule";
import {InputError} from "@/lib/validation";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import type {FormState} from "@/components/record-form";
export async function createReceiptAction(_s:FormState,d:FormData):Promise<FormState>{await requireAdmin();try{await getDb().$transaction(tx=>createProjectReceipt(tx,d),{timeout:30000});}catch(e){return{error:e instanceof InputError?e.message:"수금 일정을 저장하지 못했습니다. 다시 조회하세요."};}revalidatePath("/","layout");redirect(`/project-receipts?project=${encodeURIComponent(String(d.get("projectId")))}&saved=1`);}

"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveWorkBatch} from "@/lib/work-batch";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
export async function saveWorkBatchAction(_s:FormState,data:FormData){await requireAdmin();try{await getDb().$transaction(tx=>saveWorkBatch(tx,data),{timeout:30000});}catch(e){return{error:e instanceof InputError?e.message:"월별 공수를 저장하지 못했습니다. 다시 조회하세요. 입력한 묶음은 저장하지 않았습니다."};}revalidatePath("/","layout");redirect(`/work-records?${new URLSearchParams({period:String(data.get("period")),employee:String(data.get("employeeId")),project:String(data.get("projectId")),saved:"1"})}`);}

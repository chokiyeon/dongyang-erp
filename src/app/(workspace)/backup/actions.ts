"use server";
import {requireAdmin} from "@/lib/auth";
import {runNasBackup} from "@/lib/nas-backup";
import {InputError} from "@/lib/validation";
import {revalidatePath} from "next/cache";
import {redirect} from "next/navigation";
import type {FormState} from "@/components/record-form";
export async function backupNasAction(_s:FormState,d:FormData):Promise<FormState>{await requireAdmin();if(d.get("confirmed")!=="on")return{error:"메인 PC와 NAS 연결, 백업 폴더 권한을 확인하세요."};try{await runNasBackup();}catch(e){revalidatePath("/backup");return{error:e instanceof InputError?e.message:"NAS 백업을 완료하지 못했습니다."};}revalidatePath("/backup");redirect("/backup?saved=1");}

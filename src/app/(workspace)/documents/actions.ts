"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {setDocumentArchived} from "@/lib/documents";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(archive:boolean,d:FormData):Promise<FormState>{await requireAdmin();try{await getDb().$transaction(tx=>setDocumentArchived(tx,d,archive));}catch(e){return{error:e instanceof InputError?e.message:"첨부 상태를 변경하지 못했습니다."};}revalidatePath("/documents");redirect(`/documents?selected=${d.get("attachmentId")}&archived=1&saved=1`);}
export async function archiveDocumentAction(_s:FormState,d:FormData){return perform(true,d);}
export async function restoreDocumentAction(_s:FormState,d:FormData){return perform(false,d);}

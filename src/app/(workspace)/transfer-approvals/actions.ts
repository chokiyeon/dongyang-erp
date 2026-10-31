"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveTransferApproval} from "@/lib/transfer-approvals";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:Parameters<typeof saveTransferApproval>[1],d:FormData):Promise<FormState>{await requireAdmin();let id="";try{id=await getDb().$transaction(tx=>saveTransferApproval(tx,op,d),{isolationLevel:"RepeatableRead",timeout:20000});}catch(e){return{error:e instanceof InputError?e.message:"송금 검토본을 저장하지 못했습니다. 다시 조회하세요."};}revalidatePath("/","layout");redirect(`/transfer-approvals?view=${id}&saved=1`);}
export async function createApprovalAction(_s:FormState,d:FormData){return perform("create",d);}
export async function approveAction(_s:FormState,d:FormData){return perform("approve",d);}
export async function rejectAction(_s:FormState,d:FormData){return perform("reject",d);}
export async function voidApprovalAction(_s:FormState,d:FormData){return perform("void",d);}

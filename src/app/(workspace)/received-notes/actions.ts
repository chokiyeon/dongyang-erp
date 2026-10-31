"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {createReceivedNote,discountReceivedNote,changeReceivedNote} from "@/lib/received-notes";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
type Operation="create"|"discount"|"void"|"mature"|"undoMaturity";
async function perform(operation:Operation,data:FormData):Promise<FormState>{
 await requireAdmin();let id="";
 try{id=await getDb().$transaction(tx=>operation==="create"?createReceivedNote(tx,data):operation==="discount"?discountReceivedNote(tx,data):changeReceivedNote(tx,data,operation));}catch(e){return{error:e instanceof InputError?e.message:e&&typeof e==="object"&&"code"in e&&e.code==="P2002"?"같은 어음번호·요청 또는 이미 연결한 예정입니다. 기존 내역을 확인하세요.":"수취어음 내역을 저장하지 못했습니다. 다시 확인하세요."};}
 revalidatePath("/","layout");redirect(`/received-notes?view=${id}&saved=${operation}`);
}
export async function createReceivedAction(_s:FormState,d:FormData){return perform("create",d);}
export async function discountReceivedAction(_s:FormState,d:FormData){return perform("discount",d);}
export async function voidReceivedAction(_s:FormState,d:FormData){return perform("void",d);}
export async function matureReceivedAction(_s:FormState,d:FormData){return perform("mature",d);}
export async function undoMaturityAction(_s:FormState,d:FormData){return perform("undoMaturity",d);}

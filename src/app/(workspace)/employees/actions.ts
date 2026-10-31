"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveLabor} from "@/lib/labor";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:Parameters<typeof saveLabor>[1],d:FormData):Promise<FormState>{
 await requireAdmin();let id="";
 try{id=await getDb().$transaction(tx=>saveLabor(tx,op,d),{timeout:15000});}catch(e){return{error:e instanceof InputError?e.message:e&&typeof e==="object"&&"code"in e&&e.code==="P2002"?"같은 직원 코드 또는 요청이 있습니다. 기존 내역을 확인하세요.":"인력 자료를 저장하지 못했습니다. 다시 확인하세요."};}
 revalidatePath("/","layout");redirect(op==="work"?`/work-records?edit=${id}&saved=1`:op==="workVoid"?`/work-records?saved=1`:`/employees?edit=${id}&saved=1`);
}
export async function saveEmployeeAction(_s:FormState,d:FormData){return perform("employee",d);}
export async function saveRateAction(_s:FormState,d:FormData){return perform("rate",d);}
export async function voidRateAction(_s:FormState,d:FormData){return perform("rateVoid",d);}
export async function saveWorkAction(_s:FormState,d:FormData){return perform("work",d);}
export async function voidWorkAction(_s:FormState,d:FormData){return perform("workVoid",d);}

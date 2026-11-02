"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveStock} from "@/lib/stock";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:Parameters<typeof saveStock>[1],d:FormData):Promise<FormState>{await requireAdmin();let result;try{result=await getDb().$transaction(tx=>saveStock(tx,op,d),{timeout:20000});}catch(e){return{error:e instanceof InputError?e.message:e&&typeof e==="object"&&"code"in e&&e.code==="P2002"?"같은 품목·장소 코드 또는 입출고 번호가 있습니다.":"재고 내역을 저장하지 못했습니다. 다시 조회하세요."};}revalidatePath("/","layout");redirect(`/inventory?${"materialId"in result?`item=${result.materialId}`:`location=${result.locationId}`}&saved=1`);}
export async function saveItemAction(_s:FormState,d:FormData){return perform("item",d);}
export async function saveLocationAction(_s:FormState,d:FormData){return perform("location",d);}
export async function saveMovementAction(_s:FormState,d:FormData){return perform("move",d);}
export async function voidMovementAction(_s:FormState,d:FormData){return perform("void",d);}

export async function linkMovementAction(_s:FormState,d:FormData){return perform("link",d);}

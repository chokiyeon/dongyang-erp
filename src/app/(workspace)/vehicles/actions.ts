"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveVehicle} from "@/lib/vehicles";
import {paymentMonth} from "@/lib/payment-terms";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:Parameters<typeof saveVehicle>[1],d:FormData):Promise<FormState>{await requireAdmin();let id="";let period="";try{if(d.get("period"))period=paymentMonth(String(d.get("period")));id=await getDb().$transaction(tx=>saveVehicle(tx,op,d),{timeout:15000});}catch(e){return{error:e instanceof InputError?e.message:e&&typeof e==="object"&&"code"in e&&e.code==="P2002"?"같은 차량번호 또는 차량 비용 관리번호가 있습니다.":"차량 자료를 저장하지 못했습니다. 다시 확인하세요."};}revalidatePath("/","layout");redirect(`/vehicles?vehicle=${id}${period?`&period=${period}`:""}&saved=1`);}
export async function saveVehicleAction(_s:FormState,d:FormData){return perform("vehicle",d);}
export async function saveAssignmentAction(_s:FormState,d:FormData){return perform("assignment",d);}
export async function voidAssignmentAction(_s:FormState,d:FormData){return perform("assignmentVoid",d);}
export async function saveExpenseAction(_s:FormState,d:FormData){return perform("expense",d);}
export async function voidExpenseAction(_s:FormState,d:FormData){return perform("expenseVoid",d);}

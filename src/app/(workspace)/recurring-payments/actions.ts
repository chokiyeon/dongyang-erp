"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {saveRecurringTemplate,generateRecurringMonth,confirmMonthlyPayment,voidMonthlyPayment} from "@/lib/recurring-payments";
import {InputError} from "@/lib/validation";
import type {FormState} from "@/components/record-form";
async function perform(op:"template"|"generate"|"confirm"|"void",d:FormData):Promise<FormState>{
 await requireAdmin();let target="";
 try{target=await getDb().$transaction(async tx=>{
  if(op==="template"){const id=await saveRecurringTemplate(tx,d);return`/recurring-payments?edit=${id}&saved=template`;}
  if(op==="generate"){const r=await generateRecurringMonth(tx,d);return`/recurring-payments?period=${r.period}&saved=generate&count=${r.count}`;}
  const id=op==="confirm"?await confirmMonthlyPayment(tx,d):await voidMonthlyPayment(tx,d);const r=await tx.monthlyPayment.findUniqueOrThrow({where:{id}});return`/recurring-payments?period=${r.period}&confirm=${id}&saved=${op}`;
 },{timeout:15000});}catch(e){return{error:e instanceof InputError?e.message:e&&typeof e==="object"&&"code"in e&&e.code==="P2002"?"같은 코드·지급월·청구자료·예정 연결이 있습니다. 기존 내역을 확인하세요.":"정기 지급을 저장하지 못했습니다. 다시 확인하세요."};}
 revalidatePath("/","layout");redirect(target);
}
export async function saveTemplateAction(_s:FormState,d:FormData){return perform("template",d);}
export async function generateMonthAction(_s:FormState,d:FormData){return perform("generate",d);}
export async function confirmMonthAction(_s:FormState,d:FormData){return perform("confirm",d);}
export async function voidMonthAction(_s:FormState,d:FormData){return perform("void",d);}

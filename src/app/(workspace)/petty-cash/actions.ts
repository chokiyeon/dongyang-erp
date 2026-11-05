'use server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {savePettyCash,voidPettyCash,countPettyCash} from '@/lib/petty-cash';
import {InputError} from '@/lib/validation';
import type {FormState} from '@/components/record-form';
async function run(data:FormData,voided=false):Promise<FormState>{await requireAdmin();let period='';try{const id=await getDb().$transaction(tx=>voided?voidPettyCash(tx,data):savePettyCash(tx,data));period=(await getDb().pettyCashEntry.findUniqueOrThrow({where:{id},select:{entryDate:true}})).entryDate.toISOString().slice(0,7);}catch(e){return{error:e instanceof InputError?e.message:'현금 장부를 저장하지 못했습니다. 현재 내역을 다시 확인하세요.'};}revalidatePath('/','layout');redirect(`/petty-cash?period=${period}&saved=${voided?'void':'create'}`);}
export async function saveAction(_s:FormState,d:FormData){return run(d);}
export async function voidAction(_s:FormState,d:FormData){return run(d,true);}

export async function countAction(_s:FormState,d:FormData):Promise<FormState>{await requireAdmin();let period='';try{period=await getDb().$transaction(tx=>countPettyCash(tx,d));}catch(e){return{error:e instanceof InputError?e.message:'현금 실사 내역을 저장하지 못했습니다.'};}revalidatePath('/','layout');redirect(`/petty-cash?period=${period}&saved=count`);}

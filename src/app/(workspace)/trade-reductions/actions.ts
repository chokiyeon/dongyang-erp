"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {undoTradeReduction} from '@/lib/trade-reductions';
import {InputError} from '@/lib/validation';
import type {FormState} from '@/components/record-form';
export async function undoReductionAction(_state:FormState,data:FormData):Promise<FormState>{await requireAdmin();let id='';try{id=await getDb().$transaction(tx=>undoTradeReduction(tx,data),{timeout:15000});}catch(e){return {error:e instanceof InputError?e.message:'감액 정정을 저장하지 못했습니다.'};}revalidatePath('/','layout');redirect(`/trade-reductions?view=${id}&saved=undo`);}

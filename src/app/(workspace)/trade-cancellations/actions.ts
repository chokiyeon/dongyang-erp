"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {requireAdmin} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {undoTradeCancellation} from '@/lib/trade-cancellations';
import {InputError} from '@/lib/validation';
import type {FormState} from '@/components/record-form';
export async function undoCancellationAction(_state:FormState,data:FormData):Promise<FormState>{
 await requireAdmin();let id='';try{id=await getDb().$transaction(tx=>undoTradeCancellation(tx,data));}catch(e){return {error:e instanceof InputError?e.message:'등록 정정을 저장하지 못했습니다.'};}revalidatePath('/','layout');redirect(`/trade-cancellations?view=${id}&saved=undo`);
}

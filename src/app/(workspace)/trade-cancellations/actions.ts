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

export async function amendRefundScheduleAction(_state:FormState,data:FormData):Promise<FormState>{
 await requireAdmin();let id='';try{const{amendRefundSchedule}=await import('@/lib/refund-schedule');id=await getDb().$transaction(tx=>amendRefundSchedule(tx,data),{timeout:20000});}catch(e){return {error:e instanceof InputError?e.message:'환급 예정일을 저장하지 못했습니다.'};}revalidatePath('/','layout');redirect(`/trade-cancellations?view=${id}&saved=schedule`);
}

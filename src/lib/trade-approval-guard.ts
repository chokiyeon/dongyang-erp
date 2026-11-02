import type {Prisma} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError} from './validation';
/** Caller must hold the company period lock before checking cross-record identifiers. */
export async function assertNoCancellationApproval(tx:Prisma.TransactionClient,approval:string){
 if(await tx.tradeCancellation.findFirst({where:{companyId:COMPANY_ID,voidedAt:null,OR:[{taxApprovalNumber:approval},{originalApproval:approval}]},select:{id:true}}))throw new InputError('전액취소 수정증빙 또는 그 취소 원본에 사용된 승인번호입니다. 수정·취소 이력을 확인하세요.');
}

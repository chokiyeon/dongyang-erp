import type {Prisma,PrismaClient} from '@/generated/prisma/client';
import type {DeliveryTable} from './accounting-delivery';
import {COMPANY_ID} from './constants';
import {InputError} from './validation';
export const RETURN_CREDIT_OPERATIONS=['RETURN_CREDIT_MATCH','RETURN_CREDIT_UNMATCH','RETURN_CANCEL_MATCH','RETURN_CANCEL_UNMATCH'];
function change(row:{previous:unknown;next:unknown}){
 const before=row.previous as {reductionId?:unknown;cancellationId?:unknown}|null,after=row.next as {movementId?:unknown;effectiveDate?:unknown;reductionId?:unknown;cancellationId?:unknown}|null;
 if(!before||!after||typeof after.movementId!=='string'||typeof after.effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(after.effectiveDate)||before.reductionId!==null&&typeof before.reductionId!=='string'||after.reductionId!==null&&typeof after.reductionId!=='string')throw new InputError('반품·감액 대조 이력의 날짜·원본 관계를 확인하세요.');
 const previousCancellation=before.cancellationId??null,nextCancellation=after.cancellationId??null;
 if(previousCancellation!==null&&typeof previousCancellation!=='string'||nextCancellation!==null&&typeof nextCancellation!=='string'||previousCancellation&&before.reductionId||nextCancellation&&after.reductionId)throw new InputError('반품의 부분 감액·전액취소 연결 이력을 확인하세요.');
 const previousReduction=before.reductionId as string|null,nextReduction=after.reductionId as string|null;
 return{movementId:after.movementId,effectiveDate:after.effectiveDate,previous:previousCancellation?`전액취소:${previousCancellation}`:previousReduction,next:nextCancellation?`전액취소:${nextCancellation}`:nextReduction,previousReduction,nextReduction,previousCancellation:previousCancellation as string|null,nextCancellation:nextCancellation as string|null};
}
export async function stockReturnDelivery(db:PrismaClient|Prisma.TransactionClient,period:string,rows:{id:string;kind:string;returnOfId:string|null;reductionId:string|null;cancellationId?:string|null;reference:string;movedDate:Date;quantity:{toFixed(n:number):string};supplyAmount:{toFixed(n:number):string}|null;voidedAt:Date|null;sourceNote:string}[]){
 const idsInPeriod=rows.filter(r=>r.kind==='RETURN'||r.kind==='VALUE_CREDIT').map(r=>r.id);
 const histories=await db.stockChange.findMany({where:{material:{companyId:COMPANY_ID},operation:{in:RETURN_CREDIT_OPERATIONS},OR:[{next:{path:['effectiveDate'],string_starts_with:period}},...idsInPeriod.map(id=>({next:{path:['movementId'],equals:id}}))]},orderBy:[{createdAt:'desc'},{id:'desc'}]});
 const events=histories.map(h=>({row:h,value:change(h)}));
 const tables:DeliveryTable[]=[];
 const returns=rows.filter(r=>r.kind==='RETURN'||r.kind==='VALUE_CREDIT');
 if(returns.length)tables.push({title:'공급처 반품 원본 대조',headers:['반품 식별자','반품일','반품 관리번호','원 입고 식별자','반품 수량','반품 공급가액','작성월 말 감액 대조','상태','반품 원본 메모','반영 기준'],rows:returns.map(r=>{let linked=r.cancellationId?`전액취소:${r.cancellationId}`:r.reductionId;for(const e of events.filter(e=>e.value.movementId===r.id))if(e.value.effectiveDate.slice(0,7)>period)linked=e.value.previous;return[r.id,r.movedDate.toISOString().slice(0,10),r.reference,r.returnOfId??'',r.quantity.toFixed(4),r.supplyAmount?.toFixed(0)??'',linked??'미대조',r.voidedAt?'입력 정정':'반품 반영',r.sourceNote,r.kind==='VALUE_CREDIT'?'단가 감액 대조 · 수량 변동 없음 · 원가·세액 재가산 금지':'실제 재고 감소 · 감액/환급과 별도 · 원가·세액 재가산 금지'];})});
 const current=events.filter(e=>e.value.effectiveDate.slice(0,7)===period).reverse();
 if(current.length)tables.push({title:'반품·감액 대조 변경',headers:['이력 식별자','반품 식별자','확인일','이전 감액증빙','변경 감액증빙','사유'],rows:current.map(e=>[e.row.id,e.value.movementId,e.value.effectiveDate,e.value.previous??'',e.value.next??'',e.row.reason])});
 const ids=[...new Set(current.flatMap(e=>[e.value.previousReduction,e.value.nextReduction]).filter((id):id is string=>Boolean(id)))];
 const proofs=ids.length?await db.tradeReduction.findMany({where:{id:{in:ids},companyId:COMPANY_ID},select:{fileId:true}}):[];
 const cancellationIds=[...new Set(current.flatMap(e=>[e.value.previousCancellation,e.value.nextCancellation]).filter((id):id is string=>Boolean(id)))];
 const cancellationProofs=cancellationIds.length?await db.tradeCancellation.findMany({where:{id:{in:cancellationIds},companyId:COMPANY_ID},select:{fileId:true}}):[];
 return{tables,fileIds:[...proofs,...cancellationProofs].map(r=>r.fileId)};
}

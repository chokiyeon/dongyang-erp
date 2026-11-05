import {vehiclePeriodState,prepareVehiclePeriod,applyVehiclePeriod,vehiclePeriodRestore,applyVehiclePeriodUndo,activeVehiclePeriods,type PreparedVehicleExpense} from './trade-vehicle-period';
import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError} from './validation';
import {assertPeriodsOpen} from './period-guard';
export type VehicleCostProposal={expenseId:string;version:number;vehicleVersion:number};
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const json=(v:unknown):Prisma.InputJsonValue=>JSON.parse(JSON.stringify(v));
export function prepareVehicleCostProposal(data:FormData):VehicleCostProposal|undefined{
 const raw=data.get('vehicleCost');if(!raw)return;
 if(typeof raw!=='string'||raw.length>1000||data.get('vehicleCostConfirmed')!=='on')throw new InputError('수정증빙과 차량 비용의 금액·취소 여부를 함께 확인하세요.');
 let v:unknown;try{v=JSON.parse(raw);}catch{throw new InputError('차량 비용 원본을 다시 선택하세요.');}const p=obj(v);
 if(typeof p.expenseId!=='string'||!p.expenseId||p.expenseId.length>50||!Number.isSafeInteger(p.version)||Number(p.version)<0||!Number.isSafeInteger(p.vehicleVersion)||Number(p.vehicleVersion)<0)throw new InputError('차량 비용이 변경되었습니다. 원본을 다시 선택하세요.');
 return{expenseId:p.expenseId,version:Number(p.version),vehicleVersion:Number(p.vehicleVersion)};
}
export async function creditVehicleCost(db:PrismaClient|Prisma.TransactionClient,id:string){
 const d=await db.tradeDocument.findFirst({where:{id,companyId:COMPANY_ID,kind:'PURCHASE',voidedAt:null},select:{id:true}});if(!d)return null;
 const e=await db.vehicleExpense.findFirst({where:{documentId:id,vehicle:{companyId:COMPANY_ID}},include:{vehicle:{select:{plate:true,version:true}}}});if(!e)return null;
 let amount=e.amount.toFixed(0),periodReady=false,periodError:string|null=null;const periodAdjusted=Boolean(await db.vehicleCostAdjustment.count({where:{...activeVehiclePeriods,expenseId:e.id}}));try{const state=await vehiclePeriodState(db,e.id);periodReady=true;if(periodAdjusted)amount=state.currentAmount;}catch(error){if(!(error instanceof InputError))throw error;periodError=error.message;}
 return{vehicleId:e.vehicleId,expenseId:e.id,version:e.version,vehicleVersion:e.vehicle.version,plate:e.vehicle.plate,reference:e.reference,title:e.title,amount,originalAmount:e.amount.toFixed(0),originalDate:e.incurredDate.toISOString().slice(0,10),periodAdjusted,periodReady,periodError,voided:Boolean(e.voidedAt)};
}
async function expense(db:PrismaClient|Prisma.TransactionClient,id:string){return db.vehicleExpense.findFirst({where:{documentId:id,vehicle:{companyId:COMPANY_ID}},include:{vehicle:{select:{id:true,version:true,plate:true}}}});}
export async function prepareVehicleSettlement(tx:Prisma.TransactionClient,id:string,proposal:VehicleCostProposal|undefined,scope:'SAME'|'LATER',effectiveDate?:string):Promise<PreparedVehicleExpense|null>{
 const e=await expense(tx,id);if(!e){if(proposal)throw new InputError('원 청구의 차량 비용 연결이 없습니다. 다시 조회하세요.');return null;}
 if(!proposal||proposal.expenseId!==e.id||proposal.version!==e.version||proposal.vehicleVersion!==e.vehicle.version)throw new InputError('현재 차량 비용과 수정증빙 반영 내역을 확인하세요.');
 if(scope==='LATER'){if(!effectiveDate)throw new InputError('차량의 수정 작성월을 확인하세요.');return prepareVehiclePeriod(tx,e,effectiveDate);}
 const d=await tx.tradeDocument.findFirstOrThrow({where:{id,companyId:COMPANY_ID,kind:'PURCHASE',voidedAt:null}});
 if(e.voidedAt||e.cashPlanId||e.payer!=='COMPANY'||e.paymentStatus==='PAID'||!e.amount.equals(d.grossAmount)||e.projectId!==d.projectId||e.companyExpense!==d.companyExpense||!d.proofConfirmed||e.incurredDate.toISOString().slice(0,7)!==d.issuedDate.toISOString().slice(0,7)||await tx.sourceCostReview.count({where:{companyId:COMPANY_ID,sourceType:'VEHICLE',sourceId:e.id,active:true}}))throw new InputError('차량 비용의 원 금액·회사 부담·공사·발생월과 별도 지급/원가 배부를 먼저 대조하세요.');
 await assertPeriodsOpen(tx,e.incurredDate,d.issuedDate);return e;
}
function requestId(seed:string){const s=createHash('sha256').update(`trade-vehicle:${seed}`).digest('hex').slice(0,32);return`${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
export async function applyVehicleSettlement(tx:Prisma.TransactionClient,e:PreparedVehicleExpense,amount:string,voided:boolean,request:string,reason:string,operation='tradeCredit',record:{reductionId?:string;cancellationId?:string}={}){
 if(e.periodUndo)return applyVehiclePeriodUndo(tx,e,amount,request,reason);
 if(e.period)return applyVehiclePeriod(tx,e,amount,voided,request,reason,record);
 const locked=await tx.vehicle.updateMany({where:{id:e.vehicleId,companyId:COMPANY_ID,version:e.vehicle.version},data:{version:{increment:1}}});if(locked.count!==1)throw new InputError('차량 정보가 변경되었습니다. 다시 조회하세요.');
 const changed=await tx.vehicleExpense.updateMany({where:{id:e.id,vehicleId:e.vehicleId,version:e.version,documentId:e.documentId,amount:e.amount,voidedAt:e.voidedAt},data:{amount,voidedAt:voided?new Date():null,version:{increment:1}}});if(changed.count!==1)throw new InputError('차량 비용이 변경되었습니다. 다시 조회하세요.');
 const next=await tx.vehicleExpense.findUniqueOrThrow({where:{id:e.id}}),rid=requestId(request),previous={...e,vehicle:undefined};
 const audit=await tx.vehicleChange.create({data:{vehicleId:e.vehicleId,requestId:rid,fingerprint:createHash('sha256').update(JSON.stringify({id:e.id,version:e.version,amount,voided,reason,operation})).digest('hex'),operation,previous:json(previous),next:json({id:e.vehicleId,expense:next}),reason}});return{expenseId:e.id,changeId:audit.id};
}
export function vehicleRestoreIdentity(data:FormData){return data.has('vehicleCostVersion')?{vehicleCostVersion:data.get('vehicleCostVersion'),vehicleVersion:data.get('vehicleVersion'),vehicleRestoreConfirmed:data.get('vehicleRestoreConfirmed')}:{};}
export async function creditVehicleRestore(db:PrismaClient|Prisma.TransactionClient,record:{id:string;requestId:string;originalDocumentId:string;vehicleRecordType?:'CANCELLATION'}){
 const change=await db.tradeDocumentChange.findUnique({where:{requestId:record.requestId}});if(!change||change.documentId!==record.originalDocumentId)return null;
 const next=obj(change.next);if(!next.vehicleSettlement)return null;
 if((record.vehicleRecordType==='CANCELLATION'?next.cancellationId:next.reductionId)!==record.id)throw new InputError('차량 수정 정산 이력을 확인하세요.');
 const meta=obj(next.vehicleSettlement);if(meta.kind==='PERIOD_VEHICLE')return vehiclePeriodRestore(db,record);if(typeof meta.expenseId!=='string'||typeof meta.changeId!=='string')throw new InputError('차량 정산 이력을 확인하세요.');
 const audit=await db.vehicleChange.findFirst({where:{id:meta.changeId,vehicle:{companyId:COMPANY_ID}}}),e=await expense(db,record.originalDocumentId);if(!audit||!e||e.id!==meta.expenseId||audit.vehicleId!==e.vehicleId)throw new InputError('복원할 원 차량 비용 연결을 확인하세요.');
 const before=obj(audit.previous);if(before.id!==e.id||before.documentId!==record.originalDocumentId||before.vehicleId!==e.vehicleId||before.voidedAt!==null||typeof before.amount!=='string'||!/^[1-9]\d{0,19}$/.test(before.amount))throw new InputError('수정증빙 반영 전 차량 비용을 확인하세요.');
 return{expense:e,before,amount:before.amount,plate:e.vehicle.plate,reference:e.reference,title:e.title,currentAmount:e.amount.toFixed(0),voided:Boolean(e.voidedAt),version:e.version,vehicleVersion:e.vehicle.version};
}
export async function prepareVehicleRestore(tx:Prisma.TransactionClient,record:{id:string;requestId:string;originalDocumentId:string;vehicleRecordType?:'CANCELLATION'},data:FormData){
 const restore=await creditVehicleRestore(tx,record);if(!restore)return null;const e=restore.expense,b=restore.before;
 if(data.get('vehicleRestoreConfirmed')!=='on'||data.get('vehicleCostVersion')!==String(e.version)||data.get('vehicleVersion')!==String(e.vehicle.version))throw new InputError('현재 차량 비용과 복원 내역을 다시 확인하세요.');
 if('periodUndo' in restore){if(restore.blocked)throw new InputError('차량 기간 조정은 최근 수정증빙부터 정정하세요.');await assertPeriodsOpen(tx,restore.periodUndo.effectiveDate);return{...restore,expense:{...e,periodUndo:restore.periodUndo}};}
 const d=await tx.tradeDocument.findFirstOrThrow({where:{id:record.originalDocumentId,companyId:COMPANY_ID,kind:'PURCHASE'}});
 if(e.cashPlanId||e.payer!=='COMPANY'||e.paymentStatus==='PAID'||e.incurredDate.toISOString().slice(0,7)!==d.issuedDate.toISOString().slice(0,7)||!e.amount.equals(d.grossAmount)||e.projectId!==d.projectId||e.companyExpense!==d.companyExpense||b.projectId!==e.projectId||b.companyExpense!==e.companyExpense||b.incurredDate!==e.incurredDate.toISOString()||await tx.sourceCostReview.count({where:{companyId:COMPANY_ID,sourceType:'VEHICLE',sourceId:e.id,active:true}}))throw new InputError('차량 비용의 후속 지급·공사·발생일 변경을 먼저 확인하세요.');
 await assertPeriodsOpen(tx,e.incurredDate,d.issuedDate);return restore;
}

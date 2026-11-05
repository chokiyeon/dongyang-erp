import {periodCostState,preparePeriodCost,applyPeriodCost,periodCostRestore,invalidatePeriodProjects,type PreparedPeriodCost} from './trade-cost-period';
import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError} from './validation';
import {assertPeriodsOpen} from './period-guard';
import {sourceCostBasis,saveSourceCosts} from './source-costs';
export type CreditCostAllocation={reviewId:string;version:number;basis:string;commonAmount:string;entries:{projectId:string;amount:string}[]};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new InputError('원가 배부 자료를 다시 확인하세요.');return v as Record<string,unknown>;};
const money=(v:unknown)=>{if(typeof v!=='string'||!/^(0|[1-9]\d{0,19})$/.test(v))throw new InputError('원가 배부액은 20자리 이내의 원 단위 정수로 입력하세요.');return v;};
function entries(v:unknown){if(!Array.isArray(v)||v.length>40)throw new InputError('원가 배부는 40개 현장 이내로 확인하세요.');const result=v.map(value=>{const r=object(value);if(typeof r.projectId!=='string'||!r.projectId||r.projectId.length>50)throw new InputError('배부 현장을 선택하세요.');const amount=money(r.amount);if(BigInt(amount)<=0n)throw new InputError('현장 배부액은 0보다 커야 합니다.');return{projectId:r.projectId,amount};}).sort((a,b)=>a.projectId.localeCompare(b.projectId));if(new Set(result.map(r=>r.projectId)).size!==result.length)throw new InputError('배부 현장을 중복 선택하지 마세요.');return result;}
export type PreparedCreditCost=CreditCostAllocation&{period?:PreparedPeriodCost;periodUndo?:{adjustmentId:string;effectiveDate:string}};
const total=(r:Pick<CreditCostAllocation,'commonAmount'|'entries'>)=>r.entries.reduce((s,e)=>s+BigInt(e.amount),BigInt(r.commonAmount)).toString();
export function prepareCreditCostAllocation(data:FormData):CreditCostAllocation|undefined{
 const raw=data.get('costAllocation');if(!raw)return;
 if(typeof raw!=='string'||raw.length>12000||data.get('costAllocationConfirmed')!=='on')throw new InputError('감액 후 현장별·본사 원가 배부와 중복 방지를 확인하세요.');
 let v:unknown;try{v=JSON.parse(raw);}catch{throw new InputError('원가 배부 자료를 다시 선택하세요.');}const r=object(v);
 if(typeof r.reviewId!=='string'||!r.reviewId||r.reviewId.length>50||!Number.isSafeInteger(r.version)||Number(r.version)<0||typeof r.basis!=='string'||!/^[a-f0-9]{64}$/.test(r.basis))throw new InputError('원가 배부가 변경되었습니다. 원본을 다시 선택하세요.');
 return{reviewId:r.reviewId,version:Number(r.version),basis:r.basis,commonAmount:money(r.commonAmount),entries:entries(r.entries)};
}
export async function creditCostAllocation(db:PrismaClient|Prisma.TransactionClient,id:string){
 const doc=await db.tradeDocument.findFirst({where:{id,companyId:COMPANY_ID,kind:'PURCHASE',voidedAt:null},select:{id:true,inputVatReview:true}});if(!doc)return null;
 const review=await db.sourceCostReview.findUnique({where:{companyId_sourceType_sourceId:{companyId:COMPANY_ID,sourceType:'TRADE',sourceId:id}},include:{entries:{where:{voidedAt:null,project:{companyId:COMPANY_ID}},include:{project:{select:{code:true,name:true}}},orderBy:{projectId:'asc'}}}});if(!review?.active)return null;
 let periodBasis:string|null=null,effective:{commonAmount:string;totalAmount:string;entries:{projectId:string;amount:string;label:string}[]}|null=null;const hasPeriod=Boolean(await db.tradeCostAdjustment.count({where:{reviewId:review.id,companyId:COMPANY_ID,reduction:{voidedAt:null}}}));let needsReview=review.needsReview;try{const state=await periodCostState(db,review.id);periodBasis=state.basis;if(hasPeriod){const projects=await db.project.findMany({where:{companyId:COMPANY_ID,id:{in:state.distribution.entries.map(e=>e.projectId)}},select:{id:true,code:true,name:true}});effective={commonAmount:state.distribution.commonAmount,totalAmount:state.totalAmount,entries:state.distribution.entries.map(e=>{const p=projects.find(p=>p.id===e.projectId);if(!p)throw new InputError('기간 원가의 회사 현장을 확인하세요.');return{...e,label:`${p.code} ${p.name}`};})};}}catch(e){if(!(e instanceof InputError))throw e;if(hasPeriod)needsReview=true;}
 return{periodBasis,periodAdjusted:hasPeriod,vatReview:doc.inputVatReview,reviewId:review.id,version:review.version,basis:review.basis,commonAmount:review.commonAmount.toFixed(0),totalAmount:review.totalAmount.toFixed(0),needsReview,entries:review.entries.map(e=>({projectId:e.projectId,amount:e.amount.toFixed(0),label:`${e.project.code} ${e.project.name}`})),...(effective??{})};
}
export async function prepareCostSettlement(tx:Prisma.TransactionClient,id:string,proposal:CreditCostAllocation|undefined,scope:'SAME'|'LATER',delta:{supply:string;tax:string;date?:string}):Promise<PreparedCreditCost|null>{
 const review=await tx.sourceCostReview.findUnique({where:{companyId_sourceType_sourceId:{companyId:COMPANY_ID,sourceType:'TRADE',sourceId:id}}});
 if(!review?.active){if(proposal)throw new InputError('원본에 유효한 공사 원가 배부가 없습니다. 다시 조회하세요.');return null;}
 if(scope==='LATER'){if(!proposal||!delta.date)throw new InputError('다른 달 감액의 현장별 기간 원가 정산을 확인하세요.');return preparePeriodCost(tx,id,proposal,delta.date,delta);}
 if(!proposal||proposal.reviewId!==review.id||proposal.version!==review.version||proposal.basis!==review.basis)throw new InputError('감액 후 공사별 원가 배부를 입력하고 현재 배부 기준을 확인하세요.');
 const doc=await tx.tradeDocument.findFirstOrThrow({where:{id,companyId:COMPANY_ID,kind:'PURCHASE',projectId:null,voidedAt:null}}),basis=await sourceCostBasis(tx,'TRADE',id);
 if(review.needsReview||review.basis!==basis.basis||review.totalAmount.toFixed(0)!==basis.suggestedTotal||review.incurredDate.getTime()!==doc.issuedDate.getTime())throw new InputError('기존 원가 배부가 미확인 또는 변경되었습니다. 원가 배부 화면에서 먼저 대조하세요.');
 await assertPeriodsOpen(tx,review.incurredDate,doc.issuedDate);
 const next=BigInt(doc.supplyAmount.toFixed(0))+BigInt(delta.supply)+(doc.inputVatReview==='NONDEDUCTIBLE'?BigInt(doc.taxAmount.toFixed(0))+BigInt(delta.tax):0n);
 if(next<=0n||total(proposal)!==next.toString())throw new InputError('감액 후 공사별 배부액과 본사 공통액 합계가 부가세 검토를 반영한 순원가와 같아야 합니다.');
 const projects=await tx.project.count({where:{companyId:COMPANY_ID,id:{in:proposal.entries.map(e=>e.projectId)}}});if(projects!==proposal.entries.length)throw new InputError('중복되지 않는 회사 현장을 선택하세요.');
 return proposal;
}
function requestId(seed:string){const s=createHash('sha256').update(`trade-cost:${seed}`).digest('hex').slice(0,32);return`${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;}
export async function applyCostSettlement(tx:Prisma.TransactionClient,id:string,proposal:PreparedCreditCost,request:string,reason:string,reductionId?:string){
 if(proposal.period){if(!reductionId)throw new InputError('기간 원가의 감액 증빙을 확인하세요.');return applyPeriodCost(tx,id,{...proposal,period:proposal.period},reductionId,reason);}
 if(proposal.periodUndo){const a=await tx.tradeCostAdjustment.findFirstOrThrow({where:{id:proposal.periodUndo.adjustmentId,companyId:COMPANY_ID,documentId:id}});await assertPeriodsOpen(tx,proposal.periodUndo.effectiveDate);const old=Array.isArray(a.afterEntries)?a.afterEntries as {projectId:string}[]:[];await invalidatePeriodProjects(tx,[...old,...proposal.entries].map(e=>e.projectId));return{reviewId:a.reviewId,adjustmentId:a.id,kind:'PERIOD_UNDO' as const};}
 const basis=await sourceCostBasis(tx,'TRADE',id),data=new FormData(),rid=requestId(request);
 for(const[k,v]of Object.entries({sourceType:'TRADE',sourceId:id,requestId:rid,version:String(proposal.version),basis:basis.basis,totalAmount:total(proposal),commonAmount:proposal.commonAmount,incurredDate:basis.defaultDate,confirmed:'on',noDuplicate:'on',reason}))data.set(k,v);
 for(const e of proposal.entries){data.append('allocationProjectId',e.projectId);data.append('allocationAmount',e.amount);}
 const reviewId=await saveSourceCosts(tx,'review',data),change=await tx.sourceCostChange.findUniqueOrThrow({where:{requestId:rid},select:{id:true}});
 return{reviewId,changeId:change.id};
}
export async function creditCostRestore(db:PrismaClient|Prisma.TransactionClient,record:{id:string;requestId:string;originalDocumentId:string;costRecordType?:'CANCELLATION'}){
 const change=await db.tradeDocumentChange.findUnique({where:{requestId:record.requestId}});if(!change||change.documentId!==record.originalDocumentId)return null;
 const next=object(change.next);if(!next.costSettlement)return null;if(object(next.costSettlement).kind==='PERIOD')return periodCostRestore(db,record);if((record.costRecordType==='CANCELLATION'?next.cancellationId:next.reductionId)!==record.id)throw new InputError('감액의 원가 정산 이력을 확인하세요.');const meta=object(next.costSettlement);
 if(typeof meta.changeId!=='string'||typeof meta.reviewId!=='string')throw new InputError('원가 정산 이력을 확인하세요.');
 const audit=await db.sourceCostChange.findFirst({where:{id:meta.changeId,reviewId:meta.reviewId,review:{companyId:COMPANY_ID,sourceType:'TRADE',sourceId:record.originalDocumentId}},include:{review:{include:{entries:{where:{voidedAt:null},include:{project:{select:{name:true,code:true}}}}}}}});if(!audit)throw new InputError('감액 전 원가 배부 이력을 찾지 못했습니다.');
 const before=object(audit.previous);if(before.id!==meta.reviewId||before.companyId!==COMPANY_ID||before.sourceType!=='TRADE'||before.sourceId!==record.originalDocumentId||before.active!==true||!Array.isArray(before.entries))throw new InputError('감액 전 원가 배부 원본을 확인하세요.');
 const oldEntries=entries(before.entries.filter(v=>object(v).voidedAt===null)),commonAmount=money(before.commonAmount),oldTotal=money(before.totalAmount),oldBasis=before.basis;
 if(typeof oldBasis!=='string'||!/^[a-f0-9]{64}$/.test(oldBasis)||total({commonAmount,entries:oldEntries})!==oldTotal)throw new InputError('감액 전 원가 배부 합계를 확인하세요.');
 const projectRows=await db.project.findMany({where:{companyId:COMPANY_ID,id:{in:oldEntries.map(e=>e.projectId)}},select:{id:true,code:true,name:true}});if(projectRows.length!==oldEntries.length)throw new InputError('복원할 회사 현장을 확인하세요.');
 return{proposal:{reviewId:audit.review.id,version:audit.review.version,basis:oldBasis,commonAmount,entries:oldEntries},totalAmount:oldTotal,incurredDate:String(before.incurredDate),entries:oldEntries.map(e=>({...e,label:projectRows.find(p=>p.id===e.projectId)!.name})),currentActive:audit.review.active,currentTotal:audit.review.totalAmount.toFixed(0),currentCommon:audit.review.commonAmount.toFixed(0),currentEntries:audit.review.entries.map(e=>({projectId:e.projectId,amount:e.amount.toFixed(0),label:`${e.project.code} ${e.project.name}`}))};
}
export async function prepareCostRestore(tx:Prisma.TransactionClient,record:{id:string;requestId:string;originalDocumentId:string;costRecordType?:'CANCELLATION'},data:FormData){
 const restore=await creditCostRestore(tx,record);if(!restore)return null;if('blocked' in restore&&restore.blocked)throw new InputError('기간 원가 조정은 최근 수정증빙부터 정정하세요.');
 if(data.get('costRestoreConfirmed')!=='on'||data.get('costReviewVersion')!==String(restore.proposal.version))throw new InputError('현재 배부와 감액 전 원가 복원 내역을 다시 확인하세요.');
 if('periodUndo' in restore.proposal){await assertPeriodsOpen(tx,restore.proposal.periodUndo.effectiveDate);return restore.proposal;}
 const doc=await tx.tradeDocument.findFirstOrThrow({where:{id:record.originalDocumentId,companyId:COMPANY_ID}});if(restore.incurredDate!==doc.issuedDate.toISOString())throw new InputError('원가 발생일과 원 청구를 확인하세요.');await assertPeriodsOpen(tx,doc.issuedDate);
 return restore.proposal;
}
export async function prepareCostCancellation(tx:Prisma.TransactionClient,id:string,proposal:CreditCostAllocation|undefined,scope:'SAME'|'LATER'){
 if(scope==='LATER'&&await tx.sourceCostReview.count({where:{companyId:COMPANY_ID,sourceType:'TRADE',sourceId:id,active:true}}))throw new InputError('다른 달 전액취소의 공사 배부는 별도 기간 정산이 필요합니다.');
 return prepareCostSettlement(tx,id,proposal,scope,{supply:'0',tax:'0'});
}
export async function cancelCostSettlement(tx:Prisma.TransactionClient,id:string,proposal:CreditCostAllocation,request:string,reason:string){
 const data=new FormData(),rid=requestId(request);
 for(const[k,v]of Object.entries({sourceType:'TRADE',sourceId:id,requestId:rid,version:String(proposal.version),reason}))data.set(k,v);
 const reviewId=await saveSourceCosts(tx,'void',data),change=await tx.sourceCostChange.findUniqueOrThrow({where:{requestId:rid},select:{id:true}});return{reviewId,changeId:change.id};
}

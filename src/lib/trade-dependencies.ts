import {activePeriodCosts,periodCostState} from './trade-cost-period';
import {effectiveVehicleExpenses} from './trade-vehicle-period';
import type {Prisma,PrismaClient} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {STOCK_KINDS} from './stock-types';
import {InputError} from './validation';
export type TradeDependency={kind:string;reference:string;amount:string|null;status:string;href:string};
/** References only: never release a source or infer a payment from its ledger status. */
export async function tradeDependencies(db:PrismaClient|Prisma.TransactionClient,id:string):Promise<TradeDependency[]>{
 const doc=await db.tradeDocument.findFirst({where:{id,companyId:COMPANY_ID},select:{id:true,issuedDate:true,settledAmount:true,cashPlan:{select:{id:true,title:true,plannedAmount:true,completedAt:true}},monthlyPayment:{select:{id:true,title:true,period:true,amount:true,voidedAt:true,template:{select:{companyId:true}}}},vehicleExpense:{select:{id:true,reference:true,amount:true,vehicleId:true,incurredDate:true,voidedAt:true,vehicle:{select:{plate:true,companyId:true}}}}}});
 if(!doc)throw new InputError('회사 청구 원본을 선택하세요.');
 const [rawReview,stock,lock]=await Promise.all([
 db.sourceCostReview.findUnique({where:{companyId_sourceType_sourceId:{companyId:COMPANY_ID,sourceType:'TRADE',sourceId:id}},include:{entries:{where:{voidedAt:null,project:{companyId:COMPANY_ID}},include:{project:{select:{code:true,name:true}}},orderBy:{projectId:'asc'}}}}),
 db.stockMovement.groupBy({by:['kind'],where:{documentId:id,voidedAt:null,material:{companyId:COMPANY_ID}},_count:{_all:true},_sum:{supplyAmount:true},orderBy:{kind:'asc'}}),
 db.accountingPeriodLock.findFirst({where:{companyId:COMPANY_ID,locked:true,period:{gte:doc.issuedDate.toISOString().slice(0,7)}},orderBy:{period:'asc'},select:{period:true}})
 ]);
 let review:null|{id:string;active:boolean;needsReview:boolean;totalAmount:Prisma.Decimal;commonAmount:Prisma.Decimal;entries:{projectId:string;project:{code:string;name:string};amount:Prisma.Decimal;sourceConfirmed:boolean}[]}=rawReview,periodAdjusted=false,periodError=false;
 if(review?.active&&await db.tradeCostAdjustment.count({where:{...activePeriodCosts,reviewId:review.id}})){
  periodAdjusted=true;
  try{const state=await periodCostState(db,review.id),projects=await db.project.findMany({where:{companyId:COMPANY_ID,id:{in:state.distribution.entries.map(e=>e.projectId)}},select:{id:true,code:true,name:true}});
   review={...review,totalAmount:review.totalAmount.mul(0).plus(state.totalAmount),commonAmount:review.commonAmount.mul(0).plus(state.distribution.commonAmount),entries:state.distribution.entries.map(e=>{const project=projects.find(p=>p.id===e.projectId);if(!project)throw new InputError('기간 배부의 회사 현장을 확인하세요.');return{projectId:e.projectId,project,amount:rawReview!.totalAmount.mul(0).plus(e.amount),sourceConfirmed:true};})};
  }catch(error){if(!(error instanceof InputError))throw error;periodError=true;}
 }
 const rows:TradeDependency[]=[];
 if(doc.cashPlan)rows.push({kind:'입금·지급 예정',reference:doc.cashPlan.title,amount:doc.cashPlan.plannedAmount.toFixed(0),status:`${doc.cashPlan.completedAt?'예정 종료':'예정 유지'} · 실제 은행 연결액 ${doc.settledAmount.toFixed(0)}원`,href:`/cash?process=${doc.cashPlan.id}`});
 else if(!doc.settledAmount.isZero())rows.push({kind:'은행 실적',reference:'원 청구의 실제 은행 연결',amount:doc.settledAmount.toFixed(0),status:'기지급 수정증빙으로 대조 · 원 은행 거래 보존',href:`/trades?edit=${id}`});
 if(review){rows.push({kind:'여러 공사 원가 배부',reference:periodError?'원 배부액 · 현재 정산 재검토':review.active?'매입 총원가 배부':'이전 배부 이력',amount:review.totalAmount.toFixed(0),status:!review.active?'배부 취소됨':review.needsReview||periodError?'원본 변경 · 재검토 필요':periodAdjusted?'수정월 조정 반영 · 원 배부 보존':'배부 유효 · 수정증빙 반영 전 원가 정산 필요',href:`/source-costs?type=TRADE&source=${id}`});if(review.active){for(const entry of review.entries)rows.push({kind:'현장별 배부',reference:`${entry.project.code} ${entry.project.name}`,amount:entry.amount.toFixed(0),status:entry.sourceConfirmed&&!periodError?'현재 배부액':'원가 재검토 필요',href:`/source-costs?type=TRADE&source=${id}`});if(!review.commonAmount.isZero())rows.push({kind:'본사 공통 배부',reference:'본사·공통',amount:review.commonAmount.toFixed(0),status:periodError?'원 배부액 · 재검토 필요':'현재 공통 원가',href:`/source-costs?type=TRADE&source=${id}`});}}
 const v=doc.vehicleExpense?(await effectiveVehicleExpenses(db,[{...doc.vehicleExpense,documentId:id}]))[0]:null;if(v?.vehicle.companyId===COMPANY_ID)rows.push({kind:'차량 비용',reference:`${v.vehicle.plate} · ${v.reference}`,amount:v.amount.toFixed(0),status:v.periodError?'기간 정산 재검토 필요':v.periodCancelled?'기간 전액취소 · 원 비용 보존':v.periodAdjusted?`수정월 조정 반영 · 원 금액 ${v.originalAmount}원 보존`:v.voidedAt?'취소 비용 연결 · 원본 확인 필요':'연결 유지 · 수정증빙 반영 전 차량 원가 정산 필요',href:`/vehicles?vehicle=${v.vehicleId}&${v.voidedAt?'':`expense=${v.id}&`}period=${v.incurredDate.toISOString().slice(0,7)}`});
 const m=doc.monthlyPayment;if(m?.template.companyId===COMPANY_ID)rows.push({kind:'정기 지급',reference:`${m.period} ${m.title}`,amount:m.amount?.toFixed(0)??null,status:m.voidedAt?'취소 정기 지급 연결 · 원본 확인 필요':'정기 지급 연결 · 해당 월 청구와 예정 중복 확인',href:`/recurring-payments?period=${m.period}&confirm=${m.id}`});
 for(const s of stock)rows.push({kind:'자재 원본',reference:`${STOCK_KINDS[s.kind as keyof typeof STOCK_KINDS]??s.kind} ${s._count._all}건`,amount:s._sum.supplyAmount?.toFixed(0)??null,status:'공급가액 기준 · 실제 반품/단가 감액 증빙과 대조',href:`/inventory?document=${id}`});
 if(lock)rows.push({kind:'기간 마감',reference:`${lock.period} 마감`,amount:null,status:'이 월과 이전 기간 보호 · 다른 달 수정은 원 작성월 보존',href:`/period-review?period=${lock.period}`});
 return rows;
}

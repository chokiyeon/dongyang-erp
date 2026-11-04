import {InputError} from './validation';
import {COMPANY_ID} from './constants';
import type {Prisma,PrismaClient} from '@/generated/prisma/client';
export const LATER_CANCELLATION='REGISTER_LATER';
export const LATER_REDUCTION='REGISTER_LATER_REDUCTION';
/** A later-period credit preserves the original invoice in its original tax period. */
export function taxDocumentWhere(companyId:string):Prisma.TradeDocumentWhereInput{
 return {companyId,OR:[{voidedAt:null},{cancellations:{some:{companyId,voidedAt:null,changes:{some:{operation:LATER_CANCELLATION}}}}}]};
}
export function tradeActiveAt(companyId:string,at:Date):Prisma.TradeDocumentWhereInput{
 return {companyId,OR:[{voidedAt:null},{cancellations:{some:{companyId,voidedAt:null,issuedDate:{gt:at},changes:{some:{operation:LATER_CANCELLATION}}}}}]};
}
export function restoreLaterAmounts<T extends {supplyAmount:Prisma.Decimal;taxAmount:Prisma.Decimal;grossAmount:Prisma.Decimal}>(doc:T,credits:{supplyAmount:Prisma.Decimal;taxAmount:Prisma.Decimal;grossAmount:Prisma.Decimal}[]){
 return {...doc,supplyAmount:credits.reduce((v,r)=>v.minus(r.supplyAmount),doc.supplyAmount),taxAmount:credits.reduce((v,r)=>v.minus(r.taxAmount),doc.taxAmount),grossAmount:credits.reduce((v,r)=>v.minus(r.grossAmount),doc.grossAmount)};
}
export async function readTaxPeriod(db:PrismaClient|Prisma.TransactionClient,companyId:string,from:Date,to:Date){
 const where:Prisma.TradeDocumentWhereInput={...taxDocumentWhere(companyId),issuedDate:{gte:from,lt:to}};
 const [groups,normal,count,credits,restorations,reductions]=await Promise.all([
  db.tradeDocument.groupBy({by:['kind','evidence','proofConfirmed','inputVatReview','taxKind'],where,_sum:{supplyAmount:true,taxAmount:true}}),
  db.tradeDocument.findMany({where,include:{partner:true,reductions:{where:{voidedAt:null,changes:{some:{operation:LATER_REDUCTION}}},select:{supplyAmount:true,taxAmount:true,grossAmount:true}}},orderBy:[{issuedDate:'desc'},{id:'desc'}],take:100}),db.tradeDocument.count({where}),
  db.tradeCancellation.findMany({where:{companyId,voidedAt:null,issuedDate:{gte:from,lt:to},changes:{some:{operation:LATER_CANCELLATION}},originalDocument:{companyId}},include:{originalDocument:{include:{partner:true}}},orderBy:[{issuedDate:'desc'},{id:'desc'}]}),
  db.tradeReduction.findMany({where:{companyId,voidedAt:null,changes:{some:{operation:LATER_REDUCTION}},originalDocument:where},include:{originalDocument:true}}),
  db.tradeReduction.findMany({where:{companyId,voidedAt:null,issuedDate:{gte:from,lt:to},changes:{some:{operation:LATER_REDUCTION}},originalDocument:{companyId}},include:{originalDocument:{include:{partner:true}}},orderBy:[{issuedDate:'desc'},{id:'desc'}]}),
 ]);
 const correctionRows=[...credits,...reductions].map(c=>({...c.originalDocument,id:c.id,reference:`수정증빙 ${c.taxApprovalNumber}`,issuedDate:c.issuedDate,supplyAmount:c.supplyAmount,taxAmount:c.taxAmount,grossAmount:c.grossAmount,href:`/${'beforeGross'in c?'trade-reductions':'trade-cancellations'}?view=${c.id}`,correction:true}));
 return {groups:[...groups.map(r=>({...r,supply:r._sum.supplyAmount?.toFixed(0)??'0',tax:r._sum.taxAmount?.toFixed(0)??'0'})),...restorations.map(c=>({...c.originalDocument,supply:c.supplyAmount.negated().toFixed(0),tax:c.taxAmount.negated().toFixed(0)})),...[...credits,...reductions].map(c=>({...c.originalDocument,supply:c.supplyAmount.toFixed(0),tax:c.taxAmount.toFixed(0)}))],rows:[...normal.map(r=>({...restoreLaterAmounts(r,r.reductions),href:`/trades?edit=${r.id}`,correction:false})),...correctionRows].sort((a,b)=>b.issuedDate.getTime()-a.issuedDate.getTime()||b.id.localeCompare(a.id)).slice(0,100),count:count+credits.length+reductions.length};
}

export async function latestLaterReduction(db:PrismaClient|Prisma.TransactionClient,id:string){return db.tradeReduction.findFirst({where:{companyId:COMPANY_ID,originalDocumentId:id,changes:{some:{operation:LATER_REDUCTION}}},orderBy:[{issuedDate:'desc'},{id:'desc'}],select:{issuedDate:true}});}

/** A formal later cancellation may clear the verified net balance after earlier credits. */
export async function assertCreditBalance(db:Prisma.TransactionClient,id:string,cutoff:Date){
 const d=await db.tradeDocument.findFirstOrThrow({where:{id,companyId:COMPANY_ID}});
 const credits=await db.tradeReduction.findMany({where:{companyId:COMPANY_ID,originalDocumentId:id,voidedAt:null},orderBy:{beforeGross:'desc'},include:{changes:{where:{operation:{in:['REGISTER',LATER_REDUCTION]}},select:{id:true}}}});
 for(let i=0;i<credits.length;i++){
  const r=credits[i],previous=credits[i-1];
  if(!r.changes.length||r.issuedDate>cutoff||r.originalApproval!==d.taxApprovalNumber||!r.beforeSupply.plus(r.supplyAmount).equals(r.afterSupply)||!r.beforeTax.plus(r.taxAmount).equals(r.afterTax)||!r.beforeGross.plus(r.grossAmount).equals(r.afterGross)||previous&&(!r.beforeSupply.equals(previous.afterSupply)||!r.beforeTax.equals(previous.afterTax)||!r.beforeGross.equals(previous.afterGross)))throw new InputError('기존 감액 증빙의 순서·금액과 취소 작성일을 대조하세요.');
 }
 const last=credits.at(-1);if(last&&(!d.supplyAmount.equals(last.afterSupply)||!d.taxAmount.equals(last.afterTax)||!d.grossAmount.equals(last.afterGross)))throw new InputError('현재 잔액과 마지막 감액 금액이 다릅니다.');
}

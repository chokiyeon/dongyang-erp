import type {Prisma,PrismaClient} from '@/generated/prisma/client';
export const LATER_CANCELLATION='REGISTER_LATER';
/** A later-period credit preserves the original invoice in its original tax period. */
export function taxDocumentWhere(companyId:string):Prisma.TradeDocumentWhereInput{
 return {companyId,OR:[{voidedAt:null},{cancellations:{some:{companyId,voidedAt:null,changes:{some:{operation:LATER_CANCELLATION}}}}}]};
}
export function tradeActiveAt(companyId:string,at:Date):Prisma.TradeDocumentWhereInput{
 return {companyId,OR:[{voidedAt:null},{cancellations:{some:{companyId,voidedAt:null,issuedDate:{gt:at},changes:{some:{operation:LATER_CANCELLATION}}}}}]};
}
export async function readTaxPeriod(db:PrismaClient|Prisma.TransactionClient,companyId:string,from:Date,to:Date){
 const where:Prisma.TradeDocumentWhereInput={...taxDocumentWhere(companyId),issuedDate:{gte:from,lt:to}};
 const [groups,normal,count,credits]=await Promise.all([
  db.tradeDocument.groupBy({by:['kind','evidence','proofConfirmed','inputVatReview','taxKind'],where,_sum:{supplyAmount:true,taxAmount:true}}),
  db.tradeDocument.findMany({where,include:{partner:true},orderBy:[{issuedDate:'desc'},{id:'desc'}],take:100}),db.tradeDocument.count({where}),
  db.tradeCancellation.findMany({where:{companyId,voidedAt:null,issuedDate:{gte:from,lt:to},changes:{some:{operation:LATER_CANCELLATION}},originalDocument:{companyId}},include:{originalDocument:{include:{partner:true}}},orderBy:[{issuedDate:'desc'},{id:'desc'}]}),
 ]);
 return {groups:[...groups.map(r=>({...r,supply:r._sum.supplyAmount?.toFixed(0)??'0',tax:r._sum.taxAmount?.toFixed(0)??'0'})),...credits.map(c=>({...c.originalDocument,supply:c.supplyAmount.toFixed(0),tax:c.taxAmount.toFixed(0)}))],rows:[...normal.map(r=>({...r,href:`/trades?edit=${r.id}`,correction:false})),...credits.map(c=>({...c.originalDocument,id:c.id,reference:`수정증빙 ${c.taxApprovalNumber}`,issuedDate:c.issuedDate,supplyAmount:c.supplyAmount,taxAmount:c.taxAmount,grossAmount:c.grossAmount,href:`/trade-cancellations?view=${c.id}`,correction:true}))].sort((a,b)=>b.issuedDate.getTime()-a.issuedDate.getTime()||b.id.localeCompare(a.id)).slice(0,100),count:count+credits.length};
}

import {createHash} from "node:crypto";
import type {Prisma,PrismaClient} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError} from "./validation";
export async function purchaseCostBasis(db:PrismaClient|Prisma.TransactionClient,id:string){
 const doc=await db.tradeDocument.findFirst({where:{id,companyId:COMPANY_ID,kind:"PURCHASE",voidedAt:null}});
 if(!doc||doc.projectId)throw new InputError("여러 공사로 배부할 매입은 단일 현장을 비우고 원본을 확인하세요. 단일 현장 매입 원가와 중복 배부할 수 없습니다.");
 if(!doc.proofConfirmed||!doc.profitCategory||(doc.taxAmount.gt(0)&&doc.inputVatReview==="PENDING"))throw new InputError("매입 원본·원가 구분과 부가세 공제 여부를 먼저 확인하세요.");
 const total=BigInt(doc.supplyAmount.toFixed(0))+(doc.inputVatReview==="NONDEDUCTIBLE"?BigInt(doc.taxAmount.toFixed(0)):0n);
 if(total<=0n)throw new InputError("배부할 매입 원가가 0원 이하입니다. 원본을 확인하세요.");

 return{basis:purchaseCostDigest(doc),title:`매입 ${doc.reference} · ${doc.title}`,referenceAmount:doc.grossAmount.toFixed(0),suggestedTotal:total.toString(),category:doc.profitCategory,ownerId:doc.id,ownerVersion:doc.version,defaultDate:doc.issuedDate.toISOString().slice(0,10)};
}
// Allocate an invoice's gross unpaid balance once, including VAT, using reviewed cost weights.
// The last component receives the rounding remainder; all project and common shares sum exactly.
export function purchaseOutstandingShares(unpaid:bigint,common:bigint,entries:{projectId:string;amount:bigint}[]){
 const components=[...entries].sort((a,b)=>a.projectId.localeCompare(b.projectId));if(common>0n)components.push({projectId:"__company",amount:common});
 const total=components.reduce((sum,e)=>sum+e.amount,0n);const shares=new Map<string,bigint>();if(total<=0n)return shares;
 let allocated=0n;for(const[eIndex,e]of components.entries()){const share=eIndex===components.length-1?unpaid-allocated:unpaid*e.amount/total;shares.set(e.projectId,share);allocated+=share;}return shares;
}

type PurchaseBasisDocument={id:string;partnerId:string;projectId:string|null;companyExpense:boolean;issuedDate:Date;supplyAmount:{toFixed(n:number):string};taxAmount:{toFixed(n:number):string};inputVatReview:string;proofConfirmed:boolean;profitCategory:string|null};
export function purchaseCostDigest(doc:PurchaseBasisDocument){
 const snapshot={id:doc.id,partnerId:doc.partnerId,projectId:doc.projectId,companyExpense:doc.companyExpense,date:doc.issuedDate.toISOString(),supply:doc.supplyAmount.toFixed(0),tax:doc.taxAmount.toFixed(0),vat:doc.inputVatReview,proof:doc.proofConfirmed,category:doc.profitCategory};
 return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
export async function enrichPurchaseOutstanding<T extends {projectId:string;sourceReviewId:string|null;sourceConfirmed:boolean}>(db:PrismaClient|Prisma.TransactionClient,entries:T[]):Promise<(T&{unpaidPurchase?:bigint})[]>{
 const reviewIds=[...new Set(entries.map(e=>e.sourceReviewId).filter((id):id is string=>Boolean(id)))];if(!reviewIds.length)return entries;
 const reviews=await db.sourceCostReview.findMany({where:{id:{in:reviewIds},companyId:COMPANY_ID,sourceType:"TRADE"},include:{entries:{where:{voidedAt:null}}}});if(!reviews.length)return entries;
 const docs=await db.tradeDocument.findMany({where:{id:{in:reviews.map(r=>r.sourceId)},companyId:COMPANY_ID,kind:"PURCHASE",voidedAt:null}});
 return entries.map(e=>{const review=reviews.find(r=>r.id===e.sourceReviewId);if(!review)return e;const doc=docs.find(d=>d.id===review.sourceId);if(!doc)return{...e,sourceConfirmed:false,unpaidPurchase:0n};const shares=purchaseOutstandingShares(BigInt(doc.grossAmount.toFixed(0))-BigInt(doc.settledAmount.toFixed(0)),BigInt(review.commonAmount.toFixed(0)),review.entries.map(r=>({projectId:r.projectId,amount:BigInt(r.amount.toFixed(0))})));return{...e,sourceConfirmed:e.sourceConfirmed&&review.active&&!review.needsReview&&review.basis===purchaseCostDigest(doc),unpaidPurchase:shares.get(e.projectId)??0n};});
}

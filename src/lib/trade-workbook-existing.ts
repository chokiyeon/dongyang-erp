import type {Prisma,PrismaClient} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {normalizeTaxApproval} from './trade-identifiers';
import {InputError} from './validation';
import type {ExistingTrade} from './trade-workbook-match';
export async function findExistingWorkbookTrades(db:PrismaClient|Prisma.TransactionClient,input:unknown):Promise<ExistingTrade[]>{
 if(!Array.isArray(input)||!input.length||input.length>500)throw new InputError('한 번에 승인번호 1~500개를 대조하세요.');
 const approvals=[...new Set(input.map(v=>{if(typeof v!=='string'||v.length>80)throw new InputError('승인번호 형식을 확인하세요.');const value=normalizeTaxApproval(v);if(!value)throw new InputError('빈 승인번호는 대조할 수 없습니다.');return value;}))];
 const documents=await db.tradeDocument.findMany({where:{companyId:COMPANY_ID,taxApprovalNumber:{in:approvals}},select:{id:true,reference:true,taxApprovalNumber:true,kind:true,issuedDate:true,partner:{select:{name:true,businessNumber:true}},supplyAmount:true,taxAmount:true,grossAmount:true,voidedAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:2001});
 if(documents.length>2000)throw new InputError('취소 이력이 많아 대조 범위를 나눠야 합니다. 승인번호 수를 줄여 다시 확인하세요.');
 const corrections=await db.tradeCancellation.findMany({where:{companyId:COMPANY_ID,taxApprovalNumber:{in:approvals},originalDocument:{companyId:COMPANY_ID}},include:{originalDocument:{select:{kind:true,partner:{select:{name:true,businessNumber:true}}}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:2001});if(documents.length+corrections.length>2000)throw new InputError('대조 이력이 많습니다. 승인번호 수를 줄여 다시 조회하세요.');
 return [...documents.map(d=>({id:d.id,reference:d.reference,approval:d.taxApprovalNumber!,kind:d.kind,date:d.issuedDate.toISOString().slice(0,10),partner:d.partner.name,businessNumber:d.partner.businessNumber,supply:d.supplyAmount.toFixed(0),tax:d.taxAmount.toFixed(0),gross:d.grossAmount.toFixed(0),voided:Boolean(d.voidedAt)})),...corrections.map(c=>{const cells=Array.isArray(c.cells)?c.cells:[],sale=c.originalDocument.kind==='SALE';return {id:c.id,href:`/trade-cancellations?view=${c.id}`,recordType:'CANCELLATION' as const,reference:`수정증빙 ${c.taxApprovalNumber}`,approval:c.taxApprovalNumber,kind:c.originalDocument.kind,date:c.issuedDate.toISOString().slice(0,10),partner:String(cells[sale?11:6]??c.originalDocument.partner.name),businessNumber:String(cells[sale?9:4]??c.originalDocument.partner.businessNumber??'').replace(/[\s-]/g,''),supply:c.supplyAmount.toFixed(0),tax:c.taxAmount.toFixed(0),gross:c.grossAmount.toFixed(0),voided:Boolean(c.voidedAt)};})];
}

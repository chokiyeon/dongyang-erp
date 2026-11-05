import {createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError,text,revision,date,amount} from './validation';
import {assertPeriodsOpen} from './period-guard';
import {koreanToday} from './forecast';
import {stockQuantity,stockBalances} from './stock-types';
export async function saveSupplierReturn(tx:Prisma.TransactionClient,data:FormData){
 const kind=text(data,'kind','입고 조정 구분',false,30)||'RETURN';if(!['RETURN','VALUE_CREDIT'].includes(kind))throw new InputError('공급처 반품 또는 단가 감액을 선택하세요.');const valueOnly=kind==='VALUE_CREDIT',label=valueOnly?'단가 감액':'반품';
 const requestId=text(data,'requestId','요청',true,50),reason=text(data,'reason',`${label} 등록 사유`,true,300),receiptId=text(data,'receiptId','원 입고',true,50),reference=text(data,'reference',`${label} 관리번호`,true,50),sourceNote=text(data,'sourceNote',`공급처 ${label} 원본 메모`,true,300),quantity=text(data,'quantity',`${label} 수량`,true,21),supply=amount(text(data,'supplyAmount',`${label} 공급가액`,true,20),`${label} 공급가액`),fromId=valueOnly?null:text(data,'fromId','반품 출발 장소',true,50),movedDate=date(text(data,'movedDate',`${label} 확인일`,true,10),`${label} 확인일`)!,version=revision(data);
 if(!/^[0-9a-f-]{36}$/i.test(requestId)||data.get('returnConfirmed')!=='on')throw new InputError(`원 입고·공급처 ${label} 근거와 공급가액을 확인하세요.`);
 if(!supply||BigInt(supply)<=0n||(valueOnly?stockQuantity(quantity)!==0n:stockQuantity(quantity)<=0n)||movedDate.toISOString().slice(0,10)>koreanToday())throw new InputError(`${label} 날짜·수량·양수 공급가액을 확인하세요. 단가 감액은 수량을 바꾸지 않습니다.`);
 const fingerprint=createHash('sha256').update(JSON.stringify({receiptId,reference,sourceNote,quantity,supply,fromId,date:movedDate.toISOString(),version,reason,...(valueOnly?{kind}:{})})).digest('hex');
 await assertPeriodsOpen(tx,movedDate);
 const replay=await tx.stockChange.findUnique({where:{requestId},include:{material:true}});if(replay){if(replay.material.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError('다른 내용으로 사용한 반품 요청입니다.');return{materialId:replay.materialId};}
 const receipt=await tx.stockMovement.findFirst({where:{id:receiptId,kind:'IN',voidedAt:null,material:{companyId:COMPANY_ID}},include:{material:true,supplierReturns:{where:{voidedAt:null}},document:true}});
 if(!receipt||!receipt.supplyAmount||receipt.supplyAmount.lte(0)||receipt.material.version!==version||!receipt.material.active||receipt.document?.voidedAt)throw new InputError('사용 중인 원 입고와 매입 연결을 다시 확인하세요.');
 if(movedDate<receipt.movedDate)throw new InputError('반품일은 실제 원 입고일 이후여야 합니다.');
 if(!valueOnly&&!await tx.stockLocation.findFirst({where:{id:fromId!,companyId:COMPANY_ID,active:true}}))throw new InputError('사용 중인 회사 반품 출발 장소를 선택하세요.');
 const returnedQuantity=receipt.supplierReturns.reduce((v,r)=>v+stockQuantity(r.quantity.toFixed(4)),0n),returnedSupply=receipt.supplierReturns.reduce((v,r)=>v-BigInt(r.supplyAmount?.toFixed(0)??'0'),0n);
 if(returnedQuantity+stockQuantity(quantity)>stockQuantity(receipt.quantity.toFixed(4))||returnedSupply+BigInt(supply)>BigInt(receipt.supplyAmount.toFixed(0)))throw new InputError('이 원 입고의 남은 반품 가능 수량·공급가액을 초과합니다.');
 const rows=await tx.stockMovement.findMany({where:{materialId:receipt.materialId,voidedAt:null},orderBy:[{movedDate:'asc'},{sequence:'asc'}]});
 if(await tx.stockMovement.count({where:{materialId:receipt.materialId,reference}}))throw new InputError('같은 품목의 관리번호가 있습니다. 반품 원본을 확인하세요.');
 stockBalances([...rows,{id:'pending-return',sequence:rows.reduce((v,r)=>Math.max(v,r.sequence),0)+1,movedDate,fromId,toId:null,quantity:{toFixed:()=>quantity}}]);
 const changed=await tx.materialItem.updateMany({where:{id:receipt.materialId,companyId:COMPANY_ID,version},data:{version:{increment:1}}});if(changed.count!==1)throw new InputError('입출고 또는 반품 자료가 변경되었습니다.');
 if(receipt.document){const held=await tx.tradeDocument.updateMany({where:{id:receipt.document.id,companyId:COMPANY_ID,version:receipt.document.version,voidedAt:null},data:{version:{increment:1}}});if(held.count!==1)throw new InputError('원 입고의 매입 연결이 변경되었습니다.');}
 const row=await tx.stockMovement.create({data:{materialId:receipt.materialId,reference,movedDate,kind,fromId,toId:null,quantity,unitPrice:valueOnly?null:receipt.unitPrice,supplyAmount:(-BigInt(supply)).toString(),documentId:receipt.documentId,returnOfId:receipt.id,sourceNote}});
 await tx.stockChange.create({data:{materialId:receipt.materialId,requestId,fingerprint,operation:valueOnly?'SUPPLIER_PRICE_CREDIT':'SUPPLIER_RETURN',previous:{receiptId,returnedQuantity:returnedQuantity.toString(),returnedSupply:returnedSupply.toString()},next:{movementId:row.id,receiptId,documentId:receipt.documentId,quantity,supplyAmount:row.supplyAmount!.toFixed(0),fromId,date:movedDate.toISOString().slice(0,10)},reason}});
 return{materialId:receipt.materialId};
}

/** Validate physical returns before a negative tax invoice can reduce a linked purchase. */
export async function assertStockCreditMatch(tx:Prisma.TransactionClient,documentId:string,ids:string[],creditSupply:string,afterSupply:string,reductionId?:string,cancellationId?:string){
 if(!ids.length)return false;
 const rows=await tx.stockMovement.findMany({where:{id:{in:ids},documentId,material:{companyId:COMPANY_ID},kind:{in:['RETURN','VALUE_CREDIT']},voidedAt:null,reductionId:reductionId??null,cancellationId:cancellationId??null,returnOf:{kind:'IN',voidedAt:null,documentId,material:{companyId:COMPANY_ID}}}});
 if(rows.length!==ids.length||rows.some(r=>!r.supplyAmount||r.supplyAmount.gte(0))||rows.reduce((v,r)=>v+BigInt(r.supplyAmount!.toFixed(0)),0n)!==BigInt(creditSupply))throw new InputError('선택한 공급처 반품과 감액 공급가액·원 입고·매입 원본을 대조하세요. 다른 감액에 사용한 반품은 중복 연결할 수 없습니다.');
 const linked=await tx.stockMovement.aggregate({where:{documentId,voidedAt:null},_sum:{supplyAmount:true}}),net=BigInt(linked._sum.supplyAmount?.toFixed(0)??'0');
 if(net<0n||net>BigInt(afterSupply))throw new InputError('반품 후 연결 품목 공급가액이 감액 후 청구 공급가액을 초과합니다. 반품·입고·계산서 원본을 확인하세요.');
 await assertPeriodsOpen(tx,koreanToday());
 return true;
}

export async function writeStockCreditMatches(tx:Prisma.TransactionClient,ids:string[],reductionId:string|null,requestId:string,reason:string){
 if(!ids.length)return;
 await assertPeriodsOpen(tx,koreanToday());
 const rows=await tx.stockMovement.findMany({where:{id:{in:ids},kind:{in:['RETURN','VALUE_CREDIT']},voidedAt:null,cancellationId:null,material:{companyId:COMPANY_ID}}});
 if(rows.length!==ids.length)throw new InputError('반품 대조 원본이 변경되었습니다.');
 for(const row of rows){
  const changed=await tx.stockMovement.updateMany({where:{id:row.id,voidedAt:null,reductionId:row.reductionId,cancellationId:null},data:{reductionId}});if(changed.count!==1)throw new InputError('반품 대조 상태가 변경되었습니다.');
  const previous={reductionId:row.reductionId},next={movementId:row.id,reductionId,effectiveDate:koreanToday()};
  await tx.stockChange.create({data:{materialId:row.materialId,requestId:`${requestId}:stock:${row.id}`,fingerprint:createHash('sha256').update(JSON.stringify({previous,next,reason})).digest('hex'),operation:reductionId?'RETURN_CREDIT_MATCH':'RETURN_CREDIT_UNMATCH',previous,next,reason}});
 }
}

export async function assertStockCancellationMatch(tx:Prisma.TransactionClient,documentId:string,ids:string[],creditSupply:string,cancellationId?:string){
 const verified=await assertStockCreditMatch(tx,documentId,ids,creditSupply,'0',undefined,cancellationId);if(!verified)return false;
 if(!await tx.tradeDocument.findFirst({where:{id:documentId,companyId:COMPANY_ID,kind:'PURCHASE'},select:{id:true}}))throw new InputError('원 입고에 연결된 회사 매입을 선택하세요.');
 const receipts=await tx.stockMovement.findMany({where:{documentId,material:{companyId:COMPANY_ID},kind:'IN',voidedAt:null},include:{supplierReturns:{where:{voidedAt:null,kind:'RETURN',documentId}}}});
 if(!receipts.length||receipts.some(r=>r.supplierReturns.reduce((v,returned)=>v+stockQuantity(returned.quantity.toFixed(4)),0n)!==stockQuantity(r.quantity.toFixed(4))))throw new InputError('입고 연결 청구의 전액취소는 원 입고 수량이 모두 실제 공급처 반품된 경우에 처리합니다. 남은 수량과 반품 근거를 확인하세요.');
 return true;
}
export async function writeStockCancellationMatches(tx:Prisma.TransactionClient,ids:string[],cancellationId:string|null,requestId:string,reason:string){
 if(!ids.length)return;
 await assertPeriodsOpen(tx,koreanToday());
 const rows=await tx.stockMovement.findMany({where:{id:{in:ids},kind:{in:['RETURN','VALUE_CREDIT']},voidedAt:null,reductionId:null,material:{companyId:COMPANY_ID}}});
 if(rows.length!==ids.length)throw new InputError('전액취소 반품 대조 원본이 변경되었습니다.');
 for(const row of rows){
  const changed=await tx.stockMovement.updateMany({where:{id:row.id,voidedAt:null,reductionId:null,cancellationId:row.cancellationId},data:{cancellationId}});if(changed.count!==1)throw new InputError('전액취소 반품 대조가 변경되었습니다.');
  const previous={reductionId:null,cancellationId:row.cancellationId},next={movementId:row.id,reductionId:null,cancellationId,effectiveDate:koreanToday()};
  await tx.stockChange.create({data:{materialId:row.materialId,requestId:`${requestId}:stock:${row.id}`,fingerprint:createHash('sha256').update(JSON.stringify({previous,next,reason})).digest('hex'),operation:cancellationId?'RETURN_CANCEL_MATCH':'RETURN_CANCEL_UNMATCH',previous,next,reason}});
 }
}

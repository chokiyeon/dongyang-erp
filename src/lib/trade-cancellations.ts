import {createHash} from 'node:crypto';
import type {Prisma,PrismaClient} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError,text,revision,date} from './validation';
import {validateDocument} from './document-validation';
import {reviewTradeWorkbook} from './trade-workbook-review';
import {cancellationCandidate} from './trade-cancellation-types';
import {normalizeBusinessNumber} from './business-number';
import {koreanToday} from './forecast';
import {acquirePeriodReviewLock,assertPeriodsOpen} from './period-guard';
import {voidTradeDocument} from './trades';
const digest=(data:unknown)=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
const request=(data:FormData)=>{const id=text(data,'requestId','요청',true,50);if(!/^[0-9a-f-]{36}$/i.test(id))throw new InputError('수정증빙을 다시 선택하세요.');return id;};
export async function prepareTradeCancellation(data:FormData,fileName:string,content:Uint8Array){
 const valid=validateDocument(fileName,content);if(!fileName.toLowerCase().endsWith('.xlsx'))throw new InputError('원본 XLSX를 선택하세요.');if(data.get('cancellationConfirmed')!=='on')throw new InputError('원본 청구와 같은 달의 미정산 전액 취소인지 확인하세요.');
 const requestId=request(data),sheet=text(data,'sheet','원본 시트',true,80),r=text(data,'sourceRow','원본 행',true,8),originalDocumentId=text(data,'originalDocumentId','취소 원본 청구',true,50),originalVersion=revision(data),reason=text(data,'reason','수정증빙 처리 사유',true,300);if(!/^\d+$/.test(r))throw new InputError('원본 행을 확인하세요.');
 const excel=await import('exceljs'),book=new (excel.Workbook??excel.default.Workbook)();await book.xlsx.load(new Uint8Array(content).buffer);const review=reviewTradeWorkbook(book,koreanToday()),row=review.rows.find(row=>row.sheet===sheet&&row.row===Number(r));if(!row||!cancellationCandidate(row))throw new InputError('유효한 음수 수정증빙 행만 전액취소 검토에 사용할 수 있습니다. 원본 오류·충돌·중복을 먼저 확인하세요.');
 const checksum=createHash('sha256').update(content).digest('hex'),fingerprint=digest({checksum,sheet,row:row.row,originalDocumentId,originalVersion,reason});return {requestId,row,originalDocumentId,originalVersion,reason,checksum,fingerprint,fileName:valid.fileName,content,headers:review.sheets.find(s=>s.name===sheet)!.headers};
}
export async function registerTradeCancellation(tx:Prisma.TransactionClient,source:Awaited<ReturnType<typeof prepareTradeCancellation>>){
 const replay=await tx.tradeCancellation.findUnique({where:{requestId:source.requestId}});if(replay){if(replay.companyId!==COMPANY_ID||replay.fingerprint!==source.fingerprint)throw new InputError('다른 수정증빙으로 사용한 요청입니다.');return {id:replay.originalDocumentId,cancellationId:replay.id,replayed:true};}
 const {row}=source;await acquirePeriodReviewLock(tx);const lockedReplay=await tx.tradeCancellation.findUnique({where:{requestId:source.requestId}});if(lockedReplay){if(lockedReplay.companyId!==COMPANY_ID||lockedReplay.fingerprint!==source.fingerprint)throw new InputError('다른 수정증빙으로 사용한 요청입니다.');return {id:lockedReplay.originalDocumentId,cancellationId:lockedReplay.id,replayed:true};}await assertPeriodsOpen(tx,row.date);
 const original=await tx.tradeDocument.findFirst({where:{id:source.originalDocumentId,companyId:COMPANY_ID},include:{partner:true,workbookSource:true,monthlyPayment:{select:{id:true}}}});
 if(!original||original.version!==source.originalVersion||original.voidedAt)throw new InputError('원본 청구가 변경되었거나 취소되었습니다. 다시 조회하세요.');
 if(original.issuedDate.toISOString().slice(0,7)!==row.date.slice(0,7))throw new InputError('다른 달의 수정증빙은 별도 기간 정산이 필요합니다. 같은 달의 전액취소만 처리하세요.');
 if(original.kind!==row.kind||!original.taxApprovalNumber||original.taxApprovalNumber===row.approval)throw new InputError('원본의 매입·매출 구분과 서로 다른 승인번호를 확인하세요.');
 if(original.evidence!=='TAX_INVOICE')throw new InputError('세금계산서 원본 청구를 선택하세요.');
 if(original.settledAmount.toFixed(0)!=='0'||original.cashPlanId||original.monthlyPayment)throw new InputError('입금·지급·예산안·정기 지급이 연결된 청구는 별도 정산이 필요합니다. 연결 없는 미정산 원본만 선택하세요.');
 if(BigInt(original.grossAmount.toFixed(0))!==-BigInt(row.gross)||BigInt(original.supplyAmount.toFixed(0))!==-BigInt(row.supply)||BigInt(original.taxAmount.toFixed(0))!==-BigInt(row.tax))throw new InputError('공급가액·세액·합계가 원본 전액의 반대 금액과 같아야 합니다. 부분 감액을 전액취소로 처리할 수 없습니다.');
 const rawOriginal=Array.isArray(original.workbookSource?.cells)?original.workbookSource.cells:[],originalBusiness=typeof rawOriginal[row.kind==='SALE'?9:4]==='string'?String(rawOriginal[row.kind==='SALE'?9:4]):original.partner.businessNumber??'';
 if(!normalizeBusinessNumber(originalBusiness)||normalizeBusinessNumber(originalBusiness)!==normalizeBusinessNumber(row.raw[row.kind==='SALE'?9:4]??''))throw new InputError('수정증빙과 원본 거래처 사업자번호가 다릅니다.');
 if(await tx.tradeReduction.count({where:{companyId:COMPANY_ID,taxApprovalNumber:row.approval,voidedAt:null}}))throw new InputError('이미 사용한 감액 승인번호입니다.');
 if(await tx.tradeDocument.findFirst({where:{companyId:COMPANY_ID,taxApprovalNumber:row.approval,voidedAt:null}})||await tx.tradeCancellation.findFirst({where:{companyId:COMPANY_ID,voidedAt:null,OR:[{taxApprovalNumber:row.approval},{originalDocumentId:original.id},{originalApproval:row.approval}]}}))throw new InputError('이미 사용한 수정증빙 승인번호 또는 취소 원본입니다.');
 const form=new FormData();for(const [key,value]of Object.entries({documentId:original.id,version:String(original.version),reason:`전액취소 수정증빙 ${row.approval}: ${source.reason}`.slice(0,300),requestId:source.requestId}))form.set(key,value);await voidTradeDocument(tx,form);
 const file=await tx.tradeWorkbookFile.upsert({where:{companyId_checksum:{companyId:COMPANY_ID,checksum:source.checksum}},create:{companyId:COMPANY_ID,checksum:source.checksum,fileName:source.fileName,content:Buffer.from(source.content)},update:{},select:{id:true}});
 const cancelled=await tx.tradeCancellation.create({data:{companyId:COMPANY_ID,originalDocumentId:original.id,originalApproval:original.taxApprovalNumber,taxApprovalNumber:row.approval,issuedDate:new Date(row.date),supplyAmount:row.supply,taxAmount:row.tax,grossAmount:row.gross,fileId:file.id,sheet:row.sheet,sourceRow:row.row,headers:source.headers,cells:row.raw,reason:source.reason,requestId:source.requestId,fingerprint:source.fingerprint,documentVersionAfter:original.version+1}});
 await tx.tradeCancellationChange.create({data:{cancellationId:cancelled.id,requestId:source.requestId,fingerprint:source.fingerprint,operation:'REGISTER',reason:source.reason}});return {id:original.id,cancellationId:cancelled.id,replayed:false};
}
export async function undoTradeCancellation(tx:Prisma.TransactionClient,data:FormData){
 const id=text(data,'cancellationId','전액취소 증빙',true,50),version=revision(data),requestId=request(data),reason=text(data,'reason','등록 정정 사유',true,300),fingerprint=digest({id,version,reason,operation:'UNDO'});
 const replay=await tx.tradeCancellationChange.findUnique({where:{requestId},include:{cancellation:true}});if(replay){if(replay.cancellation.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError('다른 정정 내용으로 사용한 요청입니다.');return replay.cancellationId;}
 const evidence=await tx.tradeCancellation.findFirst({where:{id,companyId:COMPANY_ID}});if(!evidence)throw new InputError('회사 수정증빙을 선택하세요.');await acquirePeriodReviewLock(tx);const lockedReplay=await tx.tradeCancellationChange.findUnique({where:{requestId},include:{cancellation:true}});if(lockedReplay){if(lockedReplay.cancellation.companyId!==COMPANY_ID||lockedReplay.fingerprint!==fingerprint)throw new InputError('다른 정정 내용으로 사용한 요청입니다.');return lockedReplay.cancellationId;}await assertPeriodsOpen(tx,evidence.issuedDate);
 const original=await tx.tradeDocument.findFirst({where:{id:evidence.originalDocumentId,companyId:COMPANY_ID}});if(evidence.voidedAt||evidence.version!==version||!original?.voidedAt||original.version!==evidence.documentVersionAfter||original.cashPlanId||original.settledAmount.toFixed(0)!=='0')throw new InputError('수정증빙이나 원본이 변경되었습니다. 원본을 확인하세요.');
 if(await hasActiveReissue(tx,id))throw new InputError('활성 재발급 청구 또는 후속 재발급이 있습니다. 재발급 이력을 먼저 확인·정정하세요.');
 if(await tx.tradeDocument.findFirst({where:{companyId:COMPANY_ID,taxApprovalNumber:evidence.originalApproval,voidedAt:null,id:{not:original.id}}}))throw new InputError('같은 원본 승인번호의 활성 문서가 있습니다.');
 const changed=await tx.tradeDocument.updateMany({where:{id:original.id,companyId:COMPANY_ID,version:original.version,voidedAt:original.voidedAt},data:{voidedAt:null,voidReason:null,version:{increment:1}}});if(changed.count!==1)throw new InputError('원본 청구가 변경되었습니다.');
 const marked=await tx.tradeCancellation.updateMany({where:{id,companyId:COMPANY_ID,version,voidedAt:null},data:{voidedAt:new Date(),voidReason:reason,version:{increment:1}}});if(marked.count!==1)throw new InputError('수정증빙이 변경되었습니다.');
 await tx.tradeDocumentChange.create({data:{documentId:original.id,requestId,fingerprint,previous:{voided:true},next:{voided:false,cancellationId:id},reason}});await tx.tradeCancellationChange.create({data:{cancellationId:id,requestId,fingerprint,operation:'UNDO',reason}});return id;
}
export async function cancellationCandidates(db:PrismaClient,input:{kind:string;date:string;gross:string;supply:string;tax:string;businessNumber:string}){
 if(!input||Object.values(input).some(v=>typeof v!=='string'||v.length>80))throw new InputError('수정증빙 조회 형식을 확인하세요.');
 const kind=input.kind==='SALE'?'SALE':input.kind==='PURCHASE'?'PURCHASE':null;if(!kind||![input.gross,input.supply,input.tax].every(v=>/^-?\d{1,20}$/.test(v)))throw new InputError('수정증빙의 구분·날짜·금액을 확인하세요.');
 const issued=date(input.date,'수정증빙 날짜');if(!issued||BigInt(input.gross)>=0n||BigInt(input.supply)>=0n||BigInt(input.tax)>0n||BigInt(input.gross)!==BigInt(input.supply)+BigInt(input.tax))throw new InputError('음수 전액취소 금액을 확인하세요.');
 const from=new Date(Date.UTC(issued.getUTCFullYear(),issued.getUTCMonth(),1)),to=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth()+1,1)),businessNumber=normalizeBusinessNumber(input.businessNumber);if(!businessNumber)throw new InputError('원본 사업자번호가 필요합니다.');
 const rows=await db.tradeDocument.findMany({where:{companyId:COMPANY_ID,kind,voidedAt:null,settledAmount:0,cashPlanId:null,monthlyPayment:null,evidence:'TAX_INVOICE',taxApprovalNumber:{not:null},issuedDate:{gte:from,lt:to},grossAmount:(-BigInt(input.gross)).toString(),supplyAmount:(-BigInt(input.supply)).toString(),taxAmount:(-BigInt(input.tax)).toString(),partner:{businessNumber}},select:{id:true,reference:true,title:true,version:true,taxApprovalNumber:true,issuedDate:true},orderBy:[{issuedDate:'desc'},{id:'desc'}],take:101});if(rows.length>100)throw new InputError('일치 후보가 많습니다. 청구 목록에서 원본을 먼저 확인하세요.');return rows.map(r=>({...r,issuedDate:r.issuedDate.toISOString().slice(0,10)}));
}

export async function replacementCandidates(db:PrismaClient,input:{kind:string;date:string;businessNumber:string}){
 const kind=input.kind==='SALE'?'SALE':input.kind==='PURCHASE'?'PURCHASE':null,issued=date(input.date,'재발급 작성일'),businessNumber=normalizeBusinessNumber(input.businessNumber);if(!kind||!issued||!businessNumber)throw new InputError('재발급 원본의 구분·작성일·사업자번호를 확인하세요.');
 const first=new Date(Date.UTC(issued.getUTCFullYear(),issued.getUTCMonth(),1)),next=new Date(Date.UTC(issued.getUTCFullYear(),issued.getUTCMonth()+1,1));const rows=await db.tradeCancellation.findMany({where:{companyId:COMPANY_ID,voidedAt:null,issuedDate:{gte:first,lt:next},originalDocument:{companyId:COMPANY_ID,kind,voidedAt:{not:null},partner:{businessNumber}}},include:{originalDocument:{select:{reference:true,title:true}}},orderBy:[{issuedDate:'desc'},{id:'desc'}],take:101});if(rows.length>100)throw new InputError('재발급 연결 후보가 많습니다. 원본을 먼저 확인하세요.');return rows.map(r=>({id:r.id,reference:r.originalDocument.reference,title:r.originalDocument.title,version:r.version,taxApprovalNumber:r.taxApprovalNumber,issuedDate:r.issuedDate.toISOString().slice(0,10)}));
}

export async function hasActiveReissue(db:PrismaClient|Prisma.TransactionClient,cancellationId:string){
 let frontier=[cancellationId];const seen=new Set<string>();
 while(frontier.length){for(const id of frontier)seen.add(id);if(seen.size>1000)throw new InputError('재발급 연결 이력이 많습니다. 원본 정산 이력을 확인하세요.');
  const sources=await db.tradeWorkbookSource.findMany({where:{replacesCancellationId:{in:frontier},document:{companyId:COMPANY_ID}},select:{document:{select:{voidedAt:true,cancellations:{where:{companyId:COMPANY_ID,voidedAt:null},select:{id:true}}}}}});if(sources.some(s=>!s.document.voidedAt))return true;
  frontier=[...new Set(sources.flatMap(s=>s.document.cancellations.map(c=>c.id)))].filter(id=>!seen.has(id));
 }return false;
}

import {reissueCandidate} from "./trade-cancellation-types";
import {PAYMENT_TERMS,PAYMENT_METHODS} from "./payment-terms";
import {PROJECT_COST_CATEGORIES} from "./project-profit-types";
import {assertPeriodsOpen} from "./period-guard";
import {normalizeBusinessNumber} from "./business-number";
import {createHash} from 'node:crypto';
import type {Prisma} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError,text,choice} from './validation';
import {validateDocument} from './document-validation';
import {reviewTradeWorkbook} from './trade-workbook-review';
import {koreanToday} from './forecast';
import {saveTradeDocument} from './trades';
export async function prepareTradeWorkbookImport(data:FormData,fileName:string,content:Uint8Array){
 const checked=validateDocument(fileName,content);if(!fileName.toLowerCase().endsWith('.xlsx'))throw new InputError('매입매출 원본 .xlsx 파일을 선택하세요.');
 const requestId=text(data,'requestId','요청',true,50);if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new InputError('화면에서 원본 행을 다시 선택하세요.');
 const sheet=text(data,'sheet','원본 시트',true,80),rawRow=text(data,'sourceRow','원본 행',true,8);if(!/^\d+$/.test(rawRow)||Number(rawRow)<1)throw new InputError('원본 행을 확인하세요.');
 if(data.get('mappingConfirmed')!=='on')throw new InputError('거래처·공사와 원본 행을 대조한 뒤 확인하세요.');
 const values={replacesCancellationId:text(data,'replacesCancellationId','재발급 취소 원본',false,50),requestId,reference:text(data,'reference','관리번호',true,50),title:text(data,'title','거래내용',true,200),partnerId:text(data,'partnerId','연결 거래처',true,50),projectId:text(data,'projectId','연결 공사',false,50),taxKind:choice(text(data,'taxKind','과세 구분',true),['TAXABLE','ZERO','EXEMPT'] as const,'과세 구분'),dueDate:text(data,'dueDate','수금·지급 기한',false,10),reason:text(data,'reason','원본 이관 사유',true,300),proofConfirmed:data.get('proofConfirmed')==='on',dueMode:choice(text(data,'dueMode','지급기한 기준',false,30)||'MANUAL',['PARTNER',...Object.keys(PAYMENT_TERMS)] as string[],'지급기한 기준'),paymentMethod:choice(text(data,'paymentMethod','지급방법',false,30)||'UNCONFIRMED',['PARTNER',...Object.keys(PAYMENT_METHODS)] as string[],'지급방법'),profitCategory:text(data,'profitCategory','공사 원가 구분',false,30),companyExpense:data.get('companyExpense')==='on'};
 if(values.profitCategory&&!Object.hasOwn(PROJECT_COST_CATEGORIES,values.profitCategory))throw new InputError('공사 원가 구분을 확인하세요.');
 const excel=await import('exceljs'),book=new (excel.Workbook??excel.default.Workbook)();await book.xlsx.load(new Uint8Array(content).buffer);const review=reviewTradeWorkbook(book,koreanToday()),row=review.rows.find(r=>r.sheet===sheet&&r.row===Number(rawRow));
 if(!row||(row.status!=='REVIEW'&&!reissueCandidate(row)))throw new InputError('검토 후보인 원본 행만 이관할 수 있습니다. 중복·충돌·수정·음수 원본은 먼저 확인하세요.');
 if(reissueCandidate(row)&&!values.replacesCancellationId)throw new InputError('양수 수정 재발급은 전액취소 원본을 먼저 연결하세요.');
 const headers=review.sheets.find(s=>s.name===sheet)!.headers,checksum=createHash('sha256').update(content).digest('hex');
 const {replacesCancellationId,dueMode,paymentMethod,profitCategory,companyExpense,...baseValues}=values;
 const fingerprint=createHash('sha256').update(JSON.stringify({checksum,sheet,sourceRow:row.row,...baseValues,...(dueMode!=='MANUAL'?{dueMode}:{}),...(paymentMethod!=='UNCONFIRMED'?{paymentMethod}:{}),...(profitCategory?{profitCategory}:{}),...(companyExpense?{companyExpense:true}:{}),...(replacesCancellationId?{replacesCancellationId}:{}),requestId:undefined})).digest('hex');
 return {values,row,headers,checksum,fingerprint,fileName:checked.fileName,content};
}
export async function importTradeWorkbookRow(tx:Prisma.TransactionClient,source:Awaited<ReturnType<typeof prepareTradeWorkbookImport>>){
 const {values,row}=source;const replay=await tx.tradeWorkbookSource.findUnique({where:{requestId:values.requestId},include:{document:true,file:{select:{companyId:true}}}});
 if(replay){if(replay.file.companyId!==COMPANY_ID||replay.document.companyId!==COMPANY_ID||replay.fingerprint!==source.fingerprint)throw new InputError('다른 원본·내용으로 사용한 요청입니다. 다시 확인하세요.');return {id:replay.documentId,replayed:true};}
 const oldFile=await tx.tradeWorkbookFile.findUnique({where:{companyId_checksum:{companyId:COMPANY_ID,checksum:source.checksum}},select:{id:true}});
 if(oldFile){const previous=await tx.tradeWorkbookSource.findUnique({where:{fileId_sheet_sourceRow:{fileId:oldFile.id,sheet:row.sheet,sourceRow:row.row}}});if(previous)throw new InputError('이 원본 행은 이미 이관했습니다. 기존 문서와 이력을 확인하세요.');}
 await assertPeriodsOpen(tx,row.date);
 await tx.$queryRaw`SELECT "id" FROM "Partner" WHERE "id"=${values.partnerId} AND "companyId"=${COMPANY_ID} FOR UPDATE`;
 const sourceBusiness=normalizeBusinessNumber(row.raw[row.kind==='SALE'?9:4]??'');if(!sourceBusiness)throw new InputError('원본 거래처 사업자번호를 확인하세요.');
 const partner=await tx.partner.findFirst({where:{id:values.partnerId,companyId:COMPANY_ID},select:{businessNumber:true}});
 if(!partner?.businessNumber)throw new InputError('거래처 관리에서 사업자등록번호를 먼저 확인·등록하세요.');
 if(partner.businessNumber!==sourceBusiness)throw new InputError('선택한 거래처와 원본의 사업자등록번호가 다릅니다. 연결 거래처를 다시 확인하세요.');
 if(values.replacesCancellationId){
  const cancelled=await tx.tradeCancellation.findFirst({where:{id:values.replacesCancellationId,companyId:COMPANY_ID,voidedAt:null},include:{originalDocument:true}});
  if(!cancelled||!cancelled.originalDocument.voidedAt||cancelled.originalDocument.companyId!==COMPANY_ID)throw new InputError('유효한 전액취소 원본을 선택하세요.');
  const cells=Array.isArray(cancelled.cells)?cancelled.cells:[];
  if(cancelled.originalDocument.kind!==row.kind||cancelled.issuedDate.toISOString().slice(0,7)!==row.date.slice(0,7)||cancelled.issuedDate>new Date(row.date)||normalizeBusinessNumber(String(cells[row.kind==='SALE'?9:4]??''))!==sourceBusiness)throw new InputError('재발급 증빙의 구분·사업자번호·같은 달의 취소 이후 작성일을 확인하세요.');
 }
 const form=new FormData();for(const [key,value]of Object.entries({requestId:values.requestId,version:'0',reference:values.reference,title:values.title,partnerId:values.partnerId,projectId:values.projectId,issuedDate:row.date,dueDate:values.dueDate,supplyAmount:row.supply,taxAmount:row.tax,kind:row.kind,taxApprovalNumber:row.approval,taxKind:values.taxKind,evidence:'TAX_INVOICE',inputVatReview:'PENDING',proofConfirmed:values.proofConfirmed?'on':'',dueMode:row.kind==='PURCHASE'?values.dueMode:'MANUAL',paymentMethod:values.paymentMethod,profitCategory:values.profitCategory,companyExpense:values.companyExpense?'on':'',reason:values.reason,note:`원본 이관: ${row.sheet} ${row.row}행 · 수금/결재 표기는 실적으로 자동 반영하지 않음`}))form.set(key,value);
 const id=await saveTradeDocument(tx,form);
 const file=await tx.tradeWorkbookFile.upsert({where:{companyId_checksum:{companyId:COMPANY_ID,checksum:source.checksum}},create:{companyId:COMPANY_ID,checksum:source.checksum,fileName:source.fileName,content:Buffer.from(source.content)},update:{},select:{id:true}});
 await tx.tradeWorkbookSource.create({data:{fileId:file.id,documentId:id,replacesCancellationId:values.replacesCancellationId||null,sheet:row.sheet,sourceRow:row.row,headers:source.headers,cells:row.raw,requestId:values.requestId,fingerprint:source.fingerprint,reason:values.reason}});return {id,replayed:false};
}

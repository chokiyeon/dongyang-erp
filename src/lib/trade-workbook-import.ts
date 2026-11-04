import type {TradeBatchResult} from "./trade-workbook-batch-types";
import {selectableSourceConflict,reissueCandidate} from "./trade-cancellation-types";
import {PAYMENT_TERMS,PAYMENT_METHODS} from "./payment-terms";
import {PROJECT_COST_CATEGORIES} from "./project-profit-types";
import {assertPeriodsOpen} from "./period-guard";
import {normalizeBusinessNumber} from "./business-number";
import {createHash} from 'node:crypto';
import {findExistingWorkbookTrades} from "./trade-workbook-existing";
import {matchTradeWorkbookRow,type ExistingTrade} from "./trade-workbook-match";
import {acquirePeriodReviewLock} from "./period-guard";
import type {Prisma} from '@/generated/prisma/client';
import {COMPANY_ID} from './constants';
import {InputError,text,choice} from './validation';
import {validateDocument} from './document-validation';
import {reviewTradeWorkbook} from './trade-workbook-review';
import {koreanToday} from './forecast';
import {saveTradeDocument} from './trades';
async function readTradeImportSource(fileName:string,content:Uint8Array){
 const checked=validateDocument(fileName,content);if(!fileName.toLowerCase().endsWith('.xlsx'))throw new InputError('매입매출 원본 .xlsx 파일을 선택하세요.');
 const bytes=new Uint8Array(content),excel=await import('exceljs'),book=new (excel.Workbook??excel.default.Workbook)();await book.xlsx.load(bytes.buffer);return {fileName:checked.fileName,content:bytes,review:reviewTradeWorkbook(book,koreanToday()),checksum:createHash('sha256').update(bytes).digest('hex')};
}
type ReviewedTradeImport=Awaited<ReturnType<typeof readTradeImportSource>>;
export async function prepareTradeWorkbookImport(data:FormData,fileName:string,content:Uint8Array){return prepareReviewedTradeImport(data,await readTradeImportSource(fileName,content));}
function prepareReviewedTradeImport(data:FormData,source:ReviewedTradeImport){
 const {review,checksum,content,fileName}=source;
 const requestId=text(data,'requestId','요청',true,50);if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new InputError('화면에서 원본 행을 다시 선택하세요.');
 const sheet=text(data,'sheet','원본 시트',true,80),rawRow=text(data,'sourceRow','원본 행',true,8);if(!/^\d+$/.test(rawRow)||Number(rawRow)<1)throw new InputError('원본 행을 확인하세요.');
 if(data.get('mappingConfirmed')!=='on')throw new InputError('거래처·공사와 원본 행을 대조한 뒤 확인하세요.');
 const values={sourceConflictConfirmed:data.get('sourceConflictConfirmed')==='on',replacesCancellationId:text(data,'replacesCancellationId','재발급 취소 원본',false,50),requestId,reference:text(data,'reference','관리번호',true,50),title:text(data,'title','거래내용',true,200),partnerId:text(data,'partnerId','연결 거래처',true,50),projectId:text(data,'projectId','연결 공사',false,50),taxKind:choice(text(data,'taxKind','과세 구분',true),['TAXABLE','ZERO','EXEMPT'] as const,'과세 구분'),dueDate:text(data,'dueDate','수금·지급 기한',false,10),reason:text(data,'reason','원본 이관 사유',true,300),proofConfirmed:data.get('proofConfirmed')==='on',dueMode:choice(text(data,'dueMode','지급기한 기준',false,30)||'MANUAL',['PARTNER',...Object.keys(PAYMENT_TERMS)] as string[],'지급기한 기준'),paymentMethod:choice(text(data,'paymentMethod','지급방법',false,30)||'UNCONFIRMED',['PARTNER',...Object.keys(PAYMENT_METHODS)] as string[],'지급방법'),profitCategory:text(data,'profitCategory','공사 원가 구분',false,30),companyExpense:data.get('companyExpense')==='on'};
 if(values.profitCategory&&!Object.hasOwn(PROJECT_COST_CATEGORIES,values.profitCategory))throw new InputError('공사 원가 구분을 확인하세요.');
 const row=review.rows.find(r=>r.sheet===sheet&&r.row===Number(rawRow));
 if(!row||(row.status!=='REVIEW'&&!reissueCandidate(row)&&!selectableSourceConflict(row)))throw new InputError('검토 후보인 원본 행만 이관할 수 있습니다. 중복·충돌·수정·음수 원본은 먼저 확인하세요.');
 if(values.sourceConflictConfirmed&&!selectableSourceConflict(row))throw new InputError('실제 원본 충돌 여부를 다시 확인하세요.');
 if(selectableSourceConflict(row)&&(!values.sourceConflictConfirmed||values.reason.length>280))throw new InputError('충돌 원본의 날짜·승인번호·청구 금액을 대조한 뒤 이 행을 선택한 사유를 280자 이내로 기록하세요.');
 if(reissueCandidate(row)&&!values.replacesCancellationId)throw new InputError('양수 수정 재발급은 전액취소 원본을 먼저 연결하세요.');
 const headers=review.sheets.find(s=>s.name===sheet)!.headers;
 const {sourceConflictConfirmed,replacesCancellationId,dueMode,paymentMethod,profitCategory,companyExpense,...baseValues}=values;
 const fingerprint=createHash('sha256').update(JSON.stringify({checksum,sheet,sourceRow:row.row,...baseValues,...(dueMode!=='MANUAL'?{dueMode}:{}),...(paymentMethod!=='UNCONFIRMED'?{paymentMethod}:{}),...(profitCategory?{profitCategory}:{}),...(companyExpense?{companyExpense:true}:{}),...(replacesCancellationId?{replacesCancellationId}:{}),...(sourceConflictConfirmed?{sourceConflictConfirmed:true}:{}),requestId:undefined})).digest('hex');
 const detailRows=review.rows.filter(r=>r.approval===row.approval).map(r=>({sheet:r.sheet,row:r.row,cells:r.raw}));
 return {values,row,headers,detailRows,checksum,fingerprint,fileName,content};
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
  if(cancelled?.refundPlanId)throw new InputError('환급 연결 전액취소는 재발급 승계에 사용할 수 없습니다. 별도 정산을 확인하세요.');
  if(!cancelled||!cancelled.originalDocument.voidedAt||cancelled.originalDocument.companyId!==COMPANY_ID)throw new InputError('유효한 전액취소 원본을 선택하세요.');
  const cells=Array.isArray(cancelled.cells)?cancelled.cells:[];
  if(cancelled.originalDocument.kind!==row.kind||cancelled.issuedDate.toISOString().slice(0,7)!==row.date.slice(0,7)||normalizeBusinessNumber(String(cells[row.kind==='SALE'?9:4]??''))!==sourceBusiness)throw new InputError('재발급 증빙의 구분·사업자번호·같은 달의 작성일을 확인하세요.');
 }
 const importReason=values.sourceConflictConfirmed?`[충돌 원본 선택] ${values.reason}`:values.reason;
 const form=new FormData();for(const [key,value]of Object.entries({requestId:values.requestId,version:'0',reference:values.reference,title:values.title,partnerId:values.partnerId,projectId:values.projectId,issuedDate:row.date,dueDate:values.dueDate,supplyAmount:row.supply,taxAmount:row.tax,kind:row.kind,taxApprovalNumber:row.approval,taxKind:values.taxKind,evidence:'TAX_INVOICE',inputVatReview:'PENDING',proofConfirmed:values.proofConfirmed?'on':'',dueMode:row.kind==='PURCHASE'?values.dueMode:'MANUAL',paymentMethod:values.paymentMethod,profitCategory:values.profitCategory,companyExpense:values.companyExpense?'on':'',reason:importReason,note:`원본 이관: ${row.sheet} ${row.row}행 · 수금/결재 표기는 실적으로 자동 반영하지 않음`}))form.set(key,value);
 const id=await saveTradeDocument(tx,form);
 const file=await tx.tradeWorkbookFile.upsert({where:{companyId_checksum:{companyId:COMPANY_ID,checksum:source.checksum}},create:{companyId:COMPANY_ID,checksum:source.checksum,fileName:source.fileName,content:Buffer.from(source.content)},update:{},select:{id:true}});
 await tx.tradeWorkbookSource.create({data:{fileId:file.id,documentId:id,replacesCancellationId:values.replacesCancellationId||null,sheet:row.sheet,sourceRow:row.row,headers:source.headers,cells:row.raw,detailRows:source.detailRows,requestId:values.requestId,fingerprint:source.fingerprint,reason:importReason}});return {id,replayed:false};
}

function derivedImportRequest(base:string,checksum:string,sheet:string,row:number){const bytes=createHash('sha256').update(`${COMPANY_ID}:${base}:${checksum}:${sheet}:${row}`).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export async function prepareTradeWorkbookBatch(data:FormData,fileName:string,content:Uint8Array){
 const batchId=text(data,'requestId','묶음 요청',true,50);if(!/^[0-9a-f-]{36}$/i.test(batchId))throw new InputError('묶음 이관을 다시 준비하세요.');if(data.get('batchConfirmed')!=='on')throw new InputError('선택한 청구의 공통 거래처·공사·과세 조건을 확인하세요.');
 let selected:unknown;try{selected=JSON.parse(text(data,'rows','선택 행',true,40000));}catch{throw new InputError('선택 행을 다시 확인하세요.');}if(!Array.isArray(selected)||!selected.length||selected.length>100)throw new InputError('일반 과세 청구 1~100건씩 선택하세요.');
 const batchReason=text(data,'reason','묶음 이관 사유',true,240);const source=await readTradeImportSource(fileName,content),seen=new Set<string>(),approvals=new Set<string>();let business='',kind='';const prepared:ReturnType<typeof prepareReviewedTradeImport>[]=[];
 for(const item of selected){if(!item||typeof item!=='object'||typeof item.sheet!=='string'||item.sheet.length>80||!Number.isSafeInteger(item.row)||item.row<1)throw new InputError('원본 시트·행을 확인하세요.');const key=`${item.sheet}:${item.row}`;if(seen.has(key))throw new InputError('같은 원본 행을 두 번 선택할 수 없습니다.');seen.add(key);
  const row=source.review.rows.find(r=>r.sheet===item.sheet&&r.row===item.row);if(!row||row.status!=='REVIEW'||BigInt(row.tax||'0')<=0n||reissueCandidate(row)||approvals.has(row.approval))throw new InputError('중복·수정·충돌·0세액을 제외한 일반 과세 후보만 묶음 이관하세요.');approvals.add(row.approval);
  const number=normalizeBusinessNumber(row.raw[row.kind==='SALE'?9:4]??'');if(!number)throw new InputError('사업자번호를 확인하세요.');if(business&&(business!==number||kind!==row.kind))throw new InputError('같은 사업자·매입매출 구분끼리 묶어서 선택하세요.');business=number;kind=row.kind;
  const form=new FormData();for(const field of ['partnerId','projectId','profitCategory','companyExpense','dueMode','dueDate','paymentMethod','proofConfirmed','reason']){const value=data.get(field);if(value!==null){if(typeof value!=='string')throw new InputError('공통 입력값을 확인하세요.');form.set(field,value);}}
  form.set('reason',`[묶음 ${batchId}] ${batchReason}`);form.set('requestId',derivedImportRequest(batchId,source.checksum,row.sheet,row.row));form.set('sheet',row.sheet);form.set('sourceRow',String(row.row));form.set('mappingConfirmed','on');form.set('taxKind','TAXABLE');form.set('reference',`XLS-${createHash('sha256').update(`${source.checksum}:${row.sheet}:${row.row}`).digest('hex').slice(0,28)}`);form.set('title',(row.raw[26]||`${row.partner} 청구`).slice(0,200));prepared.push(prepareReviewedTradeImport(form,source));
 }
 return prepared;
}
export async function importTradeWorkbookBatch(tx:Prisma.TransactionClient,prepared:Awaited<ReturnType<typeof prepareTradeWorkbookBatch>>){
 await acquirePeriodReviewLock(tx);const existing=await findExistingWorkbookTrades(tx,prepared.map(p=>p.row.approval)),byApproval=new Map<string,ExistingTrade[]>();for(const d of existing){const rows=byApproval.get(d.approval)??[];rows.push(d);byApproval.set(d.approval,rows);}const result:TradeBatchResult[]=[];
 for(const source of prepared){const known=await tx.tradeWorkbookSource.findFirst({where:{sheet:source.row.sheet,sourceRow:source.row.row,file:{companyId:COMPANY_ID,checksum:source.checksum},document:{companyId:COMPANY_ID}},select:{requestId:true,document:{select:{id:true,reference:true,voidedAt:true}}}});
  if(known&&known.requestId!==source.values.requestId){result.push({id:known.document.id,reference:known.document.reference,href:`/trades?edit=${known.document.id}`,sheet:source.row.sheet,row:source.row.row,status:'EXISTING',message:known.document.voidedAt?'같은 원본 이관·취소 이력 보관, 새 청구 생성 안 함':'같은 원본은 기존 연결을 유지, 문서 확인 필요'});continue;}
  const old=byApproval.get(source.row.approval)??[];if(!known&&old.length){const match=matchTradeWorkbookRow(source.row,old),target=old.find(d=>!d.voided)??old[0];result.push({id:target.id,reference:target.reference,href:target.href??`/trades?edit=${target.id}`,sheet:source.row.sheet,row:source.row.row,status:(match.status==='MATCH'||match.status==='ADJUSTED_MATCH')?'EXISTING':'HOLD',message:(match.status==='MATCH'||match.status==='ADJUSTED_MATCH')?(match.status==='ADJUSTED_MATCH'?'발행 원본 일치 · 부분 감액은 기존 증빙 이력 확인':'같은 승인번호의 주요항목 일치, 기존 자료 유지'):`기존 승인번호 이력 대조 필요: ${match.differences.join(', ')||'취소 이력 확인'}`});continue;}
  const saved=await importTradeWorkbookRow(tx,source);result.push({id:saved.id,reference:source.values.reference,href:`/trades?edit=${saved.id}`,sheet:source.row.sheet,row:source.row.row,status:saved.replayed?'REPLAYED':'IMPORTED',message:saved.replayed?'같은 요청의 기존 결과':'원본 청구 이관 완료'});
 }return result;
}

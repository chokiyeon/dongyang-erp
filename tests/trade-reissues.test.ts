import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {randomUUID} from 'node:crypto';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
import {prepareTradeCancellation,registerTradeCancellation,undoTradeCancellation,hasActiveReissue} from '../src/lib/trade-cancellations';
import {prepareTradeWorkbookImport,importTradeWorkbookRow} from '../src/lib/trade-workbook-import';
import {saveTradeDocument} from '../src/lib/trades';
import {profitSources} from '../src/lib/project-profit';
import {summarizeProjectProfit} from '../src/lib/project-profit-summary';
import {captureAccounting} from '../src/lib/accounting-delivery';
const form=(v:Record<string,string>)=>{const f=new FormData();for(const[k,x]of Object.entries(v))f.set(k,x);return f;};
async function workbook(approval:string,date:string,supply:string,tax:string){const b=new ExcelJS.Workbook(),s=b.addWorksheet('매 입'),h=Array(43).fill('');h[0]='작성일자';h[1]='승인번호';h[14]='합계금액';h[15]='공급가액';h[16]='세액';s.addRow(h);const r=Array(43).fill('');r[0]=date;r[1]=approval;r[4]='0012345678';r[6]='재발급 합성업체';r[14]=(BigInt(supply)+BigInt(tax)).toString();r[15]=supply;r[16]=tax;r[18]='수정세금계산서';r[26]='재발급 합성 자재';s.addRow(r);return new Uint8Array(await b.xlsx.writeBuffer());}
const approval=()=>randomUUID().replace(/-/g,'').toUpperCase();
test('전액취소 후 양수 수정 재발급을 연결하고 활성 후속 청구가 있으면 옛 청구 복원을 막는다',async()=>{
 const db=getDb(),rollback=new Error('REISSUE_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'재발급 합성 회사'},update:{}});const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:approval(),name:'재발급 합성업체',type:'SUPPLIER',businessNumber:'0012345678'}}),project=await tx.project.create({data:{companyId:COMPANY_ID,code:approval(),name:'재발급 합성 공사'}});
 const first=await saveTradeDocument(tx,form({requestId:randomUUID(),version:'0',kind:'PURCHASE',reference:approval(),title:'재발급 전 원본',partnerId:partner.id,projectId:project.id,profitCategory:'MATERIAL',issuedDate:'2026-10-01',supplyAmount:'1000',taxAmount:'100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',proofConfirmed:'on',inputVatReview:'DEDUCTIBLE',taxApprovalNumber:approval(),reason:'합성 원본 확인'}));
 const cancelled=await registerTradeCancellation(tx,await prepareTradeCancellation(form({requestId:randomUUID(),sheet:'매 입',sourceRow:'2',originalDocumentId:first,version:'0',reason:'합성 전액취소',cancellationConfirmed:'on'}),'수정.xlsx',await workbook(approval(),'2026-10-20','-1000','-100')));
 const values={requestId:randomUUID(),sheet:'매 입',sourceRow:'2',reference:approval(),title:'합성 양수 수정 재발급',partnerId:partner.id,projectId:project.id,profitCategory:'MATERIAL',taxKind:'TAXABLE',mappingConfirmed:'on',reason:'원본 취소 후 재발급 대조'},bytes=await workbook(approval(),'2026-10-21','1200','120');await assert.rejects(prepareTradeWorkbookImport(form(values),'재발급.xlsx',bytes),/전액취소 원본/);
 const prepared=await prepareTradeWorkbookImport(form({...values,replacesCancellationId:cancelled.cancellationId}),'재발급.xlsx',bytes),reissued=await importTradeWorkbookRow(tx,prepared);assert.equal((await tx.tradeWorkbookSource.findUniqueOrThrow({where:{documentId:reissued.id}})).replacesCancellationId,cancelled.cancellationId);const costs=await profitSources(tx,project.id);assert.equal(summarizeProjectProfit(project,costs.documents,costs.entries).incurred,1200n);assert.equal(summarizeProjectProfit(project,costs.documents,costs.entries).unpaid,1320n);
 await assert.rejects(undoTradeCancellation(tx,form({cancellationId:cancelled.cancellationId,version:'0',requestId:randomUUID(),reason:'중복 복원 차단'})),/재발급/);
 const secondCancel=await registerTradeCancellation(tx,await prepareTradeCancellation(form({requestId:randomUUID(),sheet:'매 입',sourceRow:'2',originalDocumentId:reissued.id,version:'0',reason:'후속 합성 전액취소',cancellationConfirmed:'on'}),'후속수정.xlsx',await workbook(approval(),'2026-10-22','-1200','-120')));
 const tail=await importTradeWorkbookRow(tx,await prepareTradeWorkbookImport(form({...values,requestId:randomUUID(),reference:approval(),replacesCancellationId:secondCancel.cancellationId}),'후속재발급.xlsx',await workbook(approval(),'2026-10-23','1500','150')));assert.ok(tail.id);assert.equal(await hasActiveReissue(tx,cancelled.cancellationId),true);await assert.rejects(undoTradeCancellation(tx,form({cancellationId:cancelled.cancellationId,version:'0',requestId:randomUUID(),reason:'연쇄 재발급 중복 복원 차단'})),/후속 재발급/);
 const delivery=await captureAccounting(tx,'2026-10');const table=delivery.snapshot.tables.find(t=>t.title==='매입매출 이관 원본')!;assert.equal(table.headers.at(-1),'재발급 취소 연결');assert.ok(table.rows.some(r=>r[0]===tail.id&&r.at(-1)===secondCancel.cancellationId));throw rollback;
 },{timeout:30000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});

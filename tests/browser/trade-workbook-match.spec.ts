import {test,expect} from '@playwright/test';
import ExcelJS from 'exceljs';
import {randomUUID} from 'node:crypto';
import {getDb} from '../../src/lib/db';
import {COMPANY_ID} from '../../src/lib/constants';
test('기존 ERP 승인번호 대조는 인증·출처를 확인하고 등록 없이 일치 내역을 검토표에 저장한다',async({page,browser})=>{
 const db=getDb(),tag=randomUUID().replace(/-/g,'').toUpperCase();let partnerId='',documentId='';
 const anonymous=await browser.newContext();try{expect((await anonymous.request.post('/api/trades/workbook-match',{data:{approvals:[tag]}})).status()).toBe(401);}finally{await anonymous.close();}
 try{
 partnerId=(await db.partner.create({data:{companyId:COMPANY_ID,code:tag,name:'합성 자재업체',type:'SUPPLIER'}})).id;
 documentId=(await db.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId,kind:'PURCHASE',title:'합성 대조 문서',reference:`대조-${tag}`,taxApprovalNumber:tag,issuedDate:new Date('2026-10-01'),supplyAmount:'1000',taxAmount:'100',grossAmount:'1100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',note:'합성 ERP 대조'}})).id;
 const before=await db.tradeDocument.findUniqueOrThrow({where:{id:documentId}}),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('매 입'),header=Array(43).fill('');header[0]='작성일자';header[1]='승인번호';header[14]='합계금액';header[15]='공급가액';header[16]='세액';sheet.addRow(header);const row=Array(43).fill('');row[0]='2026-10-01';row[1]=tag;row[6]='합성 자재업체';row[14]='1100';row[15]='1000';row[16]='100';sheet.addRow(row);
 await page.goto('/login');await page.getByLabel('관리자 비밀번호').fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
 expect((await page.context().request.post('/api/trades/workbook-match',{headers:{origin:'https://other.invalid'},data:{approvals:[tag]}})).status()).toBe(403);
 await page.goto('/trades/review');await expect(page.getByLabel('매입매출 원본 엑셀')).toBeEnabled();await page.getByLabel('매입매출 원본 엑셀').setInputFiles({name:'검증.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});await expect(page.locator('table[data-erp-report-title="매입매출 원본 검토"] tbody tr')).toHaveCount(1);await page.getByRole('button',{name:'기존 ERP 자료 대조',exact:true}).click();await expect(page.locator('table[data-erp-report-title="매입매출 원본 검토"]')).toContainText('활성 문서 주요항목 일치');await expect(page.getByRole('link',{name:`대조-${tag}`,exact:true})).toHaveAttribute('href',`/trades?edit=${documentId}`);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'검토 결과 엑셀 저장',exact:true}).click();const file=await downloading,saved=new ExcelJS.Workbook();await saved.xlsx.readFile((await file.path())!);expect(saved.getWorksheet('검토 결과')!.getCell('M2').text).toBe('활성 문서 주요항목 일치');expect(saved.getWorksheet('검토 결과')!.getCell('O2').text).toBe(`대조-${tag}`);expect(await db.tradeDocument.findUniqueOrThrow({where:{id:documentId}})).toEqual(before);
 }finally{if(documentId)await db.tradeDocument.delete({where:{id:documentId}});if(partnerId)await db.partner.delete({where:{id:partnerId}});}
});

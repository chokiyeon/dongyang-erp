import {test,expect} from '@playwright/test';
import ExcelJS from 'exceljs';
import {getDb} from '../../src/lib/db';
import {COMPANY_ID} from '../../src/lib/constants';
test('매입매출 원본을 브라우저에서만 검토하고 전체·월별 중복과 수정 원본을 엑셀로 보존한다',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window.crypto,'subtle',{value:undefined,configurable:true});});
 const db=getDb(),before=await db.tradeDocument.count({where:{companyId:COMPANY_ID}}),book=new ExcelJS.Workbook();
 for(const name of ['매 입','입1']){const s=book.addWorksheet(name),header=Array(43).fill('');header[0]='작성일자';header[1]='승인번호';header[14]='합계금액';header[15]='공급가액';header[16]='세액';s.addRow(header);const r=Array(43).fill('');r[0]='2026-10-01';r[1]='TEST-0001';r[6]='합성 자재업체';r[14]='1100';r[15]='1000';r[16]='100';r[42]=name+' 원본 메모';s.addRow(r);}
 const correction=Array(43).fill('');correction[0]='2026-10-02';correction[1]='TEST-0002';correction[6]='합성 수정업체';correction[14]='-1100';correction[15]='-1000';correction[16]='-100';correction[18]='수정';book.getWorksheet('매 입')!.addRow(correction);
 await page.goto('/login');await page.getByLabel('관리자 비밀번호').fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);await page.goto('/trades/review');await expect(page.getByLabel('매입매출 원본 엑셀')).toBeEnabled();await page.getByLabel('매입매출 원본 엑셀').setInputFiles({name:'검증.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});
 await expect(page.locator('.erp-workspace').getByRole('status')).toHaveText('인식 시트 2개 · 검토 행 3개 · 확인 필요 1개 · 파일 내 중복 1개');await page.getByLabel('매입매출 검토 상태').selectOption('DUPLICATE');await expect(page.locator('table tbody tr')).toHaveCount(1);
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'검토 결과 엑셀 저장',exact:true}).click();const file=await downloading;expect(file.suggestedFilename()).toBe('검토.xlsx');const saved=new ExcelJS.Workbook();await saved.xlsx.readFile((await file.path())!);expect(saved.getWorksheet('검토 결과')!.rowCount).toBe(4);expect(saved.getWorksheet('원본_2')!.getCell('AR3').text).toBe('입1 원본 메모');expect(await db.tradeDocument.count({where:{companyId:COMPANY_ID}})).toBe(before);
});

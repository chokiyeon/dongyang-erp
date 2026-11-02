import {test,expect} from "@playwright/test";
import ExcelJS from "exceljs";
import {readFileSync} from "node:fs";
const layouts=JSON.parse(readFileSync("src/lib/original-workbook-layout.json","utf8")) as Record<"SALE"|"PURCHASE"|"ISSUED",{columns:{label:string}[]}>;
test("원본 장부 열 순서·시트 구분·가로 스크롤과 출력 열을 유지한다",async({page})=>{
 test.setTimeout(90000);
 await page.goto('/login');await page.getByLabel('관리자 비밀번호').fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
 for(const sheet of ['SALE','PURCHASE','ISSUED'] as const){
  await page.goto(`/excel-ledgers?sheet=${sheet}`);const table=page.locator('table.excel-original-grid');
  const expected=layouts[sheet].columns.map(c=>c.label.trim());expect(await table.locator('thead th').allTextContents()).toEqual(layouts[sheet].columns.map(c=>c.label||'　'));
  await expect(page.getByRole('navigation',{name:'원본 장부 시트'}).locator('[aria-current="page"]')).toHaveCount(1);
  if(sheet!=="ISSUED")expect(await page.locator('.excel-original-scroll').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'엑셀로 저장',exact:true}).click();const file=await downloading;const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile((await file.path())!);
  const report=workbook.worksheets.find(s=>Array.from({length:s.columnCount},(_,i)=>s.getRow(4).getCell(i+1).text).includes(expected.find(Boolean)!));expect(report).toBeTruthy();
  expect(Array.from({length:expected.length},(_,i)=>report!.getRow(4).getCell(i+1).text)).toEqual(expected.map(x=>x||'항목'));
 }
 await page.goto('/trades?kind=PURCHASE');await page.getByRole('link',{name:'원본 엑셀 양식으로 보기',exact:true}).click();await expect(page).toHaveURL(/excel-ledgers\?sheet=PURCHASE/);
});

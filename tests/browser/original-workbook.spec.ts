import {test,expect} from "@playwright/test";
import ExcelJS from "exceljs";
import {readFileSync} from "node:fs";
const layouts=JSON.parse(readFileSync("src/lib/original-workbook-layout.json","utf8")) as Record<string,{columns:{label:string}[]}>;
test("원본 장부 열 순서·시트 구분·가로 스크롤과 출력 열을 유지한다",async({page})=>{
 test.setTimeout(90000);
 await page.goto('/login');await page.getByLabel('관리자 비밀번호').fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
 for(const sheet of Object.keys(layouts)){
  await page.goto(`/excel-ledgers?sheet=${sheet}`);const table=page.locator('table.excel-original-grid');
  const expected=layouts[sheet].columns.map(c=>c.label.trim());expect(await table.locator('thead th').allTextContents()).toEqual(layouts[sheet].columns.map(c=>c.label||'　'));
  await expect(page.getByRole('navigation',{name:'원본 장부 시트'}).locator('[aria-current="page"]')).toHaveCount(1);
  if(sheet==="SALE"||sheet==="PURCHASE")expect(await page.locator('.excel-original-scroll').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'엑셀로 저장',exact:true}).click();const file=await downloading;const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile((await file.path())!);
  const report=workbook.worksheets.find(s=>Array.from({length:s.columnCount},(_,i)=>s.getRow(4).getCell(i+1).text).includes(expected.find(Boolean)!));expect(report).toBeTruthy();
  expect(Array.from({length:expected.length},(_,i)=>report!.getRow(4).getCell(i+1).text)).toEqual(expected.map(x=>x||'항목'));
 }
 await page.goto('/trades?kind=PURCHASE');await page.getByRole('link',{name:'원본 엑셀 양식으로 보기',exact:true}).click();await expect(page).toHaveURL(/excel-ledgers\?sheet=PURCHASE/);
});

test("은행별 원본 대장은 확인된 분류만 표시하고 미분류를 다른 은행에 섞지 않는다",async({page})=>{
 const {getDb}=await import('../../src/lib/db');const {COMPANY_ID}=await import('../../src/lib/constants');const {randomUUID}=await import('node:crypto');
 const db=getDb(),tag=randomUUID().slice(0,8),ids:string[]=[],plans:string[]=[];let partnerId='';
 try{
 partnerId=(await db.partner.create({data:{companyId:COMPANY_ID,code:`WB-${tag}`,name:`양식 합성 거래처 ${tag}`,type:'CLIENT'}})).id;
 for(const bank of ['전북',null]){
  const plan=await db.cashPlan.create({data:{companyId:COMPANY_ID,direction:'IN',title:`양식 검증 ${tag}`,category:'수취어음',plannedDate:new Date('2026-12-31'),plannedAmount:'123456'}});plans.push(plan.id);
  const note=await db.receivedNote.create({data:{companyId:COMPANY_ID,partnerId,cashPlanId:plan.id,reference:`WB-${bank??'미분류'}-${tag}`,receivedDate:new Date('2026-11-01'),dueDate:new Date('2026-12-31'),sourceIssuedDate:bank?new Date('2026-10-28'):null,issuingBank:bank?'합성 발행은행':null,sourceNoteKind:bank?'전자어음':null,ledgerBank:bank,amount:'123456',note:'합성 원본 양식 검증'}});ids.push(note.id);
 }
 await page.goto('/login');await page.getByLabel('관리자 비밀번호').fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole('button',{name:'로그인',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
 await page.goto('/excel-ledgers?sheet=BANK_0');const table=page.locator('.excel-original-grid');const row=table.getByRole('row').filter({hasText:`WB-전북-${tag}`});await expect(row).toContainText('2026-10-28');await expect(row).toContainText('합성 발행은행');await expect(row.locator('td').last()).toHaveText('');await expect(table).not.toContainText(`WB-미분류-${tag}`);
 await row.getByRole('link',{name:`WB-전북-${tag}`,exact:true}).click();await expect(page).toHaveURL(url=>url.pathname==='/received-notes'&&url.searchParams.get('view')===ids[0]);
 const beforePlan=await db.cashPlan.findUniqueOrThrow({where:{id:plans[0]}});
 await page.getByLabel('정정할 대장 은행').selectOption('하나');await page.getByLabel('원본 정보 정정 사유').fill('합성 원본 은행 탭 재확인');await page.getByRole('button',{name:'원본 어음 정보 정정 저장',exact:true}).click();await expect(page.locator('.erp-workspace').getByRole('status')).toHaveText('원본 어음대장 정보를 정정했습니다.');
 expect(await db.cashPlan.findUniqueOrThrow({where:{id:plans[0]}})).toEqual(beforePlan);
 await page.goto('/excel-ledgers?sheet=BANK_2');await expect(page.locator('.excel-original-grid')).toContainText(`WB-전북-${tag}`);
 await page.goto('/excel-ledgers?sheet=BANK_0');await expect(page.locator('.excel-original-grid')).not.toContainText(`WB-전북-${tag}`);
 await page.goto('/excel-ledgers?sheet=UNASSIGNED');await expect(page.locator('.excel-original-grid')).toContainText(`WB-미분류-${tag}`);await expect(page.locator('.excel-original-grid')).not.toContainText(`WB-전북-${tag}`);
 await page.goto('/excel-ledgers?sheet=BANK_1');await expect(page.locator('.excel-original-grid')).not.toContainText(`WB-전북-${tag}`);await expect(page.locator('.excel-original-grid')).not.toContainText(`WB-미분류-${tag}`);
 }finally{await db.receivedNoteChange.deleteMany({where:{noteId:{in:ids}}});await db.receivedNote.deleteMany({where:{id:{in:ids}}});await db.cashPlan.deleteMany({where:{id:{in:plans}}});if(partnerId)await db.partner.delete({where:{id:partnerId}});}
});

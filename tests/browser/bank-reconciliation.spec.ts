import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {getDb} from "../../src/lib/db";
import {COMPANY_ID} from "../../src/lib/constants";
test("통장 음수 잔액 대조·차이 임시 저장·확인과 거래 추가 후 재검토를 표시한다",async({page})=>{
 test.setTimeout(60000);const db=getDb(),tag=randomUUID().slice(0,8),period="2025-01";let accountId="",recordId="";
 try{
  await db.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"합성 대조 회사"},update:{}});accountId=(await db.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"검증은행",label:`잔액 대조 ${tag}`,overdraftLimit:200000000}})).id;
  await db.bankTransaction.create({data:{accountId,tradedDate:new Date("2025-01-15"),direction:"OUT",amount:300000,description:"합성 출금"}});
  await page.goto("/login");await page.getByLabel("관리자 비밀번호").fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole("button",{name:"로그인",exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(`/bank-reconciliation?period=${period}&account=${accountId}`);await page.getByLabel("월초 잔액 (원)").fill("100000");await page.getByLabel("은행 월말 잔액 (원)").fill("-190000");await page.getByLabel("은행 원본 확인 근거").fill("합성 은행 엑셀 잔액");await page.getByLabel("잔액 대조 사유").fill("차이 확인 중");await page.getByRole("button",{name:"통장 잔액 대조 저장",exact:true}).click();await expect(page.getByRole("status")).toHaveText("통장 잔액 대조를 저장했습니다.");recordId=(await db.bankReconciliation.findUniqueOrThrow({where:{accountId_period:{accountId,period}}})).id;
  const row=page.locator('table[data-erp-report-title="통장별 월말 잔액 대조"]').getByRole("row").filter({hasText:`잔액 대조 ${tag}`});await expect(row).toContainText("잔액 불일치");await expect(row).toContainText("10,000원");await page.getByLabel("은행 월말 잔액 (원)").fill("-200000");await page.getByLabel("은행 원본 잔액과 해당 월 거래 누락 여부를 대조했습니다.").check();await page.getByLabel("잔액 대조 사유").fill("누락·월초·월말 대조 완료");await page.getByRole("button",{name:"통장 잔액 대조 저장",exact:true}).click();await expect(row).toContainText("대조 완료");await expect(row).toContainText("-200,000원");await page.screenshot({path:"/workspace/artifacts/erp-bank-reconciliation.png",fullPage:true});
  await db.bankTransaction.create({data:{accountId,tradedDate:new Date("2025-01-20"),direction:"IN",amount:1000,description:"대조 후 추가"}});await page.reload();await expect(row).toContainText("거래 변경·재검토");
 }finally{if(accountId){if(!recordId)recordId=(await db.bankReconciliation.findUnique({where:{accountId_period:{accountId,period}}}))?.id??"";if(recordId){await db.financeChange.deleteMany({where:{entityId:recordId,companyId:COMPANY_ID}});await db.bankReconciliation.deleteMany({where:{id:recordId}});}await db.bankTransaction.deleteMany({where:{accountId}});await db.bankAccount.deleteMany({where:{id:accountId}});}await db.$disconnect();}
});

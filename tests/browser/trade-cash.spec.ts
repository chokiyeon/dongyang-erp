import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {getDb} from "../../src/lib/db";
import {COMPANY_ID} from "../../src/lib/constants";
test("매입 예산안 연결을 저장하고 은행 일부 지급과 해제를 두 화면에 함께 반영한다",async({page})=>{
 test.setTimeout(60000);
 const db=getDb(),tag=randomUUID().slice(0,8);let docId="",planId="",partnerId="",accountId="";
 try{
  await db.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"합성 연결 회사"},update:{}});
  partnerId=(await db.partner.create({data:{companyId:COMPANY_ID,code:`CASH-${tag}`,name:`예산 연결 ${tag}`,type:"SUPPLIER"}})).id;
  accountId=(await db.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"검증은행",label:`CASH-${tag}`}})).id;
  const doc=await db.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId,kind:"PURCHASE",reference:`CASH-${tag}`,title:`합성 매입 ${tag}`,issuedDate:new Date("2026-09-01"),dueDate:new Date("2026-10-31"),supplyAmount:1000000,taxAmount:100000,grossAmount:1100000,taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:true,paymentMethod:"BANK_TRANSFER",companyExpense:true,note:"합성 검증"}});docId=doc.id;
  const bank=await db.bankTransaction.create({data:{accountId,tradedDate:new Date("2026-10-15"),direction:"OUT",amount:400000,description:`연결 검증 ${tag}`}});
  await page.goto("/login");await page.getByLabel("관리자 비밀번호").fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole("button",{name:"로그인",exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(`/trades?edit=${docId}`);await page.getByLabel("예산안 연결 방식").selectOption("NEW");await page.getByLabel("같은 거래의 다른 예정이 없거나, 위에서 기존 예정을 선택했습니다.").check();await page.getByLabel("예산안 연결 사유").fill("중복 예정 없음 확인");await page.getByRole("button",{name:"예산안 연결 저장",exact:true}).click();await expect(page.getByRole("link",{name:"연결된 자금예정·실적 보기",exact:true})).toBeVisible();planId=(await db.tradeDocument.findUniqueOrThrow({where:{id:docId}})).cashPlanId!;
  await page.getByLabel("연결할 은행 거래").selectOption(bank.id);await page.getByLabel("은행 연결 금액 (원)").fill("400000");await page.getByLabel(/^은행 연결 사유/).fill("합성 일부 지급");await page.getByRole("button",{name:"은행 거래 연결",exact:true}).click();await expect(page.getByRole("status")).toHaveText("은행 거래를 연결했습니다.");
  await page.getByRole("link",{name:"연결된 자금예정·실적 보기",exact:true}).click();await expect(page.locator(".erp-workspace")).toContainText("실제 누계 400,000원 · 남은 예정 700,000원");await expect(page.getByRole("button",{name:"은행 실적 반영",exact:true})).toHaveCount(0);await page.screenshot({path:"/workspace/artifacts/erp-trade-cash-connection.png",fullPage:true});
  await page.getByRole("link",{name:"매입·매출에서 은행 연결·해제 처리",exact:true}).click();await page.getByText("잘못 연결한 거래 해제",{exact:true}).click();await page.getByLabel(/^연결 해제 사유/).fill("합성 실적 복원");await page.getByRole("button",{name:"은행 연결 해제",exact:true}).click();await expect(page.getByRole("status")).toHaveText("은행 연결을 해제했습니다.");await page.getByRole("link",{name:"연결된 자금예정·실적 보기",exact:true}).click();await expect(page.locator(".erp-workspace")).toContainText("실제 누계 0원 · 남은 예정 1,100,000원");
 }finally{
  if(docId){const d=await db.tradeDocument.findUnique({where:{id:docId}});planId=d?.cashPlanId??planId;await db.tradeBankLink.deleteMany({where:{documentId:docId}});await db.tradeDocumentChange.deleteMany({where:{documentId:docId}});await db.tradeDocument.deleteMany({where:{id:docId}});}
  if(planId){await db.cashSettlement.deleteMany({where:{planId}});await db.cashPlan.deleteMany({where:{id:planId}});}
  if(accountId){await db.bankTransaction.deleteMany({where:{accountId}});await db.bankAccount.deleteMany({where:{id:accountId}});}if(partnerId)await db.partner.deleteMany({where:{id:partnerId}});await db.$disconnect();
 }
});

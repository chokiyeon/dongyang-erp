import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {getDb} from "../../src/lib/db";
import {COMPANY_ID} from "../../src/lib/constants";
import {bankReconciliationMonth,saveBankReconciliation} from "../../src/lib/bank-reconciliation";
import {saveFinance} from "../../src/lib/finance-review";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries(v).forEach(([k,v])=>d.set(k,v));return d;};
test("검토본으로 장부를 마감하고 변경 차단·이후 월 지급·사유 재개방을 확인한다",async({page})=>{
 test.setTimeout(60000);const db=getDb();if(await db.company.findUnique({where:{id:COMPANY_ID}})){await db.$disconnect();test.skip(true,"빈 임시 DB에서만 마감 검증을 실행합니다.");return;}const period="2002-02";let created=false;
 try{
  await db.company.create({data:{id:COMPANY_ID,name:"합성 마감 검증"}});created=true;const account=await db.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"하나은행",label:"합성 마감 통장"}});
  const month=await bankReconciliationMonth(db,COMPANY_ID,period);await db.$transaction(tx=>saveBankReconciliation(tx,form({accountId:account.id,period,version:"0",basis:month.rows[0].basis,requestId:randomUUID(),openingBalance:"0",closingBalance:"0",sourceReference:"합성 대조 원본",reason:"합성 대조 확인",confirmed:"on"})));
  const packageId=await db.$transaction(tx=>saveFinance(tx,"capture",form({period,requestId:randomUUID(),reason:"합성 회계 전달본"})));for(const[op,version]of[["deliver","0"],["close","1"]]as const)await db.$transaction(tx=>saveFinance(tx,op,form({period,packageId,version,requestId:randomUUID(),reason:"합성 전달·검토",checked:"on"})));
  const plan=await db.cashPlan.create({data:{companyId:COMPANY_ID,title:"합성 이월 미지급",category:"기타",direction:"OUT",plannedDate:new Date("2002-02-28"),plannedAmount:100}});
  await page.goto("/login");await page.getByLabel("관리자 비밀번호").fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole("button",{name:"로그인",exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
  await page.goto(`/period-review?period=${period}`);await page.getByLabel("마감 기준 회계 전달본").selectOption(packageId);await page.getByLabel("통장·증빙·급여·원가 점검과 미수·미지급 이월, 회계 전달본을 확인했습니다.").check();await page.getByLabel("장부 마감·재개방 사유").fill("합성 월말 마감 확인");await page.getByRole("button",{name:"장부 마감 저장",exact:true}).click();await expect(page.locator(".erp-workspace")).toContainText("마감 · 원본 정정 보호 중");await page.screenshot({path:"/workspace/artifacts/erp-period-review.png",fullPage:true});
  await page.goto("/cash");await page.getByLabel("내용·거래처").fill("닫힌 월 입력 차단");await page.getByLabel(/^예정일/).fill("2002-02-15");await page.getByLabel("예정금액 (원)").fill("1");await page.getByRole("button",{name:"예정 등록",exact:true}).click();await expect(page.locator(".erp-workspace").getByRole("alert")).toContainText("마감되어");
  await page.goto(`/cash?process=${plan.id}`);await page.getByLabel("실제 처리일").fill("2002-03-01");await page.getByLabel("이번 추가 처리액 (원)").fill("100");await page.getByRole("button",{name:"실제 처리 반영",exact:true}).click();await expect(page.getByRole("row").filter({hasText:"합성 이월 미지급"})).toContainText("실제 100원");
  await page.goto(`/period-review?period=${period}`);await page.getByLabel("장부 마감·재개방 사유").fill("합성 원본 정정 필요");await page.getByRole("button",{name:"장부 재개방 저장",exact:true}).click();await expect(page.locator(".erp-workspace")).toContainText("열림 · 원본 정정 가능");await expect(page.locator('table[data-erp-report-title="장부 마감 이력"]')).toContainText("합성 원본 정정 필요");
 }finally{if(created){await db.financeChange.deleteMany({where:{companyId:COMPANY_ID}});await db.accountingPeriodLock.deleteMany({where:{companyId:COMPANY_ID}});await db.accountingPackage.deleteMany({where:{companyId:COMPANY_ID}});await db.cashSettlement.deleteMany({where:{plan:{companyId:COMPANY_ID}}});await db.cashPlan.deleteMany({where:{companyId:COMPANY_ID}});await db.bankReconciliation.deleteMany({where:{account:{companyId:COMPANY_ID}}});await db.bankAccount.deleteMany({where:{companyId:COMPANY_ID}});await db.company.delete({where:{id:COMPANY_ID}});}await db.$disconnect();}
});

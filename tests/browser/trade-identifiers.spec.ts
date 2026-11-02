import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {getDb} from "../../src/lib/db";
import {COMPANY_ID} from "../../src/lib/constants";
test("다른 관리번호로 같은 전자 승인번호를 저장하면 중복을 안내하고 새 승인번호는 보존한다",async({page})=>{
 const db=getDb(),tag=randomUUID().slice(0,8),approval=`20261001${randomUUID().replaceAll("-","").slice(0,16)}`.toUpperCase();let partnerId="";
 try{
 await db.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"승인번호 화면 검증"},update:{}});partnerId=(await db.partner.create({data:{companyId:COMPANY_ID,code:`TA-${tag}`,name:`승인번호 업체 ${tag}`,type:"SUPPLIER"}})).id;
 await db.tradeDocument.create({data:{companyId:COMPANY_ID,kind:"PURCHASE",reference:`TA-OLD-${tag}`,title:"이미 등록한 세금계산서",partnerId,issuedDate:new Date("2026-10-01"),supplyAmount:"1000",taxAmount:"100",grossAmount:"1100",taxKind:"TAXABLE",evidence:"TAX_INVOICE",taxApprovalNumber:approval,note:"합성 승인번호"}});
 await page.goto("/login");await page.getByLabel("관리자 비밀번호").fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole("button",{name:"로그인",exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);await page.goto("/trades?kind=PURCHASE");await page.getByLabel("관리번호").fill(`TA-NEW-${tag}`);await page.getByLabel("청구·거래내용").fill("새 관리번호 동일 승인번호");await page.getByLabel("매입·매출 거래처").selectOption(partnerId);await page.getByLabel("공급가액 (원)").fill("1000");await page.getByLabel("부가세 (원)").fill("100");await page.getByRole("combobox",{name:"증빙 종류",exact:true}).selectOption("TAX_INVOICE");await page.getByLabel("전자세금계산서 승인번호 (있을 때)").fill(`${approval.slice(0,8)}-${approval.slice(8).toLowerCase()}`);await page.getByLabel("등록·수정 사유").fill("중복 승인번호 확인");await page.getByRole("button",{name:"매입·매출 저장",exact:true}).click();await expect(page.locator(".erp-workspace").getByRole("alert")).toContainText("같은 전자 승인번호");expect(await db.tradeDocument.count({where:{partnerId}})).toBe(1);
 await page.getByLabel("전자세금계산서 승인번호 (있을 때)").fill(`${approval}NEW`);await page.getByRole("button",{name:"매입·매출 저장",exact:true}).click();await expect(page.locator(".erp-workspace").getByRole("status")).toHaveText("매입·매출 자료를 저장했습니다.");await expect(page.getByLabel("전자세금계산서 승인번호 (있을 때)")).toHaveValue(`${approval}NEW`);expect(await db.tradeDocument.count({where:{partnerId}})).toBe(2);
 }finally{await page.close();if(partnerId){await db.tradeDocumentChange.deleteMany({where:{document:{partnerId}}});await db.tradeDocument.deleteMany({where:{partnerId}});await db.partner.delete({where:{id:partnerId}});}await db.$disconnect();}
});

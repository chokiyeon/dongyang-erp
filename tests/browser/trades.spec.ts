import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { getDb } from "../../src/lib/db";
import { COMPANY_ID } from "../../src/lib/constants";
import { koreanToday } from "../../src/lib/forecast";
test("매출·매입 등록부터 분할 수금·지급·미수·부가세·해제·취소까지 연결한다", async ({page}) => {
  test.setTimeout(60000); const db=getDb(); const tag=randomUUID().slice(0,8); const today=koreanToday(); const name=`거래검증 ${tag}`;
  const companyExisted=Boolean(await db.company.findUnique({where:{id:COMPANY_ID}}));
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await db.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name},update:{}});
  const partner=await db.partner.create({data:{companyId:COMPANY_ID,code:`TP-${tag}`,name,type:"BOTH"}});
  const project=await db.project.create({data:{companyId:COMPANY_ID,code:`TP-${tag}`,name}});
  const account=await db.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"하나은행",label:`TP-${tag}`}});
  const banks=await Promise.all([600,500,-550].map((n,i)=>db.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date(today),direction:n>0?"IN":"OUT",amount:String(Math.abs(n)),bankBalance:"12345678901234567890",description:`TP-${tag}-${i}`}})));
  try {
    const health = await page.request.get("/api/health");expect(health.status()).toBe(200);expect(await health.json()).toEqual({status:"ok"});expect(health.headers()["cache-control"]).toBe("no-store");
    await page.goto("/login");await page.getByLabel("관리자 비밀번호").fill(process.env.ERP_ADMIN_PASSWORD!);await page.getByRole("button",{name:"로그인",exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
    async function create(kind:"SALE"|"PURCHASE",supply:string,tax:string) {
      await page.goto(`/trades?kind=${kind}`);await page.getByLabel("관리번호").fill(`${kind}-${tag}`);await page.getByLabel("청구·거래내용").fill(`${name} ${kind}`);
      await page.getByLabel("매입·매출 거래처").selectOption(partner.id);await page.getByLabel("매입·매출 현장").selectOption(project.id);
      if(kind==="PURCHASE")await page.getByLabel("매입 지급기한 기준").selectOption("MANUAL");await page.getByLabel("수금·지급 기한").fill("2026-10-01");await page.getByLabel("공급가액 (원)").fill(supply);await page.getByLabel("부가세 (원)").fill(tax);
      await page.getByRole("combobox",{name:"증빙 종류",exact:true}).selectOption("TAX_INVOICE");await page.getByLabel("실제 증빙 원본과 금액·거래처·날짜를 확인했습니다.").check();
      if(kind==="PURCHASE")await page.getByLabel("매입세액 공제 검토").selectOption("DEDUCTIBLE");
      await page.getByLabel("등록·수정 사유").fill("검증 등록");await page.getByRole("button",{name:"매입·매출 저장",exact:true}).click();await expect(page.getByRole("status")).toHaveText("매입·매출 자료를 저장했습니다.");
      return db.tradeDocument.findUniqueOrThrow({where:{companyId_kind_reference:{companyId:COMPANY_ID,kind,reference:`${kind}-${tag}`}}});
    }
    async function connect(bankId:string,value:string) {
      await page.getByLabel("연결할 은행 거래",{exact:false}).selectOption(bankId);await page.getByLabel("은행 연결 금액 (원)").fill(value);await page.getByLabel("은행 연결 사유").fill("은행 확인 검증");
      await page.getByRole("button",{name:"은행 거래 연결",exact:true}).click();await expect(page.getByRole("status")).toHaveText("은행 거래를 연결했습니다.");
    }
    const sale=await create("SALE","1000","100");await connect(banks[0].id,"600");
    await page.goto("/receivables");const byProject=page.locator("section").filter({has:page.getByRole("heading",{name:"현장별 잔액",exact:true})});await expect(byProject.getByRole("row").filter({hasText:name})).toContainText("500원");
    await page.goto(`/trades?edit=${sale.id}`);await connect(banks[1].id,"500");expect((await db.tradeDocument.findUniqueOrThrow({where:{id:sale.id}})).settledAmount.toFixed(0)).toBe("1100");
    const purchase=await create("PURCHASE","500","50");await connect(banks[2].id,"550");
    await page.goto(`/tax-summary?month=${today.slice(0,7)}`);
    await expect(page.locator(".erp-summary-item").filter({hasText:"확인된 매출세액"})).toContainText("100원");await expect(page.locator(".erp-summary-item").filter({hasText:"공제 가능 확인 매입세액"})).toContainText("50원");await expect(page.locator(".erp-summary-item").filter({hasText:"차감 결과"})).toContainText("50원");
    await page.screenshot({path:"/tmp/dongyang-erp-vat-summary.png",fullPage:true});
    // Proof review may change without unlinking an already paid document.
    await page.goto(`/trades?edit=${purchase.id}`);await page.getByLabel("매입세액 공제 검토").selectOption("PENDING");await page.getByLabel("등록·수정 사유").fill("공제 재확인 검증");await page.getByRole("button",{name:"매입·매출 저장",exact:true}).click();await expect(page.getByRole("status")).toHaveText("매입·매출 자료를 저장했습니다.");
    expect((await db.tradeDocument.findUniqueOrThrow({where:{id:purchase.id}})).settledAmount.toFixed(0)).toBe("550");
    await page.goto(`/tax-summary?month=${today.slice(0,7)}`);await expect(page.locator(".erp-summary-item").filter({hasText:"공제 가능 확인 매입세액"})).toContainText("0원");
    const waiting=page.getByRole("row").filter({hasText:"매입 증빙·공제 확인 대기 세액"});await expect(waiting).toContainText("50원");
    await page.goto("/cash");await page.getByLabel("입출금 구분").selectOption("IN");await page.getByLabel("내용·거래처").fill(`CF-${tag}`);await page.getByLabel("예정금액 (원)").fill("600");await page.getByRole("button",{name:"예정 등록",exact:true}).click();await expect(page.getByRole("status")).toHaveText("저장했습니다.");
    const cashPlan=await db.cashPlan.findFirstOrThrow({where:{companyId:COMPANY_ID,title:`CF-${tag}`}});
    await page.goto(`/cash?process=${cashPlan.id}`);await page.getByLabel("예정에 연결할 은행 거래").selectOption(banks[0].id);await page.getByLabel("은행에서 반영할 금액 (원)").fill("600");await page.getByLabel("은행 반영·정산 사유").fill("은행 실적 검증");await page.getByRole("button",{name:"은행 실적 반영",exact:true}).click();await expect(page.getByRole("status")).toHaveText("저장했습니다.");
    let cashSaved=await db.cashPlan.findUniqueOrThrow({where:{id:cashPlan.id},include:{settlements:true}});expect(cashSaved.completedAt).not.toBeNull();expect(cashSaved.settlements[0].bankTransactionId).toBe(banks[0].id);
    await page.goto(`/cash?process=${cashPlan.id}`);await page.getByText("최근 실제 처리 취소",{exact:true}).click();await page.getByLabel("처리 취소 사유").fill("은행 실적 해제 검증");await page.getByRole("button",{name:"실제 처리 취소 저장",exact:true}).click();await expect(page.getByRole("status")).toHaveText("저장했습니다.");
    cashSaved=await db.cashPlan.findUniqueOrThrow({where:{id:cashPlan.id},include:{settlements:true}});expect(cashSaved.completedAt).toBeNull();expect(cashSaved.settlements[0].voidedAt).not.toBeNull();
    await page.goto(`/trades?edit=${sale.id}`);await page.screenshot({path:"/tmp/dongyang-erp-trades.png",fullPage:true});
    for(let i=0;i<2;i++) {
      const details=page.locator("details").filter({has:page.getByText("잘못 연결한 거래 해제",{exact:true})}).first();await details.locator("summary").click();await details.getByLabel("연결 해제 사유").fill("검증 해제");await details.getByRole("button",{name:"은행 연결 해제",exact:true}).click();await expect(page.getByRole("status")).toHaveText("은행 연결을 해제했습니다.");
    }
    await page.getByText("문서 취소 열기",{exact:true}).click();await page.getByLabel("문서 취소 사유").fill("중복 청구 취소 검증");await page.getByRole("button",{name:"문서 취소 저장",exact:true}).click();await expect(page.getByRole("status")).toHaveText("문서를 취소했습니다.");
    expect((await db.tradeDocument.findUniqueOrThrow({where:{id:sale.id}})).voidedAt).not.toBeNull();expect(await db.bankTransaction.count({where:{accountId:account.id}})).toBe(3);
    expect((await db.bankTransaction.findUniqueOrThrow({where:{id:banks[0].id}})).bankBalance?.toFixed(0)).toBe("12345678901234567890");
    expect(errors).toEqual([]);
  } finally {
    const cashPlans=await db.cashPlan.findMany({where:{companyId:COMPANY_ID,title:`CF-${tag}`}});await db.cashSettlement.deleteMany({where:{planId:{in:cashPlans.map(r=>r.id)}}});await db.cashPlan.deleteMany({where:{id:{in:cashPlans.map(r=>r.id)}}});
    const documents=await db.tradeDocument.findMany({where:{companyId:COMPANY_ID,reference:{in:[`SALE-${tag}`,`PURCHASE-${tag}`]}}});const ids=documents.map(r=>r.id);
    await db.tradeBankLink.deleteMany({where:{documentId:{in:ids}}});await db.tradeDocumentChange.deleteMany({where:{documentId:{in:ids}}});await db.tradeDocument.deleteMany({where:{id:{in:ids}}});
    await db.bankTransaction.deleteMany({where:{accountId:account.id}});await db.bankAccount.delete({where:{id:account.id}});await db.project.delete({where:{id:project.id}});await db.partner.delete({where:{id:partner.id}});
    if(!companyExisted){const current=await db.company.findUnique({where:{id:COMPANY_ID},include:{_count:{select:{projects:true,partners:true,accounts:true,cashPlans:true,cashBaselines:true,classificationBatches:true,tradeDocuments:true}}}});if(current?.name===name&&!Object.values(current._count).some(Boolean))await db.company.delete({where:{id:COMPANY_ID}});}
    await db.$disconnect();
  }
});

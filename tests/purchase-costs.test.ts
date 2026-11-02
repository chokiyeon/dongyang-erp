import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {purchaseOutstandingShares} from "../src/lib/purchase-costs";
import {saveSourceCosts,sourceCostBasis} from "../src/lib/source-costs";
import {saveTradeDocument,voidTradeDocument,linkTradeBank} from "../src/lib/trades";
import {profitSources} from "../src/lib/project-profit";
import {summarizeProjectProfit} from "../src/lib/project-profit-summary";
import {transferPreparation} from "../src/lib/transfer-preparation";
import {loadMonthEndReview} from "../src/lib/month-end-review";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries({requestId:randomUUID(),reason:"합성 매입 배부 검증",...v}).forEach(([k,v])=>d.set(k,v));return d;};
test("매입 미지급 배부는 큰 금액과 원 단위 잔액을 프로젝트·본사 합계로 정확히 보존한다",()=>{
 const shares=purchaseOutstandingShares(10000000000000000001n,0n,[{projectId:"a",amount:1n},{projectId:"b",amount:1n}]);assert.equal(shares.get("a"),5000000000000000000n);assert.equal(shares.get("b"),5000000000000000001n);
 const small=purchaseOutstandingShares(101n,1n,[{projectId:"a",amount:1n},{projectId:"b",amount:1n}]);assert.equal([...small.values()].reduce((a,b)=>a+b,0n),101n);assert.equal(small.get("__company"),35n);
});
test("한 매입의 여러 공사 원가는 중복 없이 배부하고 지급·부가세 변경·송금표와 연결한다",async()=>{
 const db=getDb(),rollback=new Error("rollback purchase allocation");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"매입 배부 검증"},update:{}});
 const projects=await Promise.all(["A","B"].map(name=>tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:`분할 ${name}`,contractAmount:"5000",remainingMaterial:"0",remainingLabor:"0",remainingOther:"0",remainingOverhead:"0"}})));
 const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"배부 공급자",type:"SUPPLIER",payeeBank:"검증은행",payeeAccount:"123456789",payeeHolder:"합성 공급자",payeeVerifiedAt:new Date()}});
 const values={kind:"PURCHASE",reference:randomUUID(),title:"두 현장 자재 매입",partnerId:partner.id,issuedDate:"2026-10-01",dueDate:"2026-10-31",supplyAmount:"1000",taxAmount:"100",taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:"on",inputVatReview:"DEDUCTIBLE",profitCategory:"MATERIAL",paymentMethod:"BANK_TRANSFER",version:"0"};
 const id=await saveTradeDocument(tx,form(values));await tx.tradeDocument.update({where:{id},data:{inputVatReview:"PENDING"}});await assert.rejects(sourceCostBasis(tx,"TRADE",id),/부가세 공제 여부/);await tx.tradeDocument.update({where:{id},data:{inputVatReview:"DEDUCTIBLE"}});let source=await sourceCostBasis(tx,"TRADE",id);assert.equal(source.suggestedTotal,"1000");
 const pending=(await loadMonthEndReview(tx,COMPANY_ID,"2026-10")).checks.find(c=>c.key==="project")!.count;
 const split=(total:string,common:string,a:string,b:string,version:string)=>{const d=form({sourceType:"TRADE",sourceId:id,basis:source.basis,totalAmount:total,commonAmount:common,version,incurredDate:"2026-10-01",confirmed:"on",noDuplicate:"on"});for(const[p,amount]of[[projects[0],a],[projects[1],b]] as const){d.append("allocationProjectId",p.id);d.append("allocationAmount",amount);}return d;};
 await assert.rejects(saveSourceCosts(tx,"review",split("1100","100","700","300","0")),/매입 원가와 다릅니다/);
 const wrongDate=split("1000","100","600","300","0");wrongDate.set("incurredDate","2026-10-02");await assert.rejects(saveSourceCosts(tx,"review",wrongDate),/발행일과 일치/);
 const input=split("1000","100","600","300","0"),reviewId=await saveSourceCosts(tx,"review",input);assert.equal(await saveSourceCosts(tx,"review",input),reviewId);
 assert.equal((await loadMonthEndReview(tx,COMPANY_ID,"2026-10")).checks.find(c=>c.key==="project")!.count,pending-1);
 const summarize=async(index:number)=>{const sources=await profitSources(tx,projects[index].id);return summarizeProjectProfit(await tx.project.findUniqueOrThrow({where:{id:projects[index].id}}),sources.documents,sources.entries);};
 assert.equal((await summarize(0)).costs.MATERIAL,600n);assert.equal((await summarize(0)).unpaid,660n);assert.equal((await summarize(1)).costs.MATERIAL,300n);assert.equal((await summarize(1)).unpaid,330n);
 const ready=(await transferPreparation(tx,"2026-10-31",projects[0].id)).ready.filter(r=>r.id===`invoice:${id}`);assert.equal(ready.length,1);assert.equal(ready[0].amount,"1100");assert.match(ready[0].project,/분할 A.*분할 B|분할 B.*분할 A/);assert.match(ready[0].project,/청구 전체 송금액/);
 let doc=await tx.tradeDocument.findUniqueOrThrow({where:{id}});await assert.rejects(saveTradeDocument(tx,form({...values,id,version:String(doc.version),projectId:projects[0].id})),/배부를 먼저 취소/);await assert.rejects(voidTradeDocument(tx,form({documentId:id,version:String(doc.version)})),/공사별 매입 원가 배부/);
 const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"검증은행",label:randomUUID()}});const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-02"),direction:"OUT",amount:"400",description:"배부 매입 일부 지급"}});
 await linkTradeBank(tx,form({documentId:id,transactionId:bank.id,version:String(doc.version),amount:"400",note:"일부 지급"}));assert.equal((await sourceCostBasis(tx,"TRADE",id)).basis,source.basis);assert.equal((await summarize(0)).unpaid,420n);assert.equal((await summarize(1)).unpaid,210n);
 doc=await tx.tradeDocument.findUniqueOrThrow({where:{id}});await saveTradeDocument(tx,form({...values,id,version:String(doc.version),inputVatReview:"NONDEDUCTIBLE"}));assert.equal((await tx.sourceCostReview.findUniqueOrThrow({where:{id:reviewId}})).needsReview,true);assert.ok((await summarize(0)).issues.some(i=>i.includes("재검토")));assert.ok((await transferPreparation(tx,"2026-10-31")).held.some(r=>r.id===`invoice:${id}`&&r.issues.includes("공사별 매입 배부 재검토 필요")));
 source=await sourceCostBasis(tx,"TRADE",id);assert.equal(source.suggestedTotal,"1100");await saveSourceCosts(tx,"review",split("1100","110","660","330","0"));assert.equal((await summarize(0)).costs.MATERIAL,660n);assert.equal((await summarize(0)).unpaid,420n);assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id}})).settledAmount.toFixed(0),"400");assert.equal((await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}})).amount.toFixed(0),"400");
 await saveSourceCosts(tx,"void",form({sourceType:"TRADE",sourceId:id,version:"1"}));assert.equal((await summarize(0)).costs.MATERIAL,0n);assert.equal((await summarize(1)).costs.MATERIAL,0n);assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id}})).grossAmount.toFixed(0),"1100");
 throw rollback;
 },{timeout:30000}),err=>err===rollback);}finally{await db.$disconnect();}
});

import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {connectTradeCashPlan} from "../src/lib/trade-cash";
import {linkTradeBank,unlinkTradeBank,voidTradeDocument} from "../src/lib/trades";
import {cashSummary,settleCashPlan,voidCashSettlement} from "../src/lib/cash";
import {buildForecast} from "../src/lib/forecast";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries(v).forEach(([k,v])=>d.set(k,v));return d;};
test("매입·매출과 예산안은 분할·전액·해제·기존 예정 재사용·요청 재시도를 원자적으로 연결한다",async()=>{
 const db=getDb(),rollback=new Error("trade cash rollback");
 try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"합성 연결 회사"},update:{}});
  const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"합성 거래처"}});
  const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"검증은행",label:randomUUID()}});
  for(const kind of ["SALE","PURCHASE"] as const){
   const doc=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId:partner.id,kind,reference:randomUUID(),title:"합성 연결 문서",issuedDate:new Date("2026-09-01"),dueDate:new Date("2026-10-31"),supplyAmount:1000,taxAmount:100,grossAmount:1100,taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:true,paymentMethod:"BANK_TRANSFER",note:"합성"}});
   const connection=form({documentId:doc.id,version:"0",requestId:randomUUID(),mode:"NEW",reason:"합성 예산 연결",noDuplicate:"on"});
   await connectTradeCashPlan(tx,connection);assert.equal(await connectTradeCashPlan(tx,connection),doc.id);
   const current=()=>tx.tradeDocument.findUniqueOrThrow({where:{id:doc.id}});const planId=(await current()).cashPlanId!;
   const getPlan=()=>tx.cashPlan.findUniqueOrThrow({where:{id:planId},include:{settlements:true}});
   assert.equal(cashSummary(await getPlan()).remaining,1100n);
   const before=buildForecast({baseDate:new Date("2026-09-30"),amount:{toFixed:()=>"2000"}},[await getPlan()],3);
   const sign=kind==="SALE"?1n:-1n;assert.equal(before.rows.at(-1)?.confirmedBalance,2000n+sign*1100n);
   const links=[];
   for(const amount of["200","900"]){const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-01"),direction:kind==="SALE"?"IN":"OUT",amount,bankBalance:"99999999999999999999",description:"합성 은행"}});const request=form({documentId:doc.id,version:String((await current()).version),transactionId:bank.id,requestId:randomUUID(),amount,note:"합성 은행 연결"});await linkTradeBank(tx,request);await linkTradeBank(tx,request);links.push(await tx.tradeBankLink.findUniqueOrThrow({where:{requestId:String(request.get("requestId"))}}));assert.equal((await tx.bankTransaction.findUniqueOrThrow({where:{id:bank.id}})).bankBalance?.toFixed(0),"99999999999999999999");}
   let plan=await getPlan();assert.equal(cashSummary(plan).actual,1100n);assert.equal(cashSummary(plan).remaining,0n);assert.equal(plan.settlements.length,2);assert.equal(buildForecast({baseDate:new Date("2026-09-30"),amount:{toFixed:()=>"2000"}},[plan],3).rows.at(-1)?.confirmedBalance,2000n+sign*1100n);
   await assert.rejects(voidCashSettlement(tx,form({settlementId:plan.settlements[0].id,version:String(plan.version),reason:"우회 취소 차단"})),/매입·매출/);
   for(const link of links)await unlinkTradeBank(tx,form({linkId:link.id,version:String((await current()).version),reason:"합성 연결 해제"}));
   plan=await getPlan();assert.equal(cashSummary(plan).actual,0n);assert.equal(cashSummary(plan).remaining,1100n);assert.ok(plan.settlements.every(s=>s.voidedAt));
   await assert.rejects(settleCashPlan(tx,form({planId,version:String(plan.version),requestId:randomUUID(),processedDate:"2026-10-01",amount:"100",note:"우회 처리 차단"})),/매입·매출/);
   await connectTradeCashPlan(tx,form({documentId:doc.id,version:String((await current()).version),requestId:randomUUID(),mode:"DETACH",reason:"연결 해제"}));assert.equal((await current()).cashPlanId,null);assert.ok((await getPlan()).completedAt);
   const reuse=await tx.cashPlan.create({data:{companyId:COMPANY_ID,direction:kind==="SALE"?"IN":"OUT",title:"기존 예정",category:"기타",plannedAmount:1100,plannedDate:new Date("2026-10-31")}});
   await connectTradeCashPlan(tx,form({documentId:doc.id,version:String((await current()).version),requestId:randomUUID(),mode:"EXISTING",cashPlanId:reuse.id,noDuplicate:"on",reason:"중복 없이 기존 예정 사용"}));assert.equal((await current()).cashPlanId,reuse.id);
   await voidTradeDocument(tx,form({documentId:doc.id,version:String((await current()).version),requestId:randomUUID(),reason:"합성 문서 취소"}));assert.ok((await tx.cashPlan.findUniqueOrThrow({where:{id:reuse.id}})).completedAt);
  }
  const historical=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId:partner.id,kind:"SALE",reference:randomUUID(),title:"기존 은행 연결 승계",issuedDate:new Date("2026-09-01"),dueDate:new Date("2026-10-31"),supplyAmount:1000,taxAmount:100,grossAmount:1100,taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:true,note:"합성"}});
  const received=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-01"),direction:"IN",amount:400,description:"기존 수금"}});
  await linkTradeBank(tx,form({documentId:historical.id,version:"0",transactionId:received.id,requestId:randomUUID(),amount:"400",note:"기존 수금 확인"}));
  await connectTradeCashPlan(tx,form({documentId:historical.id,version:"1",requestId:randomUUID(),mode:"NEW",noDuplicate:"on",reason:"기존 수금 승계"}));
  const inherited=await tx.tradeDocument.findUniqueOrThrow({where:{id:historical.id},include:{cashPlan:{include:{settlements:true}}}});assert.equal(cashSummary(inherited.cashPlan!).actual,400n);assert.equal(cashSummary(inherited.cashPlan!).remaining,700n);
  throw rollback;
 },{timeout:30000}),e=>e===rollback);}finally{await db.$disconnect();}
});
test("이미 다른 예정에 반영된 은행 연결은 중복 연결을 거부하고 생성·변경을 전부 롤백한다",async()=>{
 const db=getDb();let documentId="",partnerId="";
 try{
  await assert.rejects(db.$transaction(async tx=>{
   await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"합성 중복 회사"},update:{}});
   partnerId=(await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"중복 검증"}})).id;
   const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"검증",label:randomUUID()}});
   const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2026-10-01"),direction:"IN",amount:400,description:"합성"}});
   const plan=await tx.cashPlan.create({data:{companyId:COMPANY_ID,title:"다른 예정",category:"기타",direction:"IN",plannedDate:new Date("2026-10-31"),plannedAmount:400}});
   await tx.cashSettlement.create({data:{planId:plan.id,bankTransactionId:bank.id,processedDate:bank.tradedDate,amount:400,requestId:randomUUID()}});
   const doc=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId,kind:"SALE",reference:randomUUID(),title:"중복 검증",issuedDate:new Date("2026-09-01"),dueDate:new Date("2026-10-31"),supplyAmount:1000,taxAmount:100,grossAmount:1100,settledAmount:400,taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:true,note:"합성"}});documentId=doc.id;
   await tx.tradeBankLink.create({data:{documentId,transactionId:bank.id,amount:400,requestId:randomUUID(),fingerprint:"합성",note:"기존 연결"}});
   await connectTradeCashPlan(tx,form({documentId,version:"0",requestId:randomUUID(),mode:"NEW",noDuplicate:"on",reason:"중복 차단 검증"}));
  }),/이미 반영/);
  assert.equal(await db.tradeDocument.count({where:{id:documentId}}),0);assert.equal(await db.partner.count({where:{id:partnerId}}),0);
 }finally{await db.$disconnect();}
});

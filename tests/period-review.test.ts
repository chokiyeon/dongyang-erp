import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {bankReconciliationMonth,saveBankReconciliation,reconcileBankBalance} from "../src/lib/bank-reconciliation";
import {savePeriodReview} from "../src/lib/period-review";
import {saveFinance} from "../src/lib/finance-review";
import {createBankTransaction,reclassifyBankTransaction} from "../src/lib/ledger";
import {createCashPlan,settleCashPlan} from "../src/lib/cash";
import {saveTradeDocument,linkTradeBank,unlinkTradeBank} from "../src/lib/trades";
import {connectTradeCashPlan} from "../src/lib/trade-cash";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries(v).forEach(([k,v])=>d.set(k,v));return d;};const input=(v:Record<string,string>)=>form({requestId:randomUUID(),reason:"합성 마감 검증",...v});
test("원본 마감·재개방은 이전 월 변경을 막고 이후 월 수금·지급과 재시도를 허용한다",async()=>{
 const db=getDb(),rollback=new Error("period review rollback");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"마감 합성 회사"},update:{}});const period="2002-02";
  const account=await tx.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"하나은행",label:randomUUID()}});
  const bank=await tx.bankTransaction.create({data:{accountId:account.id,tradedDate:new Date("2002-02-15"),direction:"OUT",amount:10,description:"합성 내부이체",internalTransfer:true}});
  const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"마감 검증 매입처"}});
  const tradeInput={kind:"PURCHASE",reference:randomUUID(),title:"합성 이월 매입",partnerId:partner.id,projectId:"",companyExpense:"on",issuedDate:"2002-02-01",dueDate:"2002-02-28",supplyAmount:"1000",taxAmount:"100",taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:"on",inputVatReview:"DEDUCTIBLE",paymentMethod:"BANK_TRANSFER",note:"합성"};
  const documentId=await saveTradeDocument(tx,input({...tradeInput,version:"0"}));await connectTradeCashPlan(tx,input({documentId,version:"0",mode:"NEW",noDuplicate:"on"}));
  const planRequest=input({plannedDate:"2002-02-28",plannedAmount:"100",title:"미지급 이월 합성",category:"기타",direction:"OUT",certainty:"CONFIRMED"});await createCashPlan(tx,planRequest);const generalPlan=await tx.cashPlan.findUniqueOrThrow({where:{requestId:String(planRequest.get("requestId"))}});
  const month=await bankReconciliationMonth(tx,COMPANY_ID,period);for(const row of month.rows){const balance=reconcileBankBalance("0","0",row.account.transactions.map(t=>({direction:t.direction,amount:t.amount.toFixed(0)}))).calculated.toString();await saveBankReconciliation(tx,input({accountId:row.account.id,period,basis:row.basis,version:String(row.record?.version??0),openingBalance:"0",closingBalance:balance,sourceReference:"합성 원본 확인",confirmed:"on"}));}
  await assert.rejects(savePeriodReview(tx,"close",input({period,version:"0",packageId:randomUUID(),confirmed:"on"})),/전달/);
  const packageId=await saveFinance(tx,"capture",input({period}));await saveFinance(tx,"deliver",input({period,packageId,version:"0",checked:"on"}));await saveFinance(tx,"close",input({period,packageId,version:"1",checked:"on"}));
  const closing=input({period,packageId,version:"0",confirmed:"on"});const lockId=await savePeriodReview(tx,"close",closing);assert.equal(await savePeriodReview(tx,"close",closing),lockId);assert.ok((await tx.accountingPeriodLock.findUniqueOrThrow({where:{id:lockId}})).locked);
  const oldBank={accountId:account.id,tradedDate:"2002-02-10",description:"마감 후 금액",direction:"OUT",amount:"1"};await assert.rejects(createBankTransaction(tx,input(oldBank)),/마감되어/);await assert.rejects(createBankTransaction(tx,input({...oldBank,tradedDate:"2002-01-01"})),/마감되어/);
  await assert.rejects(reclassifyBankTransaction(tx,form({transactionId:bank.id,version:"0",reason:"닫힌 월 분류 변경"})),/마감되어/);
  const doc=await tx.tradeDocument.findUniqueOrThrow({where:{id:documentId}});await assert.rejects(saveTradeDocument(tx,input({...tradeInput,id:documentId,version:String(doc.version),issuedDate:"2002-03-01"})),/마감되어/);
  await createBankTransaction(tx,input({...oldBank,tradedDate:"2002-03-01",description:"이후 열린 월 지급",amount:"600"}));const futureBank=await tx.bankTransaction.findFirstOrThrow({where:{accountId:account.id,description:"이후 열린 월 지급"}});
  const payment=input({documentId,transactionId:futureBank.id,version:String(doc.version),amount:"600",note:"이후 월 정상 지급"});await linkTradeBank(tx,payment);const link=await tx.tradeBankLink.findUniqueOrThrow({where:{requestId:String(payment.get("requestId"))}});const paid=await tx.tradeDocument.findUniqueOrThrow({where:{id:documentId}});assert.equal(paid.settledAmount.toFixed(0),"600");await unlinkTradeBank(tx,form({linkId:link.id,version:String(paid.version),reason:"이후 월 지급 정정"}));
  await settleCashPlan(tx,input({planId:generalPlan.id,version:"0",processedDate:"2002-03-02",amount:"100",note:"정상 이월 지급"}));
  await savePeriodReview(tx,"reopen",input({period,version:"0"}));assert.equal((await tx.accountingPeriodLock.findUniqueOrThrow({where:{id:lockId}})).locked,false);await createBankTransaction(tx,input(oldBank));assert.equal(await tx.financeChange.count({where:{entityId:lockId}}),2);
  throw rollback;
 },{timeout:30000}),e=>e===rollback);}finally{await db.$disconnect();}
});

import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { linkTradeBank } from "../src/lib/trades";
test("같은 은행 입금의 동시 연결은 상한을 넘지 않고 실패한 문서 갱신도 취소한다", async () => {
  const db=getDb();const tag=randomUUID();const companyExisted=Boolean(await db.company.findUnique({where:{id:COMPANY_ID}}));let partnerId="",accountId="";const ids:string[]=[];
  try {
    await db.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:`동시 연결 검증 ${tag}`},update:{}});
    const partner=await db.partner.create({data:{companyId:COMPANY_ID,code:tag,name:"동시 연결 검증",type:"CLIENT"}});partnerId=partner.id;
    const account=await db.bankAccount.create({data:{companyId:COMPANY_ID,bankName:"하나은행",label:tag}});accountId=account.id;
    const bank=await db.bankTransaction.create({data:{accountId,tradedDate:new Date("2026-10-01"),direction:"IN",amount:"1000",description:"동시 연결 검증"}});
    for(let i=0;i<2;i++){ids.push((await db.tradeDocument.create({data:{companyId:COMPANY_ID,partnerId,kind:"SALE",reference:`${tag}-${i}`,title:"동시 연결 검증",issuedDate:new Date("2026-10-01"),supplyAmount:"1000",taxAmount:"0",grossAmount:"1000",taxKind:"EXEMPT",evidence:"STATEMENT",note:""}})).id);}
    function data(id:string,value:string){const f=new FormData();for(const[k,v]of Object.entries({documentId:id,version:"0",transactionId:bank.id,requestId:randomUUID(),amount:value,note:"동시 요청 검증"}))f.set(k,v);return f;}
    const result=await Promise.allSettled(ids.map(id=>db.$transaction(tx=>linkTradeBank(tx,data(id,"700")),{timeout:15000})));
    assert.equal(result.filter(r=>r.status==="fulfilled").length,1);assert.equal(result.filter(r=>r.status==="rejected").length,1);
    const rows=await db.tradeDocument.findMany({where:{id:{in:ids}}});assert.equal(rows.reduce((sum,r)=>sum+BigInt(r.settledAmount.toFixed(0)),0n),700n);
    const loser=rows.find(r=>r.settledAmount.toFixed(0)==="0")!;assert.equal(loser.version,0);
    await db.$transaction(tx=>linkTradeBank(tx,data(loser.id,"300")));
    const links=await db.tradeBankLink.aggregate({where:{transactionId:bank.id,voidedAt:null},_sum:{amount:true}});assert.equal(links._sum.amount?.toFixed(0),"1000");
  } finally {
    await db.tradeBankLink.deleteMany({where:{documentId:{in:ids}}});await db.tradeDocument.deleteMany({where:{id:{in:ids}}});if(accountId){await db.bankTransaction.deleteMany({where:{accountId}});await db.bankAccount.delete({where:{id:accountId}});}if(partnerId)await db.partner.delete({where:{id:partnerId}});
    if(!companyExisted){const c=await db.company.findUnique({where:{id:COMPANY_ID},include:{_count:{select:{projects:true,partners:true,accounts:true,cashPlans:true,cashBaselines:true,classificationBatches:true,tradeDocuments:true}}}});if(c?.name===`동시 연결 검증 ${tag}`&&!Object.values(c._count).some(Boolean))await db.company.delete({where:{id:COMPANY_ID}});}
    await db.$disconnect();
  }
});

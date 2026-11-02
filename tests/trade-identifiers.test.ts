import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {normalizeTaxApproval} from "../src/lib/trade-identifiers";
import {saveTradeDocument,voidTradeDocument} from "../src/lib/trades";
import {captureAccounting} from "../src/lib/accounting-delivery";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries({requestId:randomUUID(),reason:"승인번호 합성 검증",...v}).forEach(([k,v])=>d.set(k,v));return d;};
test("승인번호는 공백·하이픈·전각·대소문자를 정규화하고 빈 값과 잘못된 문자를 구분한다",()=>{
 assert.equal(normalizeTaxApproval(" ２０２６１００１-ab12-34 "),"20261001AB1234");assert.equal(normalizeTaxApproval(""),null);assert.throws(()=>normalizeTaxApproval("확인중"),/영문·숫자/);assert.throws(()=>normalizeTaxApproval("=SUM(A1)"),/영문·숫자/);
});
test("활성 세금계산서 승인번호 중복을 막고 기존 값 보존·취소 이력·전달본을 구분한다",async()=>{
 const db=getDb(),rollback=new Error("rollback identifiers");try{await assert.rejects(db.$transaction(async tx=>{
 await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"승인번호 검증 회사"},update:{}});const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"합성 승인번호 업체",type:"BOTH"}});const approval=randomUUID().replaceAll("-","").toUpperCase();
 const base={kind:"PURCHASE",reference:randomUUID(),title:"승인번호 원본",partnerId:partner.id,issuedDate:"2026-10-01",supplyAmount:"1000",taxAmount:"100",taxKind:"TAXABLE",evidence:"TAX_INVOICE",proofConfirmed:"on",inputVatReview:"PENDING",version:"0"};
 const input=form({...base,taxApprovalNumber:approval.toLowerCase()});const id=await saveTradeDocument(tx,input);assert.equal(await saveTradeDocument(tx,input),id);
 await assert.rejects(saveTradeDocument(tx,form({...base,reference:randomUUID(),taxApprovalNumber:`${approval.slice(0,8)}-${approval.slice(8)}`})),/같은 전자 승인번호/);
 await assert.rejects(saveTradeDocument(tx,form({...base,kind:"SALE",reference:randomUUID(),taxApprovalNumber:approval})),/같은 전자 승인번호/);
 await assert.rejects(saveTradeDocument(tx,form({...base,reference:randomUUID(),evidence:"STATEMENT",taxApprovalNumber:"OTHER123"})),/세금계산서 원본/);
 await saveTradeDocument(tx,form({...base,id,reference:base.reference,title:"메모 수정",version:"0"}));assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id}})).taxApprovalNumber,approval);
 const snapshot=await captureAccounting(tx,"2026-10");const table=snapshot.snapshot.tables.find(t=>t.title==="매입 매출")!;assert.ok(table.rows.every(r=>r.length===table.headers.length));const row=table.rows.find(r=>r[0]===id)!;assert.equal(row[table.headers.indexOf("전자 승인번호")],approval);
 await voidTradeDocument(tx,form({documentId:id,version:"1"}));const newId=await saveTradeDocument(tx,form({...base,reference:randomUUID(),taxApprovalNumber:approval}));assert.notEqual(newId,id);assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id}})).taxApprovalNumber,approval);assert.ok((await tx.tradeDocument.findUniqueOrThrow({where:{id}})).voidedAt);
 const noApproval=await saveTradeDocument(tx,form({...base,reference:randomUUID()}));assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:noApproval}})).taxApprovalNumber,null);
 throw rollback;
 },{timeout:25000}),err=>err===rollback);}finally{await db.$disconnect();}
});
test("같은 승인번호를 동시에 등록해도 활성 문서는 한 건만 생성한다",async()=>{
 const db=getDb(),tag=randomUUID(),approval=tag.replaceAll("-","").toUpperCase();let partnerId="";
 try{
  await db.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"승인번호 동시 검증"},update:{}});partnerId=(await db.partner.create({data:{companyId:COMPANY_ID,code:tag,name:"합성 동시 승인번호",type:"SUPPLIER"}})).id;
  const attempts=await Promise.allSettled([0,1].map(index=>db.$transaction(tx=>saveTradeDocument(tx,form({kind:"PURCHASE",reference:`${tag}-${index}`,title:"동일 승인번호 동시 요청",partnerId,issuedDate:"2026-10-01",supplyAmount:"1000",taxAmount:"100",taxKind:"TAXABLE",evidence:"TAX_INVOICE",inputVatReview:"PENDING",version:"0",taxApprovalNumber:approval})))));
  assert.equal(attempts.filter(a=>a.status==="fulfilled").length,1);assert.equal(attempts.filter(a=>a.status==="rejected").length,1);assert.equal(await db.tradeDocument.count({where:{companyId:COMPANY_ID,taxApprovalNumber:approval,voidedAt:null}}),1);
 }finally{if(partnerId){await db.tradeDocumentChange.deleteMany({where:{document:{partnerId}}});await db.tradeDocument.deleteMany({where:{partnerId}});await db.partner.delete({where:{id:partnerId}});}await db.$disconnect();}
});

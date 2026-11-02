import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {matchTradeWorkbookRow,type ExistingTrade} from '../src/lib/trade-workbook-match';
import type {TradeWorkbookRow} from '../src/lib/trade-workbook-review';
import {findExistingWorkbookTrades} from '../src/lib/trade-workbook-existing';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
const row:TradeWorkbookRow={sheet:'매 입',row:2,kind:'PURCHASE',date:'2026-10-01',approval:'MATCH1',partner:'합성 업체',gross:'1100',supply:'1000',tax:'100',status:'REVIEW',reasons:[],raw:[]};
const document:ExistingTrade={id:'test',reference:'관리1',approval:'MATCH1',kind:'PURCHASE',date:'2026-10-01',partner:'합성업체',gross:'1100',supply:'1000',tax:'100',voided:false};
test('기존 ERP 대조는 주요항목 일치·금액 차이·취소 이력·번호 없는 자료를 구분한다',()=>{
 assert.equal(matchTradeWorkbookRow(row,[document]).status,'MATCH');const withBusiness={...row,raw:Array(10).fill('')};withBusiness.raw[4]='0012345678';assert.equal(matchTradeWorkbookRow(withBusiness,[{...document,businessNumber:'0012345678'}]).status,'MATCH');assert.ok(matchTradeWorkbookRow(withBusiness,[document]).differences.includes('거래처 사업자번호 미등록'));assert.ok(matchTradeWorkbookRow(withBusiness,[{...document,businessNumber:'9999999999'}]).differences.includes('거래처 사업자번호'));const different=matchTradeWorkbookRow(row,[{...document,kind:'SALE',gross:'2200'}]);assert.equal(different.status,'CONFLICT');assert.ok(different.differences.includes('합계금액'));assert.ok(different.differences.includes('매입·매출 구분'));assert.equal(matchTradeWorkbookRow(row,[{...document,voided:true}]).status,'VOID_ONLY');assert.equal(matchTradeWorkbookRow(row,[]).status,'UNREGISTERED');assert.equal(matchTradeWorkbookRow({...row,approval:''},[document]).status,'NO_APPROVAL');
 const huge={...row,gross:'99999999999999999999',supply:'99999999999999999899'};assert.equal(matchTradeWorkbookRow(huge,[{...document,gross:huge.gross,supply:huge.supply}]).status,'MATCH');assert.equal(matchTradeWorkbookRow(huge,[{...document,gross:'99999999999999999998',supply:huge.supply}]).status,'CONFLICT');
});
test('기존 자료 조회는 회사 범위·취소 이력을 보존하고 ERP를 수정하지 않는다',async()=>{
 const db=getDb(),rollback=new Error('MATCH_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'합성 대조 회사'},update:{}});const other=await tx.company.create({data:{name:'타사 합성 대조 회사'}});const approval=randomUUID().replace(/-/g,'').toUpperCase();
  for(const companyId of [COMPANY_ID,other.id]){const partner=await tx.partner.create({data:{companyId,code:randomUUID(),name:'합성업체',type:'SUPPLIER'}});for(const voided of [false,true])await tx.tradeDocument.create({data:{companyId,partnerId:partner.id,kind:'PURCHASE',title:'합성 대조 문서',reference:randomUUID(),taxApprovalNumber:approval,issuedDate:new Date('2026-10-01'),supplyAmount:'1000',taxAmount:'100',grossAmount:'1100',taxKind:'TAXABLE',evidence:'TAX_INVOICE',note:'합성 대조',voidedAt:voided?new Date():null}});}
  const before=await tx.tradeDocument.findMany({where:{companyId:COMPANY_ID,taxApprovalNumber:approval},orderBy:{id:'asc'}});const result=await findExistingWorkbookTrades(tx,[approval.toLowerCase(),approval]);assert.equal(result.length,2);assert.equal(result.filter(d=>!d.voided).length,1);assert.deepEqual(result.map(d=>d.id).sort(),before.map(d=>d.id).sort());assert.deepEqual(await tx.tradeDocument.findMany({where:{companyId:COMPANY_ID,taxApprovalNumber:approval},orderBy:{id:'asc'}}),before);
  await assert.rejects(findExistingWorkbookTrades(tx,[]),/1~500/);await assert.rejects(findExistingWorkbookTrades(tx,Array(501).fill(approval)),/1~500/);await assert.rejects(findExistingWorkbookTrades(tx,[{approval}]),/형식/);throw rollback;
 },{timeout:15000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});

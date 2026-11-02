import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeBusinessNumber,formatBusinessNumber} from '../src/lib/business-number';
import {saveMaster} from '../src/lib/master-data';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
const form=(v:Record<string,string>)=>{const f=new FormData();for(const[k,x]of Object.entries(v))f.set(k,x);return f;};
test('사업자번호 형식은 앞자리 0·전각·하이픈을 보존하며 등록 상태를 추정하지 않는다',()=>{assert.equal(normalizeBusinessNumber('００１-２３-４５６７８'),'0012345678');assert.equal(formatBusinessNumber('0012345678'),'001-23-45678');assert.equal(normalizeBusinessNumber(' '),null);assert.throws(()=>normalizeBusinessNumber('12345'),/10자리/);assert.throws(()=>normalizeBusinessNumber('123456789A'),/10자리/);});
test('사업자번호 정정은 이력을 남기고 기존 송금 계좌 확인을 보류하며 생략 수정은 번호를 유지한다',async()=>{
 const db=getDb(),rollback=new Error('IDENTITY_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'합성 사업자 대조'},update:{}});const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID().slice(0,20),name:'합성 업체',type:'SUPPLIER',businessNumber:'1234567890',payeeBank:'합성은행',payeeAccount:'1234567890',payeeHolder:'합성 업체',payeeVerifiedAt:new Date()}});
  const values={id:partner.id,version:'0',name:partner.name,code:partner.code,type:'SUPPLIER',active:'on',businessNumber:'001-23-45678',identityReason:'사업자 원본 대조'};await saveMaster(tx,'partners',form(values));let current=await tx.partner.findUniqueOrThrow({where:{id:partner.id}});assert.equal(current.businessNumber,'0012345678');assert.equal(current.payeeVerifiedAt,null);assert.equal(current.payeeAccount,'1234567890');assert.equal(current.version,1);assert.equal(await tx.partnerIdentityChange.count({where:{partnerId:partner.id}}),1);assert.equal(await tx.partnerPaymentChange.count({where:{partnerId:partner.id}}),1);
  await assert.rejects(saveMaster(tx,'partners',form(values)),/변경/);const omitted={...values,version:'1'};const noBusiness=form(omitted);noBusiness.delete('businessNumber');noBusiness.delete('identityReason');await saveMaster(tx,'partners',noBusiness);current=await tx.partner.findUniqueOrThrow({where:{id:partner.id}});assert.equal(current.businessNumber,'0012345678');assert.equal(await tx.partnerIdentityChange.count({where:{partnerId:partner.id}}),1);
  await assert.rejects(saveMaster(tx,'partners',form({...values,version:'2',businessNumber:'',identityReason:''})),/사유/);await saveMaster(tx,'partners',form({...values,version:'2',businessNumber:'',identityReason:'원본 재확인 대기'}));assert.equal((await tx.partner.findUniqueOrThrow({where:{id:partner.id}})).businessNumber,null);assert.equal(await tx.partnerIdentityChange.count({where:{partnerId:partner.id}}),2);throw rollback;
 },{timeout:15000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});

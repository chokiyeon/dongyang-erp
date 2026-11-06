import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getDb} from '../src/lib/db';
import {COMPANY_ID} from '../src/lib/constants';
import {saveCompany} from '../src/lib/master-data';
import {companyProfile} from '../src/lib/company-profile';
const form=(values:Record<string,string>)=>{const d=new FormData();for(const[k,v]of Object.entries({requestId:randomUUID(),...values}))d.set(k,v);return d;};
test('사업자등록증 회사 정보는 원 단위 식별자·공동대표·주소를 저장하고 재시도·버전·생략 덮어쓰기를 보호한다',async()=>{
 const db=getDb(),stop=new Error('COMPANY_PROFILE_ROLLBACK');try{await assert.rejects(db.$transaction(async tx=>{
 const current=await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:'합성 회사'},update:{}}),d=form({version:String(current.version),name:'합성 등록 법인',representatives:'대표 갑\n대표 을',businessNumber:'001-23-45678',corporateNumber:'000000-1234567',registrationUnitNumber:'0001',taxpayerType:'법인사업자 · 일반과세자',businessStartDate:'2020-01-02',registrationDate:'2026-10-01',businessAddress:'합성 사업장 주소',headOfficeAddress:'합성 본점 주소',businessType:'건설업\n도소매업',businessItems:'전기공사 · 계장공사',taxOffice:'합성 세무서',phone:'063-000-0000',fax:'063-000-0001',email:'office@example.test',reason:'합성 사업자등록증 확인'});
 await saveCompany(tx,d);await saveCompany(tx,d);const first=await tx.company.findUniqueOrThrow({where:{id:COMPANY_ID}});assert.equal(first.version,current.version+1);assert.equal(first.businessNumber,'0012345678');assert.equal(first.corporateNumber,'0000001234567');assert.equal(first.registrationUnitNumber,'0001');assert.deepEqual(first.representatives,['대표 갑','대표 을']);assert.equal(first.businessAddress,'합성 사업장 주소');assert.equal(first.businessStartDate?.toISOString().slice(0,10),'2020-01-02');assert.equal(await tx.financeChange.count({where:{requestId:String(d.get('requestId'))}}),1);
 const changed=new FormData();for(const[k,v]of d)changed.append(k,v);changed.set('name','잘못된 재요청');await assert.rejects(saveCompany(tx,changed),/다른 내용/);await assert.rejects(saveCompany(tx,form({version:String(current.version),name:'낡은 수정',representatives:'대표 갑'})),/변경/);
 await saveCompany(tx,form({version:String(first.version),name:'합성 상호 정정',representatives:'대표 갑'}));const final=await tx.company.findUniqueOrThrow({where:{id:COMPANY_ID}});assert.equal(final.businessNumber,first.businessNumber);assert.equal(final.businessAddress,first.businessAddress);assert.equal(final.corporateNumber,first.corporateNumber);
 throw stop;
 },{timeout:30000}),e=>e===stop);}finally{await db.$disconnect();}
});
test('회사 식별번호·날짜·이메일은 잘못된 형식을 거부하고 명시한 빈값만 비운다',()=>{
 const inputs:Record<string,string>[]=[{businessNumber:'123'},{corporateNumber:'123'},{registrationUnitNumber:'01'},{businessStartDate:'2026-02-30'},{email:'not-mail'}];for(const input of inputs)assert.throws(()=>companyProfile(form(input),null));
 const p=companyProfile(form({businessNumber:'',corporateNumber:'',email:''}),null);assert.equal(p.businessNumber,null);assert.equal(p.email,null);
});

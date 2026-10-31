import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {saveLabor,laborMonth,laborAmount,laborUnits} from "../src/lib/labor";
const form=(v:Record<string,string>)=>{const f=new FormData();Object.entries(v).forEach(([k,v])=>f.set(k,v));return f;};
const request=(v:Record<string,string>)=>form({requestId:randomUUID(),reason:"합성 인력 검증",...v});
test("공수는 정밀하게 계산하고 원 미만·0공수·범위를 검증한다",()=>{
 assert.equal(laborUnits("1.50"),150n);assert.equal(laborAmount("200000","1.5"),"300000");assert.equal(laborAmount("99999999999999999900","0.01"),"999999999999999999");assert.throws(()=>laborAmount("123","0.01"),/원 미만/);for(const value of["0","-1","10","1.001","01","1e0"])assert.throws(()=>laborUnits(value));assert.throws(()=>laborAmount("99999999999999999999","2"),/범위/);
});
test("계약·출역은 날짜별 실제 일당을 보존하고 여러 현장·신호수·사무실 월급을 구분한다",async()=>{
 const db=getDb();const rollback=new Error("rollback");try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증 회사"},update:{}});
  const person=request({code:randomUUID().slice(0,20),name:"합성 일용직",kind:"DAILY",startDate:"2026-09-01",active:"on"});const id=await saveLabor(tx,"employee",person);assert.equal(await saveLabor(tx,"employee",person),id);
  const a=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID().slice(0,20),name:"검증 A공사"}});const b=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID().slice(0,20),name:"검증 B공사"}});
  const normal=request({employeeId:id,effectiveDate:"2026-09-01",role:"NORMAL",amount:"200000"});await saveLabor(tx,"rate",normal);await saveLabor(tx,"rate",normal);assert.equal(await tx.employmentRate.count({where:{employeeId:id}}),1);
  const work=(v:Record<string,string>)=>request({employeeId:id,projectId:a.id,workedDate:"2026-10-01",role:"NORMAL",units:"0.5",source:"소장 사진 확인",...v});
  const first=work({});const wid=await saveLabor(tx,"work",first);await saveLabor(tx,"work",first);assert.equal(await tx.workRecord.count({where:{employeeId:id}}),1);await assert.rejects(saveLabor(tx,"work",work({})),/같은 직원/);
  await assert.rejects(saveLabor(tx,"work",work({role:"SIGNAL",projectId:b.id})),/계약 단가/);await saveLabor(tx,"rate",request({employeeId:id,effectiveDate:"2026-09-01",role:"SIGNAL",amount:"120000"}));
  await saveLabor(tx,"work",work({role:"SIGNAL",projectId:b.id}));const extended=await saveLabor(tx,"work",work({workedDate:"2026-10-02",units:"1.5"}));
  const office=await saveLabor(tx,"employee",request({code:randomUUID().slice(0,20),name:"합성 사무실",kind:"MONTHLY",startDate:"2026-09-01",active:"on"}));await saveLabor(tx,"rate",request({employeeId:office,effectiveDate:"2026-09-01",role:"NORMAL",amount:"3000000"}));await assert.rejects(saveLabor(tx,"work",work({employeeId:office})),/작업일|출역을 입력하지/);await assert.rejects(saveLabor(tx,"rate",request({employeeId:office,effectiveDate:"2026-10-01",role:"SIGNAL",amount:"100"})),/월급제/);
  let summary=await laborMonth(tx,"2026-10");let daily=summary.daily.find(r=>r.employee.id===id)!;assert.equal(daily.amount,460000n);assert.equal(daily.units,250n);assert.ok(daily.issues.some(s=>s.includes("1공수 초과")));assert.equal(summary.projects.find(p=>p.id===a.id)?.amount,400000n);assert.equal(summary.projects.find(p=>p.id===b.id)?.amount,60000n);assert.equal(summary.monthly.find(r=>r.employee.id===office)?.rate?.amount.toFixed(0),"3000000");
  const rate=await tx.employmentRate.findFirstOrThrow({where:{employeeId:id,role:"NORMAL"}});await saveLabor(tx,"rate",request({employeeId:id,rateId:rate.id,version:"0",effectiveDate:"2026-09-01",role:"NORMAL",amount:"220000"}));assert.equal((await tx.workRecord.findUniqueOrThrow({where:{id:wid}})).amount.toFixed(0),"100000");summary=await laborMonth(tx,"2026-10");assert.ok(summary.daily.find(r=>r.employee.id===id)?.issues.some(s=>s.includes("계약 변경")));
  await saveLabor(tx,"work",work({workId:wid,version:"0"}));assert.equal((await tx.workRecord.findUniqueOrThrow({where:{id:wid}})).amount.toFixed(0),"110000");await assert.rejects(saveLabor(tx,"work",work({workId:wid,version:"0"})),/변경/);await assert.rejects(saveLabor(tx,"rateVoid",request({employeeId:id,rateId:rate.id,version:"1"})),/사용 중인/);
  await saveLabor(tx,"workVoid",request({employeeId:id,workId:extended,version:"0"}));daily=(await laborMonth(tx,"2026-10")).daily.find(r=>r.employee.id===id)!;assert.equal(daily.amount,170000n);assert.ok(!daily.issues.some(s=>s.includes("1공수 초과")));
  const employee=await tx.employee.findUniqueOrThrow({where:{id}});await assert.rejects(saveLabor(tx,"employee",request({employeeId:id,version:String(employee.version),code:employee.code,name:employee.name,kind:"DAILY",startDate:"2026-10-02",active:"on"})),/기간 밖/);
  const otherCompany=await tx.company.create({data:{name:"다른 합성 회사"}});const otherProject=await tx.project.create({data:{companyId:otherCompany.id,code:randomUUID().slice(0,20),name:"다른 회사 현장"}});await assert.rejects(saveLabor(tx,"work",work({projectId:otherProject.id})),/회사 현장/);
  assert.ok(await tx.laborChange.count({where:{employeeId:id}})>5);throw rollback;
 },{timeout:20000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});
test("동시에 같은 출역을 저장해도 한 건만 등록한다",async()=>{
 const db=getDb();let id="";let projectId="";let createdCompany=false;try{
 const company=await db.company.findUnique({where:{id:COMPANY_ID}});if(!company){await db.company.create({data:{id:COMPANY_ID,name:"동시 출역 검증 회사"}});createdCompany=true;}
 id=await db.$transaction(tx=>saveLabor(tx,"employee",request({code:randomUUID().slice(0,20),name:"동시 검증 직원",kind:"DAILY",startDate:"2026-09-01",active:"on"})));await db.$transaction(tx=>saveLabor(tx,"rate",request({employeeId:id,effectiveDate:"2026-09-01",role:"NORMAL",amount:"200000"})));projectId=(await db.project.create({data:{companyId:COMPANY_ID,code:randomUUID().slice(0,20),name:"동시 검증 현장"}})).id;
 const values={employeeId:id,projectId,workedDate:"2026-10-01",role:"NORMAL",units:"1",source:"동시 합성 출역"};const results=await Promise.allSettled([db.$transaction(tx=>saveLabor(tx,"work",request(values))),db.$transaction(tx=>saveLabor(tx,"work",request(values)))]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(await db.workRecord.count({where:{employeeId:id}}),1);
 }finally{if(id){await db.laborChange.deleteMany({where:{employeeId:id}});await db.workRecord.deleteMany({where:{employeeId:id}});await db.employmentRate.deleteMany({where:{employeeId:id}});await db.employee.delete({where:{id}});}if(projectId)await db.project.delete({where:{id:projectId}});if(createdCompany)await db.company.delete({where:{id:COMPANY_ID}});await db.$disconnect();}
});

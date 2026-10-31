import "dotenv/config";
import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {getDb} from "../src/lib/db";
import {COMPANY_ID} from "../src/lib/constants";
import {saveWorkBatch} from "../src/lib/work-batch";
import {saveLabor} from "../src/lib/labor";
const form=(v:Record<string,string>)=>{const d=new FormData();Object.entries({requestId:randomUUID(),source:"합성 출역표",reason:"일괄 출역 검증",...v}).forEach(([k,v])=>d.set(k,v));return d;};
test("월별 공수는 날짜별 단가·원자적 저장·요청 재시도·동시 중복을 보호한다",async()=>{
 const db=getDb();let employeeId="",projectId="";const name=`월 공수 검증 ${randomUUID()}`;const existed=Boolean(await db.company.findUnique({where:{id:COMPANY_ID}}));
 try{
 await db.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name},update:{}});
 employeeId=(await db.employee.create({data:{companyId:COMPANY_ID,code:randomUUID(),name,kind:"DAILY",startDate:new Date("2026-01-01")}})).id;
 projectId=(await db.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name}})).id;
 await db.employmentRate.createMany({data:[{employeeId,role:"NORMAL",effectiveDate:new Date("2026-01-01"),amount:"200000"},{employeeId,role:"NORMAL",effectiveDate:new Date("2026-10-03"),amount:"220000"}]});
 await db.$transaction(tx=>saveLabor(tx,"work",form({employeeId,projectId,role:"NORMAL",workedDate:"2026-10-02",units:"1"})));
 const version=(await db.employee.findUniqueOrThrow({where:{id:employeeId}})).version;
 const values={employeeId,projectId,period:"2026-10",role:"NORMAL",version:String(version)};
 await assert.rejects(db.$transaction(tx=>saveWorkBatch(tx,form({...values,day_01:"1",day_02:"1"}))),/출역/);
 assert.equal(await db.workRecord.count({where:{employeeId}}),1);assert.equal((await db.employee.findUniqueOrThrow({where:{id:employeeId}})).version,version);
 const input=form({...values,day_01:"0.5",day_03:"1",day_04:"0"});await db.$transaction(tx=>saveWorkBatch(tx,input));await db.$transaction(tx=>saveWorkBatch(tx,input));
 const rows=await db.workRecord.findMany({where:{employeeId},orderBy:{workedDate:"asc"}});assert.equal(rows.length,3);assert.equal(rows[0].amount.toFixed(0),"100000");assert.equal(rows[2].amount.toFixed(0),"220000");assert.equal(await db.laborChange.count({where:{employeeId,operation:"workBatch"}}),1);
 input.set("day_03","0.5");await assert.rejects(db.$transaction(tx=>saveWorkBatch(tx,input)),/다른 내용/);
 const current=(await db.employee.findUniqueOrThrow({where:{id:employeeId}})).version;
 const concurrent=await Promise.allSettled([1,2].map(()=>db.$transaction(tx=>saveWorkBatch(tx,form({...values,version:String(current),day_04:"1"})))));assert.equal(concurrent.filter(r=>r.status==="fulfilled").length,1);assert.equal(await db.workRecord.count({where:{employeeId,workedDate:new Date("2026-10-04")}}),1);
 await assert.rejects(db.$transaction(tx=>saveWorkBatch(tx,form({...values,period:"2026-02",day_30:"1"}))),/없는 날짜/);
 }finally{
 if(employeeId){await db.laborChange.deleteMany({where:{employeeId}});await db.workRecord.deleteMany({where:{employeeId}});await db.employmentRate.deleteMany({where:{employeeId}});await db.employee.delete({where:{id:employeeId}});}if(projectId)await db.project.delete({where:{id:projectId}});if(!existed)await db.company.deleteMany({where:{id:COMPANY_ID,name}});await db.$disconnect();
 }
});

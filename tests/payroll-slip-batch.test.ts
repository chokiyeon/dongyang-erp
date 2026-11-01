import {test} from "node:test";
import assert from "node:assert/strict";
import {uniquePayrollSlipFilename} from "../src/lib/payroll-slip-batch";
test("동명이인·이름 정규화·Windows 대소문자 충돌에도 JPG가 덮어써지지 않는다",()=>{
 const used=new Set<string>();
 assert.equal(uniquePayrollSlipFilename("홍길동","2026-10",used),"홍길동_2026-10_임금명세서.jpg");
 assert.equal(uniquePayrollSlipFilename("홍길동","2026-10",used),"홍길동_2026-10_임금명세서_2.jpg");
 assert.equal(uniquePayrollSlipFilename("A/B","2026-10",used),"A_B_2026-10_임금명세서.jpg");
 assert.equal(uniquePayrollSlipFilename("a:b","2026-10",used),"a_b_2026-10_임금명세서_2.jpg");
});

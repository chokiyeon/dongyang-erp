import {test} from "node:test";
import assert from "node:assert/strict";
import {reverseSalary,manwonToWon,SALARY_DEDUCTIONS} from "../src/lib/salary-calculator";
test("세후 만원 입력과 확인한 공제액 역산은 원 단위 정밀도를 유지한다",()=>{
 assert.equal(manwonToWon("250"),"2500000");assert.equal(manwonToWon("250.0001"),"2500001");assert.throws(()=>manwonToWon("0"));assert.throws(()=>manwonToWon("250.00001"));
 const deductions={...Object.fromEntries(SALARY_DEDUCTIONS.map(([key])=>[key,"0"])),pension:"100000",health:"80000",incomeTax:"40000"};const result=reverseSalary({target:"2500000",mode:"FIXED",deductions});assert.equal(result.gross,2720000n);assert.equal(result.net,2500000n);assert.equal(result.deduction,220000n);assert.throws(()=>reverseSalary({target:"2500000",mode:"FIXED",deductions:{...deductions,pension:""}}));
});
test("공제율 역산은 목표액을 충족하는 최소 원 단위 급여를 찾고 범위를 검사한다",()=>{
 const r=reverseSalary({target:"2500000",mode:"RATE",rate:"10",fixed:"0"});assert.equal(r.gross,2777777n);assert.equal(r.net,2500000n);const before=r.gross-1n;assert.equal(before-before/10n,2499999n);
 assert.equal(reverseSalary({target:"2500000",mode:"RATE",rate:"0",fixed:"100000"}).gross,2600000n);
 const large=reverseSalary({target:"9007199254740993",mode:"RATE",rate:"1.2345",fixed:"17"});assert.ok(large.net>=9007199254740993n);
 for(const rate of ["100","-1","","1.12345"])assert.throws(()=>reverseSalary({target:"2500000",mode:"RATE",rate,fixed:"0"}));
 assert.throws(()=>reverseSalary({target:"99999999999999999999",mode:"RATE",rate:"99.9999",fixed:"0"}),/범위/);
});

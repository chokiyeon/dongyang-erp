import {test} from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {payrollSlipWorkbook} from "../src/lib/payroll-slip-export";
import {payrollSlipFilename} from "../src/lib/payroll-slip-image";
import type {PayrollSlipData} from "../src/components/payroll-slip";
test("개별 명세서 엑셀은 직원 한 명·시트 한 개·A4 세로 한 장 인쇄 범위를 유지한다",async()=>{
 const d:PayrollSlipData={period:"2026-10",company:"합성 회사",employee:"합성 직원",code:"EMP-TEST",kind:"상용직",dueDate:"2026-11-15",account:"****1234",review:[],earnings:[{label:"기본급",amount:"3000000"},{label:"미입력 수당",amount:null}],deductions:[{label:"소득세",amount:"100000"}],earningTotal:"3000000",deductionTotal:"100000",adjustment:"0",net:"2900000",actual:"0",remaining:"2900000",reason:"합성 검증",daily:false,method:"저장 기준",units:"미입력",rate:"미입력"};const book=new ExcelJS.Workbook();await book.xlsx.load(new Uint8Array(await payrollSlipWorkbook(d)).buffer);assert.equal(book.worksheets.length,1);const s=book.worksheets[0];assert.equal(s.getCell("B3").value,"합성 직원");assert.equal(s.getCell("B7").value,3000000);assert.equal(s.getCell("B8").value,"미확인");assert.equal(s.pageSetup.fitToWidth,1);assert.equal(s.pageSetup.fitToHeight,1);assert.equal(s.pageSetup.orientation,"portrait");assert.match(s.pageSetup.printArea??"",/A1:D/);
 assert.equal(payrollSlipFilename("홍길동","2026-10"),"홍길동_2026-10_임금명세서.jpg");assert.equal(payrollSlipFilename("../직원:이름","2026-10"),".._직원_이름_2026-10_임금명세서.jpg");
});

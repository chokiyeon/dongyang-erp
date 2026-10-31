import {test} from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {payrollExcelMoney,payrollWorkbook} from "../src/lib/payroll-export";
import type {PayrollMonth} from "../src/lib/payroll-register-data";
test("급여 엑셀은 큰 금액을 문자열로 보존하고 윤년 날짜·인쇄 설정·문자열을 유지한다",async()=>{
 assert.equal(payrollExcelMoney(999999999999999n),999999999999999);assert.equal(payrollExcelMoney(1000000000000001n),"1000000000000001");
 const empty:PayrollMonth={period:"2028-02",daily:[],monthly:[],projects:[],records:[],dailyTotal:0n};const bytes=await payrollWorkbook('=HYPERLINK("example","회사")',empty,[],[],"DAILY");const book=new ExcelJS.Workbook();await book.xlsx.load(new Uint8Array(bytes).buffer);const s=book.worksheets[0];assert.equal(s.getCell("A2").type,ExcelJS.ValueType.String);assert.equal(s.getCell("A2").formula,undefined);assert.equal(s.getCell("R6").value,29);assert.equal(s.getCell("S6").value,null);assert.equal(s.getCell("T6").value,null);assert.equal(s.pageSetup.orientation,"landscape");assert.equal(s.pageSetup.printTitlesRow,"1:6");assert.equal(book.worksheets.length,2);
 const monthlyBytes=await payrollWorkbook("검증 회사",empty,[],[],"MONTHLY");const monthly=new ExcelJS.Workbook();await monthly.xlsx.load(new Uint8Array(monthlyBytes).buffer);assert.equal(monthly.worksheets[0].getCell("I5").value,"기본급");assert.equal(monthly.worksheets[0].getCell("I6").value,"직무(업무)수당");
});

import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {parseBankWorkbook} from "../src/lib/bank-import";
import {analyzeLegacyLedger} from "../src/lib/legacy-ledger";
import {buildLegacyReviewWorkbook,legacyReviewFileName} from "../src/lib/legacy-review-export";
test("은행 파일의 계산되지 않은 수식·오류·참거짓 금액을 빈칸이나 0원으로 무시하지 않는다",()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("은행");sheet.addRow(["거래일자","적요","입금액","출금액","잔액"]);sheet.addRow(["2026-10-01","정상 출금",0,500,500]);sheet.addRow(["2026-10-02","수식 검토",{formula:"1000"},0,1500]);
 assert.throws(()=>parseBankWorkbook(book),/3행:.*수식 결과가 없습니다/);sheet.getCell("C3").value={formula:"1000",result:1000};assert.equal(parseBankWorkbook(book).length,2);sheet.getCell("C3").value={error:"#VALUE!"};assert.throws(()=>parseBankWorkbook(book),/3행:.*계산 오류/);sheet.getCell("C3").value=true;assert.throws(()=>parseBankWorkbook(book),/3행:.*참\/거짓/);
});
test("기존 장부 검토표는 원본 행·수식 오류·큰 금액·앞자리 0을 보존하고 후보 전체를 저장한다",async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("2026");sheet.addRow([]);sheet.addRow(["날짜","구분","", "ㅡ","내역","입금(차입금)","입금","출금","잔액"]);sheet.addRow(["2026-10-01","00123","전북",null,"=HYPERLINK(검증)",0,"10000000000000000001",0,0]);sheet.addRow(["2026-10-02","00456","전북",null,"수식 검토",0,{formula:"SUM(A1:A2)"},0,0]);
 const review=analyzeLegacyLedger(book,"2026","2026-11-02");assert.equal(review.rows.length,1);assert.equal(review.issues.length,1);assert.equal(review.issues[0].sourceRow,4);assert.match(review.issues[0].reason,/수식 결과/);assert.equal(review.issues[0].rawIncoming,"=SUM(A1:A2)");
 review.rows=Array.from({length:300},(_,i)=>({...review.rows[0],sourceRow:i+3}));const output=await buildLegacyReviewWorkbook(review,"a".repeat(64),"2026-11-02");const buffer=await output.xlsx.writeBuffer();const saved=new ExcelJS.Workbook();await saved.xlsx.load(new Uint8Array(buffer).buffer);
 assert.equal(saved.worksheets.length,3);const candidates=saved.getWorksheet("가져오기 후보 전체")!;assert.equal(candidates.rowCount,301);assert.equal(candidates.getCell("E301").value,"10000000000000000001");assert.equal(candidates.getCell("E2").type,ExcelJS.ValueType.String);assert.equal(candidates.getCell("G2").value,"00123");assert.equal(candidates.getCell("F2").type,ExcelJS.ValueType.String);assert.equal(candidates.getCell("F2").formula,undefined);
 const issues=saved.getWorksheet("확인 필요 행")!;assert.equal(issues.getCell("A2").value,4);assert.equal(issues.getCell("E2").value,"=SUM(A1:A2)");assert.equal(issues.getCell("E2").formula,undefined);assert.equal(issues.views[0].state,"frozen");assert.equal(saved.getWorksheet("검토 안내")!.getCell("B4").value,"a".repeat(64));
 assert.doesNotMatch(legacyReviewFileName('../2026\\:*?',"2026-11-02"),/[\/\\:*?]/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {reviewTradeWorkbook,buildTradeWorkbookReview} from '../src/lib/trade-workbook-review';
function fixture(){const book=new ExcelJS.Workbook();for(const name of ['매 출','출1','매 입','입1']){const s=book.addWorksheet(name),header=Array(43).fill('');header[0]='작성일자';header[1]='승인번호';header[14]='합계금액';header[15]='공급가액';header[16]='세액';header[42]='원본 메모';s.addRow(header);}return book;}
function row(approval='0001-A',value='1100'){const a=Array(43).fill('');a[0]='2026-10-01';a[1]=approval;a[4]='0012345678';a[6]='합성 공급업체';a[9]='0098765432';a[11]='합성 고객';a[14]=value;a[15]='1000';a[16]='100';a[26]='합성 자재';a[42]='=원본 문자 유지';return a;}
test('전체·월별 시트 중복을 합산하지 않고 원본 위치와 확장 열을 검토표에 보존한다',async()=>{
 const book=fixture();book.getWorksheet('매 출')!.addRow(row());const copy=row('０００１ a');copy[42]='월별 별도 메모';book.getWorksheet('출1')!.addRow(copy);const memo=book.getWorksheet('출1')!.getRow(3);memo.getCell(43).value='거래 없이 작성한 메모';
 const result=reviewTradeWorkbook(book,'2026-11-02');assert.equal(result.rows.length,2);assert.equal(result.rows[0].status,'REVIEW');assert.equal(result.rows[1].status,'DUPLICATE');assert.equal(result.rows[1].duplicateOf,'매 출!2');assert.equal(result.rows[1].raw[42],'월별 별도 메모');
 const exportBook=await buildTradeWorkbookReview(result,'a'.repeat(64));const bytes=await exportBook.xlsx.writeBuffer(),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes);assert.equal(loaded.getWorksheet('원본_1')!.getCell('AR3').value,'=원본 문자 유지');assert.equal(loaded.getWorksheet('원본_2')!.getCell('AR3').value,'월별 별도 메모');assert.equal(loaded.getWorksheet('원본_1')!.getCell('F3').value,'0012345678');assert.equal(loaded.getWorksheet('원본_2')!.getCell('AR4').value,'거래 없이 작성한 메모');
});
test('같은 승인번호의 금액·거래 구분 충돌은 양쪽 모두 확인 대상으로 남긴다',()=>{
 const b=fixture();b.getWorksheet('매 출')!.addRow(row());const different=row();different[14]='2200';different[15]='2000';different[16]='200';b.getWorksheet('출1')!.addRow(different);let r=reviewTradeWorkbook(b,'2026-11-02');assert.ok(r.rows.every(x=>x.status==='HOLD'));assert.ok(r.rows.every(x=>x.reasons.some(s=>s.includes('충돌'))));
 const cross=fixture();cross.getWorksheet('매 출')!.addRow(row());cross.getWorksheet('매 입')!.addRow(row());r=reviewTradeWorkbook(cross,'2026-11-02');assert.ok(r.rows.every(x=>x.status==='HOLD'));
});
test('수정·음수·수식 누락·잘못된 날짜·숫자 승인번호를 자동 후보로 처리하지 않는다',()=>{
 const b=fixture(),s=b.getWorksheet('매 입')!;const correction=row('A');correction[14]='-1100';correction[15]='-1000';correction[16]='-100';correction[18]='수정세금계산서';s.addRow(correction);
 const formula=row('B');const r=s.addRow(formula);r.getCell(40).value={formula:'SUM(A1:A2)'};
 const missing=row('C');missing[0]='2026-02-30';s.addRow(missing);const numeric=s.addRow(row());numeric.getCell(2).value=12345;
 const zero=row('D');zero[16]='0';zero[14]='1000';s.addRow(zero);b.addWorksheet('알수없는시트').addRow(row());
 const result=reviewTradeWorkbook(b,'2026-11-02');assert.deepEqual(result.rows.map(x=>x.status),['HOLD','HOLD','HOLD','HOLD','REVIEW']);assert.ok(result.rows[0].reasons.some(x=>x.includes('음수')));assert.ok(result.rows[1].raw[39].includes('SUM'));assert.deepEqual(result.unrecognized,['알수없는시트']);
});

test('같은 청구의 다른 품목·수량·품목금액은 청구 충돌이 아니며 원본 세부행을 모두 보존한다',async()=>{
 const b=fixture(),first=row('MULTILINE');first[26]='합성 품목 A';first[28]='10';first[30]='400';first[31]='40';b.getWorksheet('매 입')!.addRow(first);const second=row('MULTILINE');second[26]='합성 품목 B';second[28]='20';second[30]='600';second[31]='60';b.getWorksheet('입1')!.addRow(second);const review=reviewTradeWorkbook(b,'2026-11-02');assert.deepEqual(review.rows.map(r=>r.status),['REVIEW','DUPLICATE']);assert.equal(review.rows[1].raw[26],'합성 품목 B');assert.ok(review.rows[1].reasons[0].includes('품목·메모는 보존'));const output=await buildTradeWorkbookReview(review,'a'.repeat(64));assert.equal(output.getWorksheet('원본_4')!.getCell('AB3').value,'합성 품목 B');
});

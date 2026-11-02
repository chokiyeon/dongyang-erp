import type {LegacyReview} from "./legacy-ledger";
export async function buildLegacyReviewWorkbook(review:LegacyReview,fileHash:string,today:string){
 const excel=await import("exceljs");const book=new (excel.Workbook??excel.default.Workbook)();book.creator="동양 ERP";
 const summary=book.addWorksheet("검토 안내");summary.columns=[{width:30},{width:100}];
 for(const row of[["항목","내용"],["원본 시트",review.sheetName],["검토일",today],["원본 파일 SHA256",fileHash],["가져오기 후보 수",String(review.rows.length)],["확인 필요 수",String(review.issues.length)],["이월·합계 제외 수",String(review.ignored.opening+review.ignored.summaries)],["금액 없는 행 제외 수",String(review.ignored.noAmount)],["후보 입금 합계",review.incoming],["후보 출금 합계",review.outgoing],["사용 방법","원본 행 번호로 돌아가 사본에서 확인·정정한 뒤 ERP에서 다시 검토하세요. 이 검토표는 자동 가져오기용 원본이 아닙니다."],["주의","저장은 장부 가져오기·은행 잔액 변경을 실행하지 않습니다. 이전 회계 구분은 참고이며 새 회계코드로 자동 확정하지 않습니다."]])summary.addRow(row);
 const issues=book.addWorksheet("확인 필요 행");issues.columns=[{width:12},{width:22},{width:24},{width:18},{width:18},{width:18},{width:26},{width:60},{width:75},{width:35}];issues.addRow(["원본 행","원본 날짜","원본 은행 표기","원본 차입 입금","원본 입금","원본 출금","이전 구분 (참고)","원본 내용","확인 사유","확인 메모"]);
 for(const r of review.issues)issues.addRow([r.sourceRow,r.rawDate??"",r.bankLabel,r.rawLoan??"",r.rawIncoming??"",r.rawOutgoing??"",r.legacyCategory,r.description,r.reason,""]);
 const candidates=book.addWorksheet("가져오기 후보 전체");candidates.columns=[{width:12},{width:18},{width:24},{width:18},{width:24},{width:60},{width:26}];candidates.addRow(["원본 행","거래일","원본 은행 표기","입출금","금액 (원)","거래내용","이전 구분 (참고)"]);
 for(const r of review.rows)candidates.addRow([r.sourceRow,r.date,r.bankLabel,r.direction==="OUT"?"출금":r.incomingType==="LOAN"?"차입 입금":"입금",r.amount,r.description,r.legacyCategory]);
 for(const sheet of book.worksheets){sheet.views=[{state:"frozen",ySplit:1}];sheet.pageSetup={orientation:"landscape",paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0};sheet.pageSetup.printTitlesRow="1:1";if(sheet!==summary)sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:sheet.columnCount}};sheet.eachRow((row,index)=>{row.eachCell(cell=>{cell.alignment={vertical:"top",wrapText:true};if(typeof cell.value==="string")cell.numFmt="@";if(index===1)cell.font={bold:true};});});}
 return book;
}
export function legacyReviewFileName(sheet:string,today:string){return `기존장부_검토_${sheet.replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_").slice(0,40)}_${today}.xlsx`;}

import {TRADE_MATCH_LABELS,type TradeWorkbookMatch} from "./trade-workbook-match";
import type {Workbook,Cell} from "exceljs";
import {spreadsheetValue,spreadsheetCellIssue,spreadsheetDate,spreadsheetMoney} from "./bank-import";
import {normalizeTaxApproval} from "./trade-identifiers";
export type TradeWorkbookRow={sheet:string;row:number;kind:"SALE"|"PURCHASE";date:string;approval:string;partner:string;supply:string;tax:string;gross:string;status:"REVIEW"|"HOLD"|"DUPLICATE";reasons:string[];raw:string[];duplicateOf?:string};
export type TradeWorkbookReview={rows:TradeWorkbookRow[];sheets:{name:string;kind:"SALE"|"PURCHASE";header:number;headers:string[];sourceRows:{row:number;values:string[]}[]}[];unrecognized:string[]};
function raw(cell:Cell):string{const v=cell.value;if(v===null||v===undefined)return "";if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==="boolean")return String(v);if(typeof v==="object"){return JSON.stringify(v);}return String(spreadsheetValue(v));}
const clean=(s:string)=>s.replace(/\s/g,"");
export function reviewTradeWorkbook(book:Workbook,today:string):TradeWorkbookReview{
 const result:TradeWorkbookReview={rows:[],sheets:[],unrecognized:[]};let scanned=0;
 for(const s of book.worksheets){
  const normalized=clean(s.name),kind=normalized==="매출"||/^출\d+$/.test(normalized)?"SALE":normalized==="매입"||/^입\d+$/.test(normalized)?"PURCHASE":null;
  let header=0;for(let r=1;r<=Math.min(12,s.rowCount);r++){const row=s.getRow(r);if(clean(String(spreadsheetValue(row.getCell(1).value)))==="작성일자"&&clean(String(spreadsheetValue(row.getCell(2).value)))==="승인번호"&&clean(String(spreadsheetValue(row.getCell(15).value)))==="합계금액"&&clean(String(spreadsheetValue(row.getCell(16).value)))==="공급가액"&&clean(String(spreadsheetValue(row.getCell(17).value)))==="세액"){header=r;break;}}
  if(!kind||!header){result.unrecognized.push(s.name);continue;}
  if(s.rowCount>15000||s.columnCount>100)throw new Error("시트당 15,000행·100열 이하 자료로 나눠 검토하세요.");
  const headers=Array.from({length:s.columnCount},(_,i)=>raw(s.getRow(header).getCell(i+1)));const sourceRows:{row:number;values:string[]}[]=[];result.sheets.push({name:s.name,kind,header,headers,sourceRows});
  for(let r=header+1;r<=s.rowCount;r++){
   const line=s.getRow(r),cells=Array.from({length:s.columnCount},(_,i)=>raw(line.getCell(i+1)));if(cells.some(Boolean)){if(++scanned>30000)throw new Error("한 파일의 검토 대상은 최대 30,000행입니다. 자료를 나눠 확인하세요.");sourceRows.push({row:r,values:cells});}if(![1,2,15,16,17].some(i=>line.getCell(i).value!==null&&line.getCell(i).value!==undefined))continue;
   const reasons:string[]=[];
   const entry:TradeWorkbookRow={sheet:s.name,row:r,kind,date:"",approval:"",partner:String(spreadsheetValue(line.getCell(kind==="SALE"?12:7).value)),supply:"",tax:"",gross:"",status:"REVIEW",reasons,raw:cells};
   for(let c=1;c<=s.columnCount;c++){const issue=spreadsheetCellIssue(line.getCell(c).value);if(issue)reasons.push(`${c}열: ${issue}`);}
   try{let v=spreadsheetValue(line.getCell(1).value);if(book.properties.date1904&&typeof v==="number")v+=1462;entry.date=spreadsheetDate(v).date;if(entry.date<"1900-01-01"||entry.date>today)reasons.push("작성일자가 실제 거래 기간을 벗어납니다.");}catch{reasons.push("작성일자를 확인하세요.");}
   try{entry.approval=normalizeTaxApproval(String(spreadsheetValue(line.getCell(2).value)))??"";if(!entry.approval)reasons.push("승인번호가 없어 원본 중복을 확인할 수 없습니다.");}catch{reasons.push("승인번호 형식을 확인하세요.");}
   if(typeof line.getCell(2).value==="number")reasons.push("숫자로 저장된 승인번호: 정밀도·앞자리 0을 원본과 확인하세요.");
   if(!entry.partner.trim())reasons.push("거래처 상호가 없습니다.");
   try{entry.gross=spreadsheetMoney(spreadsheetValue(line.getCell(15).value),true)??"";entry.supply=spreadsheetMoney(spreadsheetValue(line.getCell(16).value),true)??"";entry.tax=spreadsheetMoney(spreadsheetValue(line.getCell(17).value),true)??"";if(!entry.gross||!entry.supply||!entry.tax)throw new Error();if(BigInt(entry.gross)!==BigInt(entry.supply)+BigInt(entry.tax))reasons.push("합계금액과 공급가액·세액의 합이 다릅니다.");if([entry.gross,entry.supply,entry.tax].some(x=>BigInt(x)<0n))reasons.push("음수 금액: 수정·취소 원본과 연결해 확인해야 합니다.");if(BigInt(entry.gross)===0n)reasons.push("합계금액이 0원입니다.");}catch{reasons.push("합계금액·공급가액·세액을 원 단위 정수로 확인하세요.");}
   if([cells[17],cells[18],cells[19]].some(v=>v&&/수정|취소/.test(v)))reasons.push("수정·취소 세금계산서: 원본 승인번호와 수정 사유 확인이 필요합니다.");
   if(reasons.length)entry.status="HOLD";result.rows.push(entry);
  }
 }
 const groups=new Map<string,TradeWorkbookRow[]>();for(const r of result.rows){if(!r.approval)continue;const list=groups.get(r.approval)??[];list.push(r);groups.set(r.approval,list);}
 for(const list of groups.values()){
  if(list.length<2)continue;
  const key=(r:TradeWorkbookRow)=>JSON.stringify([r.kind,r.date,clean(r.raw[4]??""),clean(r.raw[9]??""),r.partner.trim(),r.gross,r.supply,r.tax,...r.raw.slice(17,33)]);
  if(new Set(list.map(key)).size>1){for(const r of list){r.status="HOLD";r.reasons.push("같은 승인번호의 거래 구분·금액·품목 등 내용이 다릅니다. 원본 충돌을 확인하세요.");}continue;}
  const first=list[0];for(const r of list.slice(1)){r.duplicateOf=`${first.sheet}!${first.row}`;if(r.status!=="HOLD"){r.status="DUPLICATE";r.reasons.push(`같은 승인번호·내용이 ${r.duplicateOf}에도 있습니다. 중복 합산하지 않습니다.`);}}
 }
 return result;
}
export async function buildTradeWorkbookReview(review:TradeWorkbookReview,fileHash:string,comparison?:{matches:Record<string,TradeWorkbookMatch>;checkedAt:string}){
 const excel=await import("exceljs"),book=new (excel.Workbook??excel.default.Workbook)();
 const info=book.addWorksheet("안내");info.addRow(["용도","검토 전용 · ERP 등록/수금/지급 처리 아님"]);info.addRow(["원본 SHA256",fileHash]);info.addRow(["기존 ERP 대조 시점",comparison?.checkedAt||"미대조"]);info.addRow(["상태","후보도 거래처·공사·수정 원본·기존 ERP 중복을 추가 확인해야 합니다."]);
 const summary=book.addWorksheet("검토 결과");summary.addRow(["시트","원본 행","구분","작성일자","승인번호","거래처","합계금액","공급가액","세액","상태","확인 사유","중복 원본","기존 ERP 대조","ERP 차이 항목","ERP 문서"]);
 for(const r of review.rows)summary.addRow([r.sheet,String(r.row),r.kind==="SALE"?"매출":"매입",r.date,r.approval,r.partner,r.gross,r.supply,r.tax,r.status,r.reasons.join(" / "),r.duplicateOf??"",comparison?.matches[`${r.sheet}:${r.row}`]?TRADE_MATCH_LABELS[comparison.matches[`${r.sheet}:${r.row}`].status]:"미대조",comparison?.matches[`${r.sheet}:${r.row}`]?.differences.join(", ")??"",comparison?.matches[`${r.sheet}:${r.row}`]?.documents.map(d=>`${d.reference}${d.voided?" (취소)":""}`).join(", ")??""]);
 for(const [index,s]of review.sheets.entries()){const sheet=book.addWorksheet(`원본_${index+1}`);sheet.addRow(["원본 시트",s.name]);sheet.addRow(["원본 행",...s.headers]);for(const r of s.sourceRows)sheet.addRow([String(r.row),...r.values]);}
 for(const sheet of book.worksheets){sheet.views=[{state:"frozen",ySplit:sheet===summary?1:2}];sheet.eachRow(row=>row.eachCell(cell=>{if(typeof cell.value==="string")cell.numFmt="@";}));}
 return book;
}

import type { Workbook,Cell } from "exceljs";
import { spreadsheetDate, spreadsheetMoney, spreadsheetValue, spreadsheetCellIssue } from "./bank-import";

export type LegacyLedgerRow = { sourceRow: number; date: string; bankLabel: string; description: string; legacyCategory: string; incomingType: "LOAN" | "GENERAL" | "NONE"; direction: "IN" | "OUT"; amount: string; ledgerBalance: string | null };
export type LegacyIssue = { sourceRow: number; reason: string; description: string; bankLabel: string; legacyCategory: string; rawDate?:string; rawLoan?:string; rawIncoming?:string; rawOutgoing?:string };
export type LegacyReview = { sheetName: string; layout?:"SEPARATE_LOAN"|"SINGLE_INCOME"; rows: LegacyLedgerRow[]; issues: LegacyIssue[]; ignored: { opening: number; summaries: number; noAmount: number }; incoming: string; outgoing: string };
export function legacyBankName(label: string): string | null {
  const cleaned = label.replace(/\s/g, "");
  const entries = [[/^(KEB하나|하나)/, "하나은행"], [/^전북/, "전북은행"], [/^신한/, "신한은행"], [/^우리/, "우리은행"], [/^(KB국민|국민)/, "국민은행"], [/^(IBK기업|기업)/, "기업은행"]] as const;
  return entries.find(([pattern]) => pattern.test(cleaned))?.[1] ?? null;
}
const clean = (value: string) => value.replace(/\s/g, "");
function rawCell(cell:Cell){const v=cell.value;if(v===null||v===undefined)return "";if(v&&typeof v==="object"&&"error" in v)return String(v.error);if(v&&typeof v==="object"&&("formula" in v||"sharedFormula" in v)&&(!("result" in v)||v.result===undefined||v.result===null))return "formula" in v?`=${v.formula}`:`[공유 수식 ${v.sharedFormula}]`;const raw=spreadsheetValue(v);if(raw instanceof Date&&Number.isFinite(raw.getTime()))return raw.toISOString().slice(0,10);return String(raw);}

export function analyzeLegacyLedger(book: Workbook, sheetName: string, today: string): LegacyReview {
  const sheet = book.getWorksheet(sheetName);
  if (!sheet || sheet.rowCount > 10000) throw new Error("선택한 시트의 크기·이름을 확인해 주세요.");
  let header = 0;let layout:"SEPARATE_LOAN"|"SINGLE_INCOME"="SEPARATE_LOAN";
  for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    if (clean(row.getCell(1).text) === "날짜" && clean(row.getCell(2).text) === "구분" && clean(row.getCell(5).text) === "내역" && clean(row.getCell(6).text) === "입금(차입금)" && clean(row.getCell(7).text) === "입금" && clean(row.getCell(8).text) === "출금") { header = r; break; }
    if(clean(row.getCell(1).text)==="날짜"&&clean(row.getCell(2).text)==="구분"&&["","은행"].includes(clean(row.getCell(3).text))&&clean(row.getCell(4).text)==="거래처"&&clean(row.getCell(5).text)==="내역"&&clean(row.getCell(6).text)==="입금"&&clean(row.getCell(7).text)==="출금"&&clean(row.getCell(8).text)==="잔액"){header=r;layout="SINGLE_INCOME";break;}

  }
  if (!header) throw new Error("이 시트는 확인된 기존 장부 형식(날짜·구분·은행·내역·차입입금·입금·출금)과 다릅니다. 연도별 시트 형식을 확인해 주세요.");
  const incomingColumn=layout==="SINGLE_INCOME"?6:7,outgoingColumn=layout==="SINGLE_INCOME"?7:8,balanceColumn=layout==="SINGLE_INCOME"?8:9;
  const review: LegacyReview = { sheetName,layout, rows: [], issues: [], ignored: { opening: 0, summaries: 0, noAmount: 0 }, incoming: "0", outgoing: "0" };
  let incomingTotal = 0n; let outgoingTotal = 0n;
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r); const read = (column: number) => spreadsheetValue(row.getCell(column).value);
    const primaryDescription = String(read(4)).trim(); const secondaryDescription = String(read(5)).trim();
    const description = [...new Set([primaryDescription, secondaryDescription].filter(Boolean))].join(" · "); const bankLabel = String(read(3)).trim(); const legacyCategory = String(read(2)).trim();
    const marker = clean(description); const dateMarker = clean(String(read(1)));
    if (dateMarker === "잔액" || /^(전년이월|전월이월|차월이월|기초잔액|이월잔액)$/.test(marker)) { review.ignored.opening++; continue; }
    if (/^(소계|합계|총계|월계|누계|\d{1,2}월(?:합계|소계|계))$/.test(marker) || /^(소계|합계|총계|월계|누계)$/.test(dateMarker)) { review.ignored.summaries++; continue; }
    try {
      for(const column of[1,3,4,5,...(layout==="SEPARATE_LOAN"?[6]:[]),incomingColumn,outgoingColumn]){const issue=spreadsheetCellIssue(row.getCell(column).value);if(issue)throw new Error(issue);}
      const loan = layout==="SEPARATE_LOAN"?BigInt(spreadsheetMoney(read(6))!):0n; const incoming = BigInt(spreadsheetMoney(read(incomingColumn))!); const outgoing = BigInt(spreadsheetMoney(read(outgoingColumn))!);
      if (loan === 0n && incoming === 0n && outgoing === 0n) { review.ignored.noAmount++; continue; }
      if (loan < 0n || incoming < 0n || outgoing < 0n) throw new Error("음수 금액: 취소·환급·정정 거래의 원내역을 확인해 주세요.");
      if (loan > 0n && incoming > 0n) throw new Error("차입금 입금과 일반 입금이 동시에 있습니다. 같은 금액 중복인지 확인해 주세요.");
      if (loan + incoming > 0n && outgoing > 0n) throw new Error("입금과 출금이 동시에 있습니다. 거래를 나눠 확인해 주세요.");
      if (read(1) === "") throw new Error("거래일이 비어 있습니다. 앞 행의 날짜를 임의로 적용하지 않습니다.");
      const parsed = spreadsheetDate(read(1));
      if (parsed.date < "1900-01-01" || parsed.date > today) throw new Error("거래일이 실제 거래 기간을 벗어납니다. 미래 예정이 섞였는지 확인해 주세요.");
      if (!description) throw new Error("D·E열의 거래내용이 모두 비어 있습니다. 원장 내역을 확인해 주세요.");
      if (description.length > 300) throw new Error("D·E열 거래내용이 300자를 넘습니다. 원장 내역을 확인해 주세요.");
      if (bankLabel === "현금") throw new Error("현금 거래는 은행 계좌 장부로 가져오지 않습니다.");
      if (!bankLabel || bankLabel.length > 100 || !legacyBankName(bankLabel)) throw new Error("은행·계좌 표기를 확인해 주세요. 임의의 은행으로 배정하지 않습니다.");
      let ledgerBalance: string | null = null;
      try { ledgerBalance = spreadsheetMoney(read(balanceColumn), true); } catch { /* 원장 누계 오류는 은행 잔액으로 대체하지 않는다. */ }
      const direction = outgoing > 0n ? "OUT" : "IN";
      const amount = (outgoing > 0n ? outgoing : loan + incoming).toString();
      review.rows.push({ sourceRow: r, date: parsed.date, bankLabel, description, legacyCategory: legacyCategory.slice(0, 100), incomingType: outgoing > 0n ? "NONE" : loan > 0n ? "LOAN" : "GENERAL", direction, amount, ledgerBalance });
      if (direction === "IN") incomingTotal += BigInt(amount); else outgoingTotal += BigInt(amount);
    } catch (error) { review.issues.push({ sourceRow: r, reason: error instanceof Error ? error.message : "행 내용을 확인해 주세요.", description: description.slice(0, 300), bankLabel: bankLabel.slice(0, 100), legacyCategory: legacyCategory.slice(0, 100),rawDate:rawCell(row.getCell(1)),rawLoan:layout==="SEPARATE_LOAN"?rawCell(row.getCell(6)):"",rawIncoming:rawCell(row.getCell(incomingColumn)),rawOutgoing:rawCell(row.getCell(outgoingColumn)) }); }
  }
  review.incoming = incomingTotal.toString(); review.outgoing = outgoingTotal.toString();
  return review;
}

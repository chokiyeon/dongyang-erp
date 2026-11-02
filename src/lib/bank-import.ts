import type { Workbook, CellValue } from "exceljs";
import type { ImportRow } from "./ledger";
const normalize = (value: string) => value.normalize("NFKC").replace(/[\s()（）원:./_\-]/g, "");
const aliases = {
  date: ["거래일자", "거래일시", "거래일", "일자"],
  description: ["적요", "거래내용", "내용", "기재내용", "받는분보낸분", "보낸분받는분"],
  incoming: ["입금", "입금액", "입금금액", "맡기신금액"],
  outgoing: ["출금", "출금액", "출금금액", "찾으신금액"],
  balance: ["거래후잔액", "잔액", "거래잔액"],
  time: ["거래시각", "거래시간", "시간"],
};
function value(cell: CellValue): string | number | Date {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string" || typeof cell === "number" || cell instanceof Date) return cell;
  if (typeof cell === "object" && "result" in cell) return value(cell.result ?? null);
  if (typeof cell === "object" && "richText" in cell) return cell.richText.map((part) => part.text).join("");
  if (typeof cell === "object" && "text" in cell) return String(cell.text);
  return "";
}
export function spreadsheetCellIssue(cell:CellValue):string|null {
  if(typeof cell==="boolean")return "원본 셀에 숫자·날짜 대신 참/거짓 값이 있습니다. 원본을 확인해 주세요.";
  if(cell&&typeof cell==="object"){
    if("error" in cell)return "원본 엑셀 셀에 계산 오류가 있습니다. 원본을 확인해 주세요.";
    if("formula" in cell||"sharedFormula" in cell){
      if(!("result" in cell)||cell.result===undefined||cell.result===null)return "원본 수식 결과가 없습니다. 엑셀에서 재계산 후 저장한 사본으로 다시 검토하세요.";
      return spreadsheetCellIssue(cell.result as CellValue);
    }
  }
  return null;
}
function money(raw: string | number | Date, optional = false): string | null {
  if (raw instanceof Date) throw new Error("금액 셀의 형식을 확인해 주세요.");
  if (typeof raw === "number" && !Number.isSafeInteger(raw)) throw new Error("금액이 소수이거나 정밀도를 확인할 수 없습니다. 원 단위 정수·텍스트로 확인해 주세요.");
  const result = String(raw).replace(/[,\s₩원]/g, "");
  if (!result || result === "-") return optional ? null : "0";
  if (!/^-?\d{1,20}$/.test(result)) throw new Error("금액 셀의 형식을 확인해 주세요.");
  return BigInt(result).toString();
}
function day(raw: string | number | Date) {
  if (typeof raw === "number") raw = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
  if (raw instanceof Date) return { date: raw.toISOString().slice(0, 10), time: raw.toISOString().slice(11, 19) === "00:00:00" ? "" : raw.toISOString().slice(11, 19) };
  const match = raw.trim().match(/^(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})(?:[ T]+(\d{2}:\d{2}(?::\d{2})?))?\s*$/);
  if (!match) throw new Error("거래일은 YYYY-MM-DD 형식이어야 합니다.");
  const result = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${result}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new Error("유효하지 않은 거래일입니다.");
  return { date: result, time: match[4] ?? "" };
}
export function parseBankWorkbook(workbook: Workbook): ImportRow[] {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("첫 시트에 거래내역이 없습니다.");
  if (sheet.rowCount > 10000) throw new Error("시트가 너무 큽니다. 거래내역만 별도 파일로 저장해 주세요.");
  const columns: Partial<Record<keyof typeof aliases, number>> = {};
  let headerRow = 0;
  for (let index = 1; index <= Math.min(sheet.rowCount, 30); index++) {
    const found: typeof columns = {};
    const row = sheet.getRow(index);
    for (let column = 1; column <= Math.min(sheet.columnCount, 50); column++) {
      const label = normalize(String(value(row.getCell(column).value)));
      for (const [key, names] of Object.entries(aliases)) if (names.map(normalize).includes(label) && !found[key as keyof typeof aliases]) found[key as keyof typeof aliases] = column;
    }
    if (found.date && found.description && found.incoming && found.outgoing) { Object.assign(columns, found); headerRow = index; break; }
  }
  if (!headerRow) throw new Error("거래일자·적요·입금액·출금액 열을 찾지 못했습니다. 공통 양식에 맞춰 저장해 주세요. 은행별 실제 양식은 샘플 확인 후 보완합니다.");
  const rows: ImportRow[] = [];
  for (let index = headerRow + 1; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    const read = (key: keyof typeof aliases) => columns[key] ? value(row.getCell(columns[key]!).value) : "";
    if (/^(합계|총계)$/.test(String(read("date")).trim())) continue;
    try {
      for(const column of Object.values(columns)){const issue=spreadsheetCellIssue(row.getCell(column!).value);if(issue)throw new Error(issue);}
      if ([read("date"),read("incoming"),read("outgoing"),read("description")].every(v=>v===""))continue;
      const incoming = BigInt(money(read("incoming"))!);
      const outgoing = BigInt(money(read("outgoing"))!);
      if (incoming === 0n && outgoing === 0n) continue;
      if (incoming < 0n || outgoing < 0n || incoming > 0n && outgoing > 0n) throw new Error("입금·출금 중 한쪽에만 양수 금액이 있어야 합니다.");
      const parsed = day(read("date"));
      const description = String(read("description")).trim();
      if (!description || description.length > 300) throw new Error("적요는 1~300자여야 합니다.");
      rows.push({ sourceRow: index, date: parsed.date, time: String(read("time") || parsed.time).trim(), description, direction: incoming > 0n ? "IN" : "OUT", amount: (incoming > 0n ? incoming : outgoing).toString(), balance: money(read("balance"), true) });
      if (rows.length > 1000) throw new Error("한 파일에서 최대 1,000건까지 가져올 수 있습니다.");
    } catch (error) { throw new Error(`${index}행: ${error instanceof Error ? error.message : "자료를 확인해 주세요."}`); }
  }
  if (!rows.length) throw new Error("가져올 입출금 거래가 없습니다.");
  return rows;
}

export { value as spreadsheetValue, money as spreadsheetMoney, day as spreadsheetDate };

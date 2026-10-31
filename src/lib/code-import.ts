import type { Workbook, Cell } from "exceljs";
import type { CodeInput } from "./accounting-codes";
function content(cell: Cell, isCode = false) {
  const value = cell.value;
  if (typeof value === "number" && isCode) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("회계코드는 텍스트 또는 안전한 정수로 저장해 주세요.");
    const raw = String(value);
    return /^0{1,30}$/.test(cell.numFmt) ? raw.padStart(cell.numFmt.length, "0") : raw;
  }
  if (value instanceof Date) throw new Error("날짜로 변환된 코드 셀을 텍스트로 확인해 주세요.");
  return cell.text.trim();
}
export function parseAccountingWorkbook(book: Workbook): CodeInput[] {
  const sheet = book.worksheets[0]; if (!sheet || sheet.rowCount > 10000) throw new Error("첫 시트에 코드 자료만 저장해 주세요.");
  const aliases = { code: ["코드", "회계코드", "계정코드", "계정과목코드"], name: ["계정명", "계정과목", "계정과목명", "과목명"], group: ["분류", "구분", "계정구분"], note: ["비고", "설명"] };
  let header = 0; let columns: Record<string, number> = {};
  for (let r = 1; r <= Math.min(sheet.rowCount, 30); r++) {
    const found: Record<string, number> = {};
    for (let c = 1; c <= Math.min(sheet.columnCount, 50); c++) {
      const label = sheet.getRow(r).getCell(c).text.replace(/\s/g, "");
      for (const [key, names] of Object.entries(aliases)) if (names.includes(label)) found[key] = c;
    }
    if (found.code && found.name) { header = r; columns = found; break; }
  }
  if (!header) throw new Error("코드와 계정과목명 열이 필요합니다. 코드표의 열 제목을 확인해 주세요.");
  const rows: CodeInput[] = [];
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r); const code = content(row.getCell(columns.code), true); const name = content(row.getCell(columns.name));
    if (!code && !name) continue;
    if (!code || !name) throw new Error(`${r}행: 코드와 계정과목명을 모두 입력해 주세요.`);
    rows.push({ code, name, group: columns.group ? content(row.getCell(columns.group)) : "", note: columns.note ? content(row.getCell(columns.note)) : "" });
    if (rows.length > 1000) throw new Error("한 번에 최대 1,000개 코드를 가져올 수 있습니다.");
  }
  if (!rows.length) throw new Error("코드 자료가 없습니다.");
  return rows;
}

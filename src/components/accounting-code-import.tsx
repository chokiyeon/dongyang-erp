"use client";
import { useHydrated } from "@/lib/use-hydrated";
import { useState } from "react";
import type { CodeInput } from "@/lib/accounting-codes";
import { parseAccountingWorkbook } from "@/lib/code-import";
import { RecordForm } from "./record-form";
import { importCodesAction } from "@/app/(workspace)/accounting-codes/actions";
export function AccountingCodeImport() {
  const hydrated = useHydrated();
  const [rows, setRows] = useState<CodeInput[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function load(file?: File) {
    setRows([]); setError(""); if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) { setError("5MB 이하 .xlsx 코드표를 선택해 주세요."); return; }
    setBusy(true);
    try { const { Workbook } = await import("exceljs"); const book = new Workbook(); await book.xlsx.load(await file.arrayBuffer()); setRows(parseAccountingWorkbook(book)); }
    catch (e) { setError(e instanceof Error ? e.message : "코드표를 읽지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3"><p className="text-xs leading-5 text-slate-500">추가로 사용할 코드·계정과목명 열이 있는 엑셀을 선택합니다. 첫 시트, 최대 1,000건입니다. 기존 코드의 계정명이 다르면 덮어쓰지 않고 확인을 요청합니다.</p><label className="erp-field">회계사무소 코드표<input type="file" accept=".xlsx" disabled={busy || !hydrated} onChange={(e) => load(e.target.files?.[0])} /></label>{busy && <p role="status">코드표를 읽는 중입니다.</p>}{error && <p role="alert" className="text-xs text-red-700">{error}</p>}{rows.length > 0 && <><p className="text-xs">확인할 코드 {rows.length}개 · 미리보기 10개</p><div className="overflow-x-auto"><table><thead><tr><th>코드</th><th>계정과목명</th><th>분류</th></tr></thead><tbody>{rows.slice(0, 10).map((r, i) => <tr key={i}><td>{r.code}</td><td>{r.name}</td><td>{r.group}</td></tr>)}</tbody></table></div><RecordForm action={importCodesAction} label="확인 후 코드 저장"><input type="hidden" name="rows" value={JSON.stringify(rows)} /></RecordForm></>}</div>;
}

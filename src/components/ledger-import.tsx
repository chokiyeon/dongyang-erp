"use client";
import { useHydrated } from "@/lib/use-hydrated";
import { useState } from "react";
import type { ImportRow } from "@/lib/ledger";
import { parseBankWorkbook } from "@/lib/bank-import";
import { RecordForm } from "./record-form";
import { Select } from "./fields";
import { importTransactionsAction } from "@/app/(workspace)/ledger/actions";
export function LedgerImport({ accounts }: { accounts: { id: string; label: string; bankName: string }[] }) {
  const hydrated = useHydrated();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileHash, setFileHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function read(file: File | undefined) {
    setRows([]); setFileHash(""); setError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) { setError("5MB 이하의 .xlsx 파일을 선택해 주세요. .xls는 Excel에서 .xlsx로 다시 저장해 주세요."); return; }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook(); await workbook.xlsx.load(bytes);
      const parsed = parseBankWorkbook(workbook);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      setFileHash(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""));
      setRows(parsed);
    } catch (e) { setError(e instanceof Error ? e.message : "엑셀 파일을 읽지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function template() {
    const { Workbook } = await import("exceljs"); const workbook = new Workbook();
    const sheet = workbook.addWorksheet("입출금내역");
    sheet.addRow(["거래일자", "적요", "입금액", "출금액", "거래후잔액", "거래시각"]);
    sheet.columns.forEach((column) => { column.width = 22; });
    const data = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const link = document.createElement("a"); link.href = url; link.download = "은행_입출금_공통양식.xlsx"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return <div className="space-y-3"><p className="text-xs leading-5 text-slate-500">한 번에 한 계좌의 .xlsx 파일을 선택하고 내용을 확인한 뒤 가져옵니다. 같은 파일·계좌 재등록은 건너뜁니다. 은행별 실제 파일의 열 이름이 다르면 공통 양식을 사용해 주세요.</p><button className="erp-button" onClick={template}>공통 양식 다운로드</button><label className="erp-field">은행 거래내역 엑셀<input type="file" accept=".xlsx" disabled={busy || !hydrated} onChange={(event) => read(event.target.files?.[0])} /></label>
    {busy && <p role="status">엑셀을 읽는 중입니다.</p>}{error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {rows.length > 0 && <><p className="text-xs">가져오기 예정 <strong>{rows.length}건</strong> · 미리보기 10건</p><div className="overflow-x-auto"><table><thead><tr><th>거래일</th><th>내용</th><th>구분</th><th>금액</th></tr></thead><tbody>{rows.slice(0, 10).map((row) => <tr key={row.sourceRow}><td>{row.date}</td><td>{row.description}</td><td>{row.direction === "IN" ? "입금" : "출금"}</td><td>{BigInt(row.amount).toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div><RecordForm action={importTransactionsAction} label="확인 후 장부에 가져오기"><input type="hidden" name="rows" value={JSON.stringify(rows)} /><input type="hidden" name="fileHash" value={fileHash} /><Select name="accountId" label="가져올 계좌" required><option value="">계좌 선택</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} · {a.label}</option>)}</Select><label className="text-xs leading-5"><input type="checkbox" name="allowSuspected" className="mr-1" />중복 의심 내역도 추가 — 기존과 같은 날짜·금액·적요라도 서로 다른 실제 거래임을 확인한 경우만 선택</label></RecordForm></>}
  </div>;
}

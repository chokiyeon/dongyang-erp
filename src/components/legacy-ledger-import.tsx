"use client";
import { useHydrated } from "@/lib/use-hydrated";
import { useRef, useState } from "react";
import type { Workbook } from "exceljs";
import { analyzeLegacyLedger, legacyBankName, type LegacyReview } from "@/lib/legacy-ledger";
import { RecordForm } from "./record-form";
import { Select } from "./fields";
import { importLegacyAction } from "@/app/(workspace)/ledger/import/actions";
const PAGE_SIZE = 250;
type Account = { id: string; label: string; bankName: string };
export function LegacyLedgerImport({ accounts }: { accounts: Account[] }) {
  const hydrated = useHydrated();
  const workbook = useRef<Workbook | null>(null);
  const [sheets, setSheets] = useState<string[]>([]); const [sheet, setSheet] = useState("");
  const [review, setReview] = useState<LegacyReview | null>(null); const [fileHash, setFileHash] = useState("");
  const [exporting,setExporting]=useState(false);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [page, setPage] = useState(1);
  const [mapping, setMapping] = useState<Record<string, string>>({}); const [overrides, setOverrides] = useState<Record<number, string>>({}); const [selected, setSelected] = useState<number[]>([]);
  function analyze(name: string) {
    setSheet(name); setSelected([]); setMapping({}); setOverrides({}); setPage(1); setReview(null); setError("");
    if (!workbook.current) return;
    try { setReview(analyzeLegacyLedger(workbook.current, name, new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()))); }
    catch (e) { setError(e instanceof Error ? e.message : "시트 내용을 확인해 주세요."); }
  }
  async function load(file?: File) {
    setReview(null); setSheets([]); setSheet(""); setSelected([]); setFileHash(""); setError(""); workbook.current = null;
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) { setError("5MB 이하 .xlsx 장부를 선택해 주세요."); return; }
    setBusy(true);
    try {
      const bytes = await file.arrayBuffer(); const { Workbook } = await import("exceljs"); const book = new Workbook(); await book.xlsx.load(bytes);
      workbook.current = book; setSheets(book.worksheets.map((s) => s.name));
      const digest = await crypto.subtle.digest("SHA-256", bytes); setFileHash(Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""));
      const years = book.worksheets.map((s) => s.name).filter((name) => /^\d{4}$/.test(name) && Number(name) <= Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()))).sort().reverse();
      analyze(years[0] ?? book.worksheets[0]?.name ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "장부를 읽지 못했습니다."); }
    finally { setBusy(false); }
  }
  const bankLabels = [...new Set(review?.rows.map((row) => row.bankLabel) ?? [])].sort();
  const pageCount = Math.max(1, Math.ceil((review?.rows.length ?? 0) / PAGE_SIZE));
  const visible = review?.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? [];
  const selectedRows = review?.rows.filter((row) => selected.includes(row.sourceRow)).map((row) => ({ ...row, accountId: overrides[row.sourceRow] ?? mapping[row.bankLabel] ?? "" })) ?? [];
  const missing = selectedRows.filter((row) => !row.accountId).length;
  async function exportReview(){
    if(!review||exporting)return;setExporting(true);setError("");
    try{const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());const {buildLegacyReviewWorkbook,legacyReviewFileName}=await import("@/lib/legacy-review-export");const book=await buildLegacyReviewWorkbook(review,fileHash,today);const bytes=await book.xlsx.writeBuffer();const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));const a=document.createElement("a");a.href=url;a.download=legacyReviewFileName(review.sheetName,today);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setError("검토 결과를 엑셀로 저장하지 못했습니다. 다시 시도하세요.");}finally{setExporting(false);}
  }
  function navigate(next: number) { setPage(next); setSelected([]); }
  return <div className="space-y-4">
    <div className="erp-query-bar"><label className="erp-field">기존 장부 파일<input type="file" accept=".xlsx" disabled={busy || !hydrated} onChange={(event) => load(event.target.files?.[0])} /></label>{sheets.length > 0 && <Select label="가져올 시트" value={sheet} disabled={busy} onChange={(event) => analyze(event.target.value)}>{sheets.map((name) => <option key={name}>{name}</option>)}</Select>}</div>
    {busy && <p role="status" className="text-sm">장부 시트를 읽고 확인할 행을 분리하는 중입니다.</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {review && <>
      <div data-erp-report-exclude><button type="button" className="erp-button" disabled={exporting||busy} onClick={exportReview}>{exporting?"검토표 저장 중…":"검토 결과 엑셀 저장"}</button><p className="text-xs text-slate-500">확인 필요 행과 후보 전체를 원본 행 번호·파일 식별값과 함께 저장합니다. 후보 페이지 선택·실제 장부 저장에는 영향을 주지 않습니다.</p></div>
      <div className="erp-summary"><div className="erp-summary-item"><p>가져오기 후보</p><strong className="erp-summary-value">{review.rows.length}<small>건</small></strong></div><div className="erp-summary-item"><p>별도 확인 필요</p><strong className="erp-summary-value">{review.issues.length}<small>건</small></strong></div><div className="erp-summary-item"><p>이월·합계 제외</p><strong className="erp-summary-value">{review.ignored.opening + review.ignored.summaries}<small>건</small></strong></div><div className="erp-summary-item"><p>선택한 후보</p><strong className="erp-summary-value">{selectedRows.length}<small>건</small></strong></div></div>
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">원장의 잔액은 통장별 잔액으로 적용하지 않습니다. 이전 구분은 참고 정보로 보관하고 새 회계코드는 미분류로 가져옵니다. 날짜를 앞 행에서 임의로 채우거나 입출금 동시 행을 자동 분리하지 않습니다.</p>
      <h2 className="text-sm font-bold">1. 원장 은행 표기를 실제 계좌에 연결</h2>
      <p className="text-xs text-slate-500">같은 은행의 계좌가 여러 개면 원장을 대조해 선택하세요. 행별로 다른 계좌를 지정할 수도 있습니다. 은행 이름만으로 계좌를 자동 확정하지 않습니다.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{bankLabels.map((label) => <Select key={label} label={`원장 ${label} 연결 계좌`} value={mapping[label] ?? ""} onChange={(event) => setMapping({ ...mapping, [label]: event.target.value })}><option value="">확인 후 선택</option>{accounts.filter((a) => a.bankName === legacyBankName(label)).map((a) => <option key={a.id} value={a.id}>{a.bankName} · {a.label}</option>)}</Select>)}</div>
      <h2 className="text-sm font-bold">2. 가져올 행 선택 · {page}/{pageCount} 페이지</h2>
      <div className="flex flex-wrap items-center gap-2"><button className="erp-button" onClick={() => setSelected(visible.map((row) => row.sourceRow))}>현재 페이지 전체 선택</button><button className="erp-button" onClick={() => setSelected([])}>선택 해제</button><span className="text-xs text-slate-500">한 페이지 {PAGE_SIZE}건 · 실제 가져올 행만 선택</span></div>
      <div className="erp-ledger-scroll overflow-x-auto"><table className="whitespace-nowrap"><thead><tr><th>선택</th><th>원본 행</th><th>거래일</th><th>원장 은행</th><th>연결 계좌</th><th>거래내용</th><th>입출금</th><th>금액</th><th>이전 구분 (참고)</th></tr></thead><tbody>{visible.map((row) => <tr key={row.sourceRow}><td><input type="checkbox" aria-label={`${row.sourceRow}행 가져오기`} checked={selected.includes(row.sourceRow)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.sourceRow] : selected.filter((n) => n !== row.sourceRow))} /></td><td>{row.sourceRow}</td><td>{row.date}</td><td>{row.bankLabel}</td><td><select className="erp-input" aria-label={`${row.sourceRow}행 연결 계좌`} value={overrides[row.sourceRow] ?? mapping[row.bankLabel] ?? ""} onChange={(event) => setOverrides({ ...overrides, [row.sourceRow]: event.target.value })}><option value="">미지정</option>{accounts.filter((a) => a.bankName === legacyBankName(row.bankLabel)).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td><td>{row.description}</td><td>{row.direction === "OUT" ? "출금" : row.incomingType === "LOAN" ? "차입 입금" : "입금"}</td><td className="erp-numeric">{BigInt(row.amount).toLocaleString("ko-KR")}원</td><td>{row.legacyCategory || "미기재"}</td></tr>)}{!visible.length && <tr><td colSpan={9} className="erp-empty">확인 없이 가져올 수 있는 후보가 없습니다. 아래 확인 필요 행을 검토해 주세요.</td></tr>}</tbody></table></div>
      <div className="flex gap-2"><button className="erp-button" disabled={page <= 1} onClick={() => navigate(page - 1)}>이전 후보</button><button className="erp-button" disabled={page >= pageCount} onClick={() => navigate(page + 1)}>다음 후보</button></div>
      {selectedRows.length > 0 && <div className="rounded border border-blue-200 bg-blue-50 p-3"><p className="mb-3 text-xs">선택 {selectedRows.length}건 · 연결 계좌 미지정 {missing}건</p>{missing ? <p role="status" className="text-xs text-red-700">선택한 모든 행의 계좌를 연결해야 가져올 수 있습니다.</p> : <RecordForm action={importLegacyAction} label="선택한 행을 미분류로 가져오기"><input type="hidden" name="rows" value={JSON.stringify(selectedRows)} /><input type="hidden" name="fileHash" value={fileHash} /><input type="hidden" name="sheet" value={sheet} /><label className="text-xs leading-6"><input type="checkbox" name="allowSuspected" className="mr-1" />기존 거래와 중복이 의심돼도 서로 다른 실제 거래임을 확인한 경우 추가</label></RecordForm>}</div>}
      <h2 className="text-sm font-bold">3. 확인 필요 행 — 가져오기에서 제외됨</h2>
      <div className="max-h-80 overflow-x-auto"><table><thead><tr><th>원본 행</th><th>원본 날짜</th><th>은행 표기</th><th>차입 입금</th><th>입금</th><th>출금</th><th>내용</th><th>확인 사유</th></tr></thead><tbody>{review.issues.map((row) => <tr key={row.sourceRow}><td>{row.sourceRow}</td><td>{row.rawDate??""}</td><td>{row.bankLabel || "미기재"}</td><td>{row.rawLoan??""}</td><td>{row.rawIncoming??""}</td><td>{row.rawOutgoing??""}</td><td>{row.description}</td><td>{row.reason}</td></tr>)}{!review.issues.length && <tr><td colSpan={8} className="erp-empty">추가 확인 대상이 없습니다.</td></tr>}</tbody></table></div>
      <p className="text-[11px] text-slate-500">금액 없는 행 {review.ignored.noAmount}개는 거래로 가져오지 않습니다. 제외·확인 필요 행은 원본에서 확인한 뒤 수정본으로 다시 검토할 수 있습니다.</p>
    </>}
  </div>;
}

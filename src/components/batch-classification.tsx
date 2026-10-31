"use client";
import { useState } from "react";
import { RecordForm } from "./record-form";
import { Field } from "./fields";
import { TransactionClassification } from "./transaction-classification";
import { applyBatchAction } from "@/app/(workspace)/ledger/classify/actions";
export type BatchRow = { id: string; version: number; date: string; account: string; description: string; amount: string; legacyCategory: string };
export function BatchClassification({ rows, codes, requestId, direction }: { rows: BatchRow[]; codes: { id: string; code: string; name: string }[]; requestId: string; direction: "IN" | "OUT" }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const chosen = rows.filter((r) => selected.includes(r.id));
  function choose(ids: string[]) { setSelected(ids); setConfirmed(false); }
  return <><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th><input aria-label="조회된 거래 전체 선택" type="checkbox" checked={rows.length > 0 && selected.length === rows.length} onChange={(e) => choose(e.target.checked ? rows.map((r) => r.id) : [])} /></th><th>날짜</th><th>은행 · 계좌</th><th>거래 내용</th><th>이전 분류 (참고)</th><th>금액</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><input aria-label={`${r.description} 선택`} type="checkbox" checked={selected.includes(r.id)} onChange={(e) => choose(e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id))} /></td><td>{r.date}</td><td>{r.account}</td><td>{r.description}</td><td>{r.legacyCategory || "—"}</td><td>{BigInt(r.amount).toLocaleString()}원</td></tr>)}</tbody></table></div>
  {!rows.length && <p>조회된 미분류 거래가 없습니다.</p>}
  {chosen.length > 0 && <RecordForm action={applyBatchAction} label="선택 거래에 분류 적용"><input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="rows" value={JSON.stringify(chosen.map((r) => ({ id: r.id, version: r.version })))} /><p className="font-semibold">선택 {chosen.length}건 · {direction === "OUT" ? "출금" : "입금"} 합계 {chosen.reduce((sum, r) => sum + BigInt(r.amount), 0n).toLocaleString()}원</p><div onChange={() => setConfirmed(false)}><TransactionClassification codes={codes} initialDirection={direction} /></div><Field label="분류 사유" name="reason" required maxLength={300} /><label className="flex items-center gap-2"><input type="checkbox" name="confirmed" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />선택 거래가 모두 같은 용도이며 위 계정 적용이 맞는지 확인했습니다.</label><p className="text-xs text-slate-500">거래일·금액·은행 잔액은 바뀌지 않습니다. 분류 변경 이력이 남습니다.</p></RecordForm>}</>;
}

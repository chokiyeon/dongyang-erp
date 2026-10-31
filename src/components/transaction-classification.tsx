"use client";
import { useEffect, useRef, useState } from "react";
import { Select } from "./fields";
import { activityDirection, getTransactionActivity, TRANSACTION_ACTIVITIES } from "@/lib/transaction-activities";
export function TransactionClassification({ codes, initialBusinessType = "", initialCodeId = "", initialDirection = "OUT" }: { codes: { id: string; code: string; name: string }[]; initialBusinessType?: string; initialCodeId?: string; initialDirection?: "IN" | "OUT" }) {
  const [activityKey, setActivityKey] = useState(initialBusinessType);
  const [codeId, setCodeId] = useState(initialCodeId);
  const [direction, setDirection] = useState(initialDirection);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = root.current?.closest("form");
    function changed(event: Event) {
      const target = event.target;
      if (target instanceof HTMLSelectElement && target.name === "direction" && (target.value === "IN" || target.value === "OUT")) {
        setDirection(target.value);
        if (activityKey) { setActivityKey(""); setCodeId(""); }
      }
    }
    form?.addEventListener("change", changed);
    return () => form?.removeEventListener("change", changed);
  }, [activityKey]);
  const activity = getTransactionActivity(activityKey);
  const selected = codes.find((c) => c.id === codeId);
  return <div ref={root} className="space-y-3 rounded border border-blue-100 bg-blue-50/40 p-3">
    <Select label="무엇을 지급·수금했나요?" name="businessType" value={activityKey} onChange={(event) => {
      const key = event.target.value; const option = getTransactionActivity(key); setActivityKey(key); setCodeId(option?.code ? codes.find((c) => c.code === option.code)?.id ?? "" : "");
    }}><option value="">거래 종류 선택 — 모르겠으면 미분류로 저장</option>{TRANSACTION_ACTIVITIES.map((a) => <option key={a.key} value={a.key} disabled={(activityDirection(a.key) !== null && activityDirection(a.key) !== direction) || (a.code !== null && !codes.some((c) => c.code === a.code))}>{a.label}</option>)}</Select>
    <p className="text-xs font-semibold text-blue-900">적용 계정: {selected ? `${selected.name} (${selected.code})` : "미분류 · 확인 필요"}</p>
    {activity && <p role="note" className="text-xs leading-6 text-slate-600">{activity.hint}</p>}
    <details><summary className="cursor-pointer text-[11px] text-slate-500">계정과목 직접 지정 (선택)</summary><div className="mt-2"><Select label="거래 회계코드" name="accountingCodeId" value={codeId} onChange={(event) => { setActivityKey(""); setCodeId(event.target.value); }}><option value="">미분류</option>{codes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</Select></div></details>
    <p className="text-[10px] leading-5 text-slate-500">통장 적요만으로 자동 확정하지 않습니다. 미분류 거래도 저장할 수 있으며 선택 계정은 거래 분류용입니다.</p>
  </div>;
}

"use client";
import {useState} from "react";
export function TradePlanMergeSelection({plans,gross}:{plans:{id:string;title:string;date:string;amount:string;actual:string}[];gross:string}){
 const[ids,setIds]=useState<string[]>([]);const sum=plans.filter(p=>ids.includes(p.id)).reduce((total,p)=>total+BigInt(p.amount),0n),difference=BigInt(gross)-sum;const money=(n:bigint)=>`${n.toLocaleString("ko-KR")}원`;
 return <div className="col-span-full"><p className="mb-3 font-semibold">청구 {money(BigInt(gross))} · 선택 {money(sum)} · 차이 {money(difference)}</p><div className="max-h-80 overflow-auto rounded border p-3">{plans.map(p=><label key={p.id} className="mb-2 flex items-center gap-2"><input type="checkbox" name="mergePlanId" value={p.id} checked={ids.includes(p.id)} disabled={!ids.includes(p.id)&&ids.length>=30} onChange={event=>setIds(old=>event.target.checked?[...old,p.id]:old.filter(id=>id!==p.id))}/><span>{p.date} · {p.title} · 예정 {money(BigInt(p.amount))} / 실제 {money(BigInt(p.actual))}</span></label>)}</div><p className="mt-2 text-xs">2개 이상 선택하고 합계가 청구금액과 같은지 확인하세요. 기존 일정은 이력으로 종료하고 은행 실적은 금액·일자·요청 ID를 보존해 청구 예정에 연결합니다.</p></div>;
}

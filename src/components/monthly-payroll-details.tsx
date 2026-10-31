"use client";
import {useState} from "react";
import {MONTHLY_PAY_FIELDS,calculateMonthlyPay,type MonthlyPayDetails} from "@/lib/monthly-payroll-details";
import {Field} from "./fields";
export function MonthlyPayrollDetails({initial}:{initial:MonthlyPayDetails|null}){
 const[enabled,setEnabled]=useState(Boolean(initial));const[values,setValues]=useState<Record<string,string>>(initial?.amounts??{});
 let result;let error="";if(enabled)try{result=calculateMonthlyPay(values);}catch(e){error=e instanceof Error?e.message:"금액을 확인하세요.";}
 return <div className="rounded border border-slate-300 p-3"><label className="flex gap-2 font-semibold"><input type="checkbox" name="useMonthlyDetails" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>상용직 수당·공제 세부 내역으로 계산</label>{enabled&&<><p className="my-3 text-xs leading-6">확인한 원 단위 금액을 입력하세요. 해당 없는 항목은 0으로 입력합니다. 세금·보험료를 요율로 자동 계산하지 않습니다. 아래 계산된 실수령액을 최종 실지급액에 입력해 대조합니다.</p><div className="grid gap-3 md:grid-cols-2">{MONTHLY_PAY_FIELDS.map(([key,label])=><Field key={key} name={`monthly_${key}`} label={label} required inputMode="text" maxLength={key==="adjustment"?21:20} value={values[key]??""} onChange={e=>setValues({...values,[key]:e.target.value})}/>)}</div>{result?<p role="note" className="mt-3 rounded bg-blue-50 p-3 leading-7">지급항목 합계 {result.earnings.toLocaleString()}원 − 근태공제 {result.attendance.toLocaleString()}원 = 지급총액 {result.gross.toLocaleString()}원<br/>공제합계 {result.deductions.toLocaleString()}원 · 연말정산 조정 {result.adjustment.toLocaleString()}원<br/><strong>계산 실수령액 {result.net.toLocaleString()}원</strong></p>:<p className="mt-3 text-xs text-amber-800">{error}</p>}</>}</div>;
}

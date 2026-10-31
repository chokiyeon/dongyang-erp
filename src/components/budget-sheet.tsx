import Link from "next/link";
import { Fragment } from "react";
import type { BudgetEntry, BudgetDay } from "@/lib/budget-sheet";
import { won } from "@/lib/cash";

function Entry({ entry }: { entry?: BudgetEntry }) {
  return <><td className="budget-date">{entry?.date.slice(5) ?? "—"}</td><td>{entry?.category ?? ""}</td><td className="budget-detail">{entry && <><Link href={`/cash?process=${entry.planId}`} className="underline decoration-slate-300 underline-offset-4">{entry.title}</Link><span className={`budget-state ${entry.state === "실제" ? "budget-actual" : ""}`}>{entry.state}</span>{entry.state !== "실제" && entry.originalDate < entry.date && <small className="block text-amber-800">기한 경과 · 원예정 {entry.originalDate}</small>}</>}</td><td className="budget-money">{entry ? won(entry.amount) : ""}</td></>;
}
export function BudgetSheet({ days, openingBalance }: { days: BudgetDay[]; openingBalance: bigint }) {
  return <div className="budget-sheet-scroll"><table className="budget-sheet" data-erp-report-title="예산안 입금·지출 대조표"><colgroup><col className="budget-date-col"/><col className="budget-category-col"/><col/><col className="budget-money-col"/><col className="budget-date-col"/><col className="budget-category-col"/><col/><col className="budget-money-col"/><col className="budget-balance-col"/></colgroup>
    <thead><tr><th>입금일</th><th>입금 항목</th><th>입금 거래처·내용</th><th>입금 금액</th><th>지출일</th><th>지출 항목</th><th>지출 거래처·내용</th><th>지출 금액</th><th>일말 잔액</th></tr></thead>
    <tbody><tr className="budget-opening"><td>기준일</td><td>기준 가용현금</td><td>확인한 통장 순잔액 · 보유어음 제외</td><td className="budget-money">{won(openingBalance)}</td><td/><td/><td/><td/><td className="budget-money">{won(openingBalance)}</td></tr>
      {days.map((day, dayIndex) => { const previousMonth = days[dayIndex - 1]?.date.slice(0, 7); const month = day.date.slice(0, 7); const count = Math.max(1, day.incoming.length, day.outgoing.length); const monthEnd = days[dayIndex + 1]?.date.slice(0, 7) !== month;
        return <Fragment key={day.date}>{previousMonth !== month && <tr className="budget-month"><td>{month}</td><td>입금 예정·실제</td><td/><td/><td/><td>지출 예정·실제</td><td/><td/><td>확정입금 기준</td></tr>}{Array.from({ length: count }, (_, index) => <tr key={`${day.date}:${index}`}><Entry entry={day.incoming[index]}/><Entry entry={day.outgoing[index]}/><td className={`budget-money budget-balance ${day.confirmedBalance < 0n ? "budget-negative" : ""}`}>{index === count - 1 ? <>{won(day.confirmedBalance)}<small className="block font-normal text-slate-500">{day.date.slice(5)} 일말</small></> : ""}</td></tr>)}{monthEnd && <tr className="budget-month-total"><td>{month}</td><td>월말 잔액</td><td>예상입금 포함</td><td className={`budget-money ${day.allBalance < 0n ? "budget-negative" : ""}`}>{won(day.allBalance)}</td><td/><td/><td>확정입금 기준</td><td/><td className={`budget-money ${day.confirmedBalance < 0n ? "budget-negative" : ""}`}>{won(day.confirmedBalance)}</td></tr>}</Fragment>;
      })}
    </tbody></table></div>;
}

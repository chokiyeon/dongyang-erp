import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForecast } from "../src/lib/forecast";
import { buildBudgetSheet } from "../src/lib/budget-sheet";
const money = (n: string) => ({ toFixed: () => n });
const date = (d: string) => new Date(`${d}T00:00:00Z`);
test("원본형 좌우 예산표는 부분 지급·취소·완료·기준일 이전 실적을 잔액 전망과 동일하게 반영한다", () => {
  const plans = [
    { id: "expense", title: "자재대금", category: "자재비", direction: "OUT" as const, certainty: "CONFIRMED" as const, plannedDate: date("2026-10-31"), plannedAmount: money("1000"), completedAt: null, settlements: [{ id: "old", amount: money("100"), processedDate: date("2026-09-30") }, { id: "paid", amount: money("400"), processedDate: date("2026-10-20") }, { id: "void", amount: money("200"), processedDate: date("2026-10-21"), voidedAt: date("2026-10-22") }] },
    { id: "receipt", title: "준공 잔금", category: "공사대금", direction: "IN" as const, certainty: "ESTIMATED" as const, plannedDate: date("2026-10-31"), plannedAmount: money("2000"), completedAt: null, settlements: [] },
    { id: "overdue", title: "공과금", category: "공과금", direction: "OUT" as const, certainty: "CONFIRMED" as const, plannedDate: date("2026-09-20"), plannedAmount: money("50"), completedAt: null, settlements: [] },
    { id: "final", title: "정산 완료", category: "기타", direction: "OUT" as const, certainty: "CONFIRMED" as const, plannedDate: date("2026-11-30"), plannedAmount: money("300"), completedAt: date("2026-11-25"), settlements: [{ id: "final-paid", amount: money("250"), processedDate: date("2026-11-25") }] },
  ];
  const forecast = buildForecast({ baseDate: date("2026-09-30"), amount: money("1000") }, plans, 3);
  const days = buildBudgetSheet(plans, forecast);
  const entries = days.flatMap(d => [...d.incoming, ...d.outgoing]);
  assert.equal(entries.find(e => e.id === "remaining:expense")?.amount, 500n);
  assert.equal(entries.find(e => e.id === "remaining:overdue")?.date, "2026-10-01");
  assert.equal(entries.find(e => e.id === "remaining:overdue")?.originalDate, "2026-09-20");
  assert.equal(entries.some(e => ["old", "void", "remaining:final"].includes(e.id)), false);
  for (const day of days) {
    const source = forecast.rows.find(r => r.date === day.date)!;
    assert.equal(day.incoming.reduce((s,e) => s+e.amount, 0n), source.actualIn+source.expectedIn);
    assert.equal(day.outgoing.reduce((s,e) => s+e.amount, 0n), source.actualOut+source.expectedOut);
    assert.equal(day.confirmedBalance, source.confirmedBalance);
  }
  assert.equal(days.at(-1)?.date, "2026-12-31");
});

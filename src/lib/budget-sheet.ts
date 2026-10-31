import { cashSummary } from "./cash";

type Money = { toFixed: (n: number) => string };
type Plan = { id: string; title: string; category: string; direction: "IN" | "OUT"; certainty: "CONFIRMED" | "ESTIMATED"; plannedDate: Date; plannedAmount: Money; completedAt: Date | null; settlements: { id: string; amount: Money; processedDate: Date; voidedAt?: Date | null }[] };
export type BudgetEntry = { id: string; planId: string; title: string; category: string; date: string; originalDate: string; state: "실제" | "확정 예정" | "예상 예정"; amount: bigint };
export type BudgetDay = { date: string; incoming: BudgetEntry[]; outgoing: BudgetEntry[]; confirmedBalance: bigint; allBalance: bigint };

/** The paired columns share a date. Their line positions do not imply payment order. */
export function buildBudgetSheet(plans: Plan[], forecast: { firstDate: string; endDate: string; rows: { date: string; confirmedBalance: bigint; allBalance: bigint }[] }): BudgetDay[] {
  const days = new Map<string, BudgetDay>(forecast.rows.map(row => [row.date, { ...row, incoming: [], outgoing: [] }]));
  for (const plan of plans) {
    const originalDate = plan.plannedDate.toISOString().slice(0, 10);
    const add = (date: string, id: string, amount: bigint, state: BudgetEntry["state"]) => {
      if (date < forecast.firstDate || date > forecast.endDate || amount === 0n) return;
      const day = days.get(date);
      if (!day) throw new Error("예산 상세와 잔액 전망의 날짜가 일치하지 않습니다.");
      day[plan.direction === "IN" ? "incoming" : "outgoing"].push({ id, planId: plan.id, title: plan.title, category: plan.category, date, originalDate, state, amount });
    };
    for (const payment of plan.settlements) if (!payment.voidedAt) add(payment.processedDate.toISOString().slice(0, 10), payment.id, BigInt(payment.amount.toFixed(0)), "실제");
    const { remaining } = cashSummary(plan);
    add(originalDate < forecast.firstDate ? forecast.firstDate : originalDate, `remaining:${plan.id}`, remaining, plan.certainty === "CONFIRMED" ? "확정 예정" : "예상 예정");
  }
  for (const day of days.values()) for (const entries of [day.incoming, day.outgoing]) entries.sort((a, b) => a.state.localeCompare(b.state) || a.title.localeCompare(b.title, "ko") || a.id.localeCompare(b.id));
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

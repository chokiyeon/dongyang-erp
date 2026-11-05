export const CASH_CATEGORIES = ["공사대금", "자재대금", "직원급여", "현장노무비", "현장경비", "세금", "보험료", "카드대금", "어음결제", "수취어음", "대출·이자", "기타"] as const;
export const DIRECTIONS = { IN: "입금", OUT: "지출" } as const;
export const CERTAINTIES = { CONFIRMED: "확정", ESTIMATED: "예상" } as const;

export function cashSummary(plan: { plannedAmount: { toFixed: (n: number) => string }; completedAt: Date | null; settlements: { amount: { toFixed: (n: number) => string }; voidedAt?: Date | null }[] }) {
  const planned = BigInt(plan.plannedAmount.toFixed(0));
  const actual = plan.settlements.filter((s) => !s.voidedAt).reduce((sum, s) => sum + BigInt(s.amount.toFixed(0)), 0n);
  return { planned, actual, remaining: plan.completedAt ? 0n : planned > actual ? planned - actual : 0n, difference: planned - actual, status: plan.completedAt ? "완료" : actual > 0n ? "일부 처리" : "예정" };
}
export function won(value: bigint) { return `${value.toLocaleString("ko-KR")}원`; }


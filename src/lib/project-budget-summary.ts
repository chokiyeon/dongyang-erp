export const BUDGET_FIELDS = { materialBudget: "자재비", laborBudget: "인건비", otherBudget: "기타비" } as const;
export type BudgetValues = { materialBudget: string | null; laborBudget: string | null; otherBudget: string | null };
export function budgetComparison(budget: string | null, paid: string) {
  const value = BigInt(paid);
  if (budget === null) return { remaining: null, exceeded: false, rate: null };
  const planned = BigInt(budget);
  // Integer arithmetic preserves large monetary values. A zero budget has no percentage.
  const tenths = planned > 0n ? value * 1000n / planned : null;
  return { remaining: planned - value, exceeded: value > planned, rate: tenths === null ? null : `${tenths / 10n}.${tenths % 10n}%` };
}
export function summarizeProjectBudget(budget: BudgetValues, paid: { materialBudget: string; laborBudget: string; otherBudget: string }) {
  const keys = Object.keys(BUDGET_FIELDS) as (keyof BudgetValues)[];
  const comparisons = keys.map((key) => ({ key, label: BUDGET_FIELDS[key], budget: budget[key], paid: paid[key], ...budgetComparison(budget[key], paid[key]) }));
  const entered = keys.filter((key) => budget[key] !== null).length;
  const enteredTotal = keys.reduce((sum,key) => sum + BigInt(budget[key] ?? "0"), 0n);
  const paidTotal = keys.reduce((sum,key) => sum + BigInt(paid[key]), 0n);
  return { comparisons, entered, enteredTotal, paidTotal, remaining: entered === 3 ? enteredTotal - paidTotal : null, exceeded: comparisons.some((c) => c.exceeded) };
}

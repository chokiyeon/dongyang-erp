import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { InputError, date, revision, text } from "./validation";
import { cashSummary } from "./cash";

type Money = { toFixed: (n: number) => string };
type Plan = { direction: "IN" | "OUT"; certainty: "CONFIRMED" | "ESTIMATED"; plannedDate: Date; plannedAmount: Money; completedAt: Date | null; settlements: { amount: Money; processedDate: Date; voidedAt?: Date | null }[] };
export function signedAmount(value: string): string {
  if (!/^-?(0|[1-9]\d{0,19})$/.test(value)) throw new InputError("기준 잔액은 쉼표 없이 20자리 이하의 정수로 입력해 주세요.");
  return BigInt(value).toString();
}
export function koreanToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export async function saveBaseline(tx: Prisma.TransactionClient, data: FormData) {
  const baseDate = date(text(data, "baseDate", "잔액 기준일", true), "잔액 기준일");
  if (!baseDate || baseDate.toISOString().slice(0, 10) > koreanToday()) throw new InputError("잔액 기준일은 오늘 이후로 설정할 수 없습니다.");
  const value = signedAmount(text(data, "baseAmount", "기준 잔액", true, 21));
  const note = text(data, "baseNote", "잔액 확인 근거", true, 300);
  const version = revision(data);
  const updated = await tx.company.updateMany({ where: { id: COMPANY_ID, baselineVersion: version }, data: { baselineVersion: { increment: 1 } } });
  if (updated.count !== 1) throw new InputError("잔액 기준이 변경되었습니다. 화면을 새로 열어 주세요.");
  await tx.cashBaseline.create({ data: { companyId: COMPANY_ID, baseDate, amount: value, note, revision: version + 1 } });
}

export function buildForecast(baseline: { baseDate: Date; amount: Money }, plans: Plan[], months: 3 | 6) {
  const base = baseline.baseDate.toISOString().slice(0, 10);
  const first = new Date(baseline.baseDate); first.setUTCDate(first.getUTCDate() + 1);
  const firstDate = first.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + months, 0));
  const endDate = end.toISOString().slice(0, 10);
  const events = new Map<string, { date: string; actualIn: bigint; actualOut: bigint; expectedIn: bigint; confirmedIn: bigint; expectedOut: bigint }>();
  let overdueCount = 0;
  const event = (date: string) => {
    let current = events.get(date);
    if (!current) { current = { date, actualIn: 0n, actualOut: 0n, expectedIn: 0n, confirmedIn: 0n, expectedOut: 0n }; events.set(date, current); }
    return current;
  };
  for (const plan of plans) {
    for (const settlement of plan.settlements) {
      if (settlement.voidedAt) continue;
      const d = settlement.processedDate.toISOString().slice(0, 10);
      if (d <= base || d > endDate) continue;
      const current = event(d);
      if (plan.direction === "IN") current.actualIn += BigInt(settlement.amount.toFixed(0));
      else current.actualOut += BigInt(settlement.amount.toFixed(0));
    }
    const { remaining } = cashSummary(plan);
    if (!remaining) continue;
    let d = plan.plannedDate.toISOString().slice(0, 10);
    if (d <= base) { overdueCount++; d = firstDate; }
    if (d > endDate) continue;
    const current = event(d);
    if (plan.direction === "IN") {
      current.expectedIn += remaining;
      if (plan.certainty === "CONFIRMED") current.confirmedIn += remaining;
    } else current.expectedOut += remaining;
  }
  // 거래가 없는 달도 월말 잔액을 표시합니다.
  for (let i = 1; i <= months; i++) event(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 0)).toISOString().slice(0, 10));
  let confirmedBalance = BigInt(baseline.amount.toFixed(0));
  let allBalance = confirmedBalance;
  const rows = [...events.values()].sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
    confirmedBalance += e.actualIn - e.actualOut + e.confirmedIn - e.expectedOut;
    allBalance += e.actualIn - e.actualOut + e.expectedIn - e.expectedOut;
    return { ...e, confirmedBalance, allBalance };
  });
  const monthlyRows: { month: string; openingBalance: bigint; openingAllBalance: bigint; actualIn: bigint; actualOut: bigint; confirmedIn: bigint; estimatedIn: bigint; expectedOut: bigint; confirmedBalance: bigint; allBalance: bigint }[] = [];
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    let monthly = monthlyRows.at(-1);
    if (!monthly || monthly.month !== month) {
      const previous = monthly;
      monthly = { month, openingBalance: previous?.confirmedBalance ?? BigInt(baseline.amount.toFixed(0)), openingAllBalance: previous?.allBalance ?? BigInt(baseline.amount.toFixed(0)), actualIn: 0n, actualOut: 0n, confirmedIn: 0n, estimatedIn: 0n, expectedOut: 0n, confirmedBalance: row.confirmedBalance, allBalance: row.allBalance };
      monthlyRows.push(monthly);
    }
    monthly.actualIn += row.actualIn;
    monthly.actualOut += row.actualOut;
    monthly.confirmedIn += row.confirmedIn;
    monthly.estimatedIn += row.expectedIn - row.confirmedIn;
    monthly.expectedOut += row.expectedOut;
    monthly.confirmedBalance = row.confirmedBalance;
    monthly.allBalance = row.allBalance;
  }
  return { rows, monthlyRows, firstDate, endDate, overdueCount, firstShortage: BigInt(baseline.amount.toFixed(0)) < 0n ? base : rows.find((r) => r.confirmedBalance < 0n)?.date ?? null };
}

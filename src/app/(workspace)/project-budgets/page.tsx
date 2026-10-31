import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { BUDGET_FIELDS, summarizeProjectBudget, type BudgetValues } from "@/lib/project-budget-summary";
import { Field, Section } from "@/components/fields";
import { RecordForm } from "@/components/record-form";
import { saveBudgetAction } from "./actions";
type Query = { edit?: string; q?: string; saved?: string };
const won = (n: bigint | string | null) => n === null ? "미등록" : `${BigInt(n).toLocaleString("ko-KR")}원`;
function snapshot(value: unknown) {
  const data = value && typeof value === "object" ? value as Record<string,unknown> : {};
  return Object.entries(BUDGET_FIELDS).map(([key,label]) => `${label} ${typeof data[key] === "string" ? won(data[key] as string) : "미등록"}`).join(" · ");
}
async function Content({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin(); const company = await requireCompany(); const query = await searchParams; const db = getDb(); const q = (query.q ?? "").slice(0,100);
  const [projects, groups, selected] = await Promise.all([
    db.project.findMany({ where: { companyId: company.id, ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {}) }, orderBy: { code: "asc" } }),
    db.paymentAllocation.groupBy({ by: ["projectId", "category"], where: { project: { companyId: company.id }, transaction: { account: { companyId: company.id }, direction: "OUT", internalTransfer: false } }, _sum: { amount: true } }),
    query.edit ? db.project.findFirst({ where: { id: query.edit, companyId: company.id }, include: { budgetChanges: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 } } }) : null,
  ]);
  if (query.edit && !selected) notFound();
  function summary(p: { id: string; materialBudget: { toFixed(n: number): string } | null; laborBudget: { toFixed(n: number): string } | null; otherBudget: { toFixed(n: number): string } | null }) {
    const paid = (category: string) => groups.find((g) => g.projectId === p.id && g.category === category)?._sum.amount?.toFixed(0) ?? "0";
    return summarizeProjectBudget({ materialBudget: p.materialBudget?.toFixed(0) ?? null, laborBudget: p.laborBudget?.toFixed(0) ?? null, otherBudget: p.otherBudget?.toFixed(0) ?? null }, { materialBudget: paid("MATERIAL"), laborBudget: paid("LABOR"), otherBudget: paid("OTHER") });
  }
  return <><h1>현장별 지급예산</h1><p className="erp-page-description">공사 전체 기간의 자재비·인건비·기타비 지급예산과 현장에 배분한 누적 은행 출금을 비교합니다.</p>
  {query.saved === "1" && <p role="status">현장 지급예산을 저장했습니다.</p>}
  <Section title="예산 비교 기준" description="지급예산은 은행에서 나갈 금액 기준으로 입력하세요. 자재대금의 부가세와 급여 공제 차이를 고려해 같은 기준으로 비교해야 합니다."><p className="text-xs leading-6 text-slate-600">예산 차액 = 지급예산 − 누적 배분 지급액입니다. 통장 잔액·미지급 채무·앞으로 지급할 금액·이익을 뜻하지 않습니다. 미배분 출금은 현장 지급액에 포함되지 않으므로 현장 배분을 먼저 확인하세요.</p><Link className="erp-row-action mt-2" href="/project-costs">현장 배분·미배분 확인</Link></Section>
  <div className="mt-4"><Section title="현장별 예산 대비 지급" description="전체 공사기간 누적 기준입니다. 항목별 미등록은 0원과 구분하며, 세 항목을 모두 입력해야 전체 예산 차액을 계산합니다."><form method="get" className="flex flex-wrap items-end gap-3"><Field label="현장 코드·이름 검색" name="q" defaultValue={q} maxLength={100} /><button className="erp-button">검색</button></form><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>현장</th>{Object.values(BUDGET_FIELDS).map((label) => <th key={label}>{label} 예산 / 지급 / 차액</th>)}<th>전체 합계</th><th>상태</th><th>작업</th></tr></thead><tbody>{projects.map((p) => { const s = summary(p); return <tr key={p.id}><td>{p.code} · {p.name}{!p.active && " (사용 중지)"}</td>{s.comparisons.map((c) => <td key={c.key}><div>예산 {won(c.budget)}</div><div>지급 {won(c.paid)}</div><div className={c.exceeded ? "font-semibold text-red-700" : ""}>차액 {c.remaining === null ? "계산 대기" : won(c.remaining)}{c.exceeded && " · 초과"}</div></td>)}<td><div>{s.entered === 3 ? "예산 합계" : "입력분 합계"} {won(s.enteredTotal)}</div><div>지급 합계 {won(s.paidTotal)}</div><div>차액 {s.remaining === null ? "계산 대기" : won(s.remaining)}</div></td><td>{s.entered === 0 ? "예산 미등록" : s.entered < 3 ? "일부 예산 미등록" : "예산 등록 완료"}{s.exceeded && <div className="font-semibold text-red-700">항목 예산 초과</div>}</td><td><Link className="erp-row-action" href={`/project-budgets?edit=${p.id}`}>예산 입력·수정</Link></td></tr>; })}{!projects.length && <tr><td colSpan={7}>조회된 현장이 없습니다. 현장 관리에서 공사 현장을 등록하세요.</td></tr>}</tbody></table></div></Section></div>
  {selected && <div className="mt-4"><Section title="현장 지급예산 입력·수정" description={`${selected.code} · ${selected.name} — 빈칸은 미등록, 0원은 해당 항목 지급예산 없음으로 저장합니다.`}><RecordForm key={`${selected.id}:${selected.budgetVersion}`} action={saveBudgetAction} label="지급예산 저장"><input type="hidden" name="projectId" value={selected.id} /><input type="hidden" name="version" value={selected.budgetVersion} /><input type="hidden" name="requestId" value={randomUUID()} />{Object.entries(BUDGET_FIELDS).map(([key,label]) => <Field key={key} label={`${label} 지급예산 (원)`} name={key} inputMode="numeric" maxLength={20} defaultValue={selected[key as keyof BudgetValues]?.toFixed(0) ?? ""} />)}<Field label="예산 등록·수정 사유" name="reason" required maxLength={300} /><p className="text-xs text-slate-500">공사 전체 기간의 지급계획입니다. 계약 공급가액이나 은행 거래액은 변경하지 않습니다. 세 항목을 비워 저장하면 예산을 미등록 상태로 되돌립니다.</p></RecordForm>
  <h3 className="mt-4 font-semibold">항목별 지급 비교</h3><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>항목</th><th>지급예산</th><th>누적 지급</th><th>차액</th><th>지급률</th></tr></thead><tbody>{summary(selected).comparisons.map((c) => <tr key={c.key}><td>{c.label}</td><td>{won(c.budget)}</td><td>{won(c.paid)}</td><td className={c.exceeded ? "font-semibold text-red-700" : ""}>{c.remaining === null ? "계산 대기" : won(c.remaining)}{c.exceeded && " · 초과"}</td><td>{c.rate ?? "계산 불가"}</td></tr>)}</tbody></table></div>
  <h3 className="mt-4 font-semibold">최근 예산 변경 이력 (최대 10건)</h3>{selected.budgetChanges.map((c) => <details className="mt-2 rounded border border-slate-200 p-3 text-xs" key={c.id}><summary>{c.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {c.reason}</summary><p className="mt-2">변경 전: {snapshot(c.previous)}</p><p>변경 후: {snapshot(c.next)}</p></details>)}<Link className="erp-row-action mt-3" href="/project-budgets">수정 닫기</Link></Section></div>}</>;
}
export default function Page(props: { searchParams: Promise<Query> }) { return <Suspense fallback={<p>현장 지급예산을 불러오는 중입니다.</p>}><Content {...props} /></Suspense>; }

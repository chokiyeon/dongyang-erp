import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { date, InputError, formatWon } from "@/lib/validation";
import { PAYMENT_CATEGORIES } from "@/lib/payment-allocation-types";
import { Field, Section } from "@/components/fields";
import { PaymentAllocationEditor } from "@/components/payment-allocation-editor";
type Query = { from?: string; to?: string; q?: string; page?: string; edit?: string; saved?: string };
const won = (n: bigint) => `${n.toLocaleString("ko-KR")}원`;
async function Content({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin(); const company = await requireCompany(); const query = await searchParams; const db = getDb();
  const from = query.from ?? ""; const to = query.to ?? ""; const q = (query.q ?? "").slice(0, 100);
  let error = ""; let tradedDate: Prisma.DateTimeFilter = {};
  try { const start = date(from, "시작일"); const end = date(to, "종료일"); if (start && end && start > end) throw new InputError("시작일과 종료일을 확인해 주세요."); tradedDate = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) }; }
  catch (e) { error = e instanceof InputError ? e.message : "조회 기간을 확인해 주세요."; }
  const base: Prisma.BankTransactionWhereInput = { account: { companyId: company.id }, direction: "OUT", internalTransfer: false, tradedDate, ...(error ? { id: "invalid-period" } : {}) };
  const where = { ...base, ...(q ? { description: { contains: q, mode: "insensitive" as const } } : {}) };
  const [projects, groups, paid, count, selected] = await Promise.all([
    db.project.findMany({ where: { companyId: company.id }, orderBy: { code: "asc" } }),
    db.paymentAllocation.groupBy({ by: ["projectId", "category"], where: { transaction: base }, _sum: { amount: true } }),
    db.bankTransaction.aggregate({ where: base, _sum: { amount: true } }), db.bankTransaction.count({ where }),
    query.edit ? db.bankTransaction.findFirst({ where: { id: query.edit, direction: "OUT", account: { companyId: company.id } }, include: { account: true, paymentAllocations: { orderBy: { id: "asc" } }, allocationChanges: { orderBy: { createdAt: "desc" }, take: 10 } } }) : null,
  ]);
  if (query.edit && !selected) notFound();
  const pageCount = Math.max(1, Math.ceil(count / 50)); const parsed = Number(query.page); const page = Math.min(pageCount, Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1);
  const rows = await db.bankTransaction.findMany({ where, include: { account: true, paymentAllocations: { include: { project: true } } }, orderBy: [{ tradedDate: "desc" }, { id: "desc" }], skip: (page - 1) * 50, take: 50 });
  const sum = (projectId: string | null, category?: string) => groups.filter((g) => g.projectId === projectId && (!category || g.category === category)).reduce((total, g) => total + BigInt(g._sum.amount?.toFixed(0) ?? "0"), 0n);
  const allocated = groups.reduce((total, g) => total + BigInt(g._sum.amount?.toFixed(0) ?? "0"), 0n); const totalPaid = BigInt(paid._sum.amount?.toFixed(0) ?? "0");
  const href = (p: number) => `/project-costs?${new URLSearchParams({ from, to, q, page: String(p) })}`;
  return <><h1>현장별 지급 현황</h1><p className="erp-page-description">은행 출금을 여러 현장·지급 구분으로 나눠 기록합니다. 실제 지급액 기준이며 미지급 매입·미지급 급여를 포함한 원가나 이익은 아닙니다.</p>
  {query.saved === "1" && <p role="status">현장 배분을 저장했습니다.</p>}
  <Section title="지급기간 조회"><form method="get" className="flex flex-wrap items-end gap-3"><Field label="지급 시작일" name="from" type="date" defaultValue={from} /><Field label="지급 종료일" name="to" type="date" defaultValue={to} /><button className="erp-button">기간 조회</button></form><p className="text-xs text-slate-500">날짜를 비우면 전체 기간입니다. 아래 현장별 합계는 조회 기간 전체를 기준으로 합니다.</p>{error && <p role="alert">{error}</p>}</Section>
  <div className="my-3"><Link className="erp-row-action" href="/project-budgets">현장별 지급예산과 비교</Link></div>
  <div className="erp-summary mt-4">{[["이체 제외 출금 합계", totalPaid], ["현장 배분 합계", allocated - sum(null)], ["본사·공통·공사 외", sum(null)], ["미배분 금액", totalPaid - allocated]].map(([label, value]) => <div className="erp-summary-item" key={String(label)}><p>{String(label)}</p><strong className="erp-summary-value">{won(value as bigint)}</strong></div>)}</div>
  <Section title="현장별 지급 합계" description="은행에서 출금된 금액 그대로 합산합니다. 부가세·급여 공제 차이를 보정한 세무 원가가 아니며, 계약 공급가액에서 차감해 이익으로 계산하지 않습니다."><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>현장</th><th>자재비 지급</th><th>인건비 지급</th><th>기타 지급</th><th>지급 합계</th></tr></thead><tbody>{projects.map((p) => <tr key={p.id}><td>{p.code} · {p.name}{!p.active && " (사용 중지)"}</td><td>{won(sum(p.id, "MATERIAL"))}</td><td>{won(sum(p.id, "LABOR"))}</td><td>{won(sum(p.id, "OTHER"))}</td><td>{won(sum(p.id))}</td></tr>)}{!projects.length && <tr><td colSpan={5}>먼저 현장 관리에서 공사 현장을 등록해 주세요.</td></tr>}</tbody></table></div></Section>
  {selected && <div className="mt-4"><Section title="출금 현장 배분" description={`${selected.tradedDate.toISOString().slice(0,10)} · ${selected.account.bankName} · ${selected.account.label} · ${selected.description} · ${formatWon(selected.amount)}`}><PaymentAllocationEditor key={`${selected.id}:${selected.allocationVersion}`} transactionId={selected.id} version={selected.allocationVersion} requestId={randomUUID()} amount={selected.amount.toFixed(0)} initial={selected.paymentAllocations.map((r) => ({ projectId: r.projectId ?? "", category: r.category, amount: r.amount.toFixed(0), note: r.note }))} projects={projects.map(({id,code,name,active}) => ({ id,code,name,active }))} /><h3 className="mt-4 font-semibold">최근 배분 변경 이력</h3><ul>{selected.allocationChanges.map((c) => <li key={c.id}>{c.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {c.reason}</li>)}</ul><Link href="/project-costs" className="erp-row-action mt-3">배분 닫기</Link></Section></div>}
  <div className="mt-4"><Section title="출금별 배분 내역" description="계좌 간 이체는 제외합니다. 검색은 아래 출금 목록에만 적용되며 현장별 합계에는 영향을 주지 않습니다. 목록·엑셀 저장은 현재 페이지 50건 기준입니다."><form method="get" className="flex items-end gap-3"><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><Field label="출금 내용 검색" name="q" defaultValue={q} maxLength={100} /><button className="erp-button">검색</button></form><p>총 {count}건 · {page}/{pageCount}쪽</p><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>지급일</th><th>계좌·거래내용</th><th>출금액</th><th>배분 내역</th><th>미배분</th><th>작업</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{r.tradedDate.toISOString().slice(0,10)}</td><td>{r.account.bankName} · {r.account.label}<br />{r.description}</td><td>{formatWon(r.amount)}</td><td>{r.paymentAllocations.map((a) => <div key={a.id}>{a.project?.name ?? "본사·공통·공사 외"} · {PAYMENT_CATEGORIES[a.category]} · {formatWon(a.amount)}{a.note && ` · ${a.note}`}</div>)}</td><td>{won(BigInt(r.amount.toFixed(0)) - r.paymentAllocations.reduce((sum,a) => sum + BigInt(a.amount.toFixed(0)), 0n))}</td><td><Link className="erp-row-action" href={`/project-costs?${new URLSearchParams({ from,to,q,edit:r.id })}`}>배분 입력·수정</Link></td></tr>)}{!rows.length && <tr><td colSpan={6}>조회된 출금 거래가 없습니다.</td></tr>}</tbody></table></div><div className="mt-3 flex gap-4">{page > 1 && <Link href={href(page - 1)}>이전</Link>}{page < pageCount && <Link href={href(page + 1)}>다음</Link>}</div></Section></div></>;
}
export default function Page(props: { searchParams: Promise<Query> }) { return <Suspense fallback={<p>현장별 지급 내역을 불러오는 중입니다.</p>}><Content {...props} /></Suspense>; }

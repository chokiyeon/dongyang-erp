import { Suspense } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { STATUS_LABELS, formatWon } from "@/lib/validation";
import { cashSummary, won, DIRECTIONS } from "@/lib/cash";
import { koreanToday } from "@/lib/forecast";
import { Section } from "@/components/fields";
async function Overview() {
  await requireAdmin();
  const company = await requireCompany();
  const db = getDb();
  const [projects, partners, accounts, baseline, plans, trades] = await Promise.all([
    db.project.findMany({ where: { companyId: company.id, active: true }, include: { client: true }, orderBy: { updatedAt: "desc" } }),
    db.partner.count({ where: { companyId: company.id, active: true } }),
    db.bankAccount.findMany({ where: { companyId: company.id, active: true }, orderBy: [{ bankName: "asc" }, { label: "asc" }] }),
    db.cashBaseline.findFirst({ where: { companyId: company.id }, orderBy: { revision: "desc" } }),
    db.cashPlan.findMany({ where: { companyId: company.id }, include: { settlements: true }, orderBy: { plannedDate: "asc" } }),
    db.tradeDocument.groupBy({ by: ["kind"], where: { companyId: company.id, voidedAt: null }, _sum: { grossAmount: true, settledAmount: true } }),
  ]);
  const tradeRemaining = (kind: "SALE" | "PURCHASE") => { const r = trades.find((g) => g.kind === kind); return BigInt(r?._sum.grossAmount?.toFixed(0) ?? "0")-BigInt(r?._sum.settledAmount?.toFixed(0) ?? "0"); };
  const pending = plans.map((p) => ({ ...p, summary: cashSummary(p) })).filter((p) => p.summary.remaining > 0n);
  const incoming = pending.filter((p) => p.direction === "IN").reduce((sum, p) => sum + p.summary.remaining, 0n);
  const outgoing = pending.filter((p) => p.direction === "OUT").reduce((sum, p) => sum + p.summary.remaining, 0n);
  const today = koreanToday();
  const overdue = pending.filter((p) => p.plannedDate.toISOString().slice(0, 10) < today).length;
  return <>
    <div className="erp-page-tools"><div><h1>업무 현황</h1><span className="erp-badge erp-badge-blue">경리·자금</span></div><span className="erp-page-date">조회 기준일 {today.replaceAll("-", ".")}</span></div>
    <p className="erp-page-description">회사 자금과 현장별 업무 현황을 확인합니다. 금액은 등록된 자료 기준입니다.</p>
    <div className="erp-summary" aria-label="자금 요약">
      <Link href="/forecast" className="erp-summary-item"><p>기준 순잔액</p><strong className="erp-summary-value">{baseline ? BigInt(baseline.amount.toFixed(0)).toLocaleString("ko-KR") : "미등록"}{baseline && <small>원</small>}</strong><p className="erp-summary-sub">{baseline ? `${baseline.baseDate.toISOString().slice(0, 10)} 종료 기준 · 수기 확인` : "자금계획에서 기준 잔액 등록"}</p></Link>
      <Link href="/cash?direction=IN" className="erp-summary-item"><p>미처리 입금 예정</p><strong className="erp-summary-value">{incoming.toLocaleString("ko-KR")}<small>원</small></strong><p className="erp-summary-sub">전체 예정 중 남은 수금액 · 예상 포함</p></Link>
      <Link href="/cash?direction=OUT" className="erp-summary-item"><p>미처리 지출 예정</p><strong className="erp-summary-value">{outgoing.toLocaleString("ko-KR")}<small>원</small></strong><p className="erp-summary-sub">전체 예정 중 남은 지급액</p></Link>
      <Link href="/cash" className="erp-summary-item"><p>예정일 경과 미처리</p><strong className="erp-summary-value" style={overdue ? { color: "#b65a54" } : undefined}>{overdue}<small>건</small></strong><p className="erp-summary-sub">실제 입출금 여부 확인 필요</p></Link>
    </div>
    <div className="erp-page-tools"><span className="erp-page-date">진행 현장 {projects.filter((p) => p.status === "IN_PROGRESS").length}개 / 등록 현장 {projects.length}개 · 거래처 {partners}개 · 사용 계좌 {accounts.length}개</span><div><Link className="erp-button" href="/projects">현장 등록</Link><Link className="erp-button erp-button-primary" href="/cash">입출금 등록</Link></div></div>
    <div className="erp-dashboard-grid">
      <Section title="지급·수금 대기 현황" description="남은 예정액이 있는 내역을 예정일 순으로 최대 8건 표시합니다.">
        <div className="overflow-x-auto"><table><thead><tr><th>예정일</th><th>구분</th><th className="text-left">거래 내용</th><th className="text-right">남은 금액</th><th>상태</th></tr></thead><tbody>{pending.slice(0, 8).map((p) => { const late = p.plannedDate.toISOString().slice(0, 10) < today; return <tr key={p.id}><td className="whitespace-nowrap">{p.plannedDate.toISOString().slice(5, 10)}</td><td><span className={`erp-badge ${p.direction === "IN" ? "erp-badge-blue" : ""}`}>{DIRECTIONS[p.direction]}</span></td><td><Link className="text-blue-800" href={`/cash?process=${p.id}`}>{p.title}</Link></td><td className="erp-numeric">{won(p.summary.remaining)}</td><td><span className={`erp-badge ${late ? "erp-badge-red" : ""}`}>{late ? "기한 경과" : p.summary.status}</span></td></tr>; })}{!pending.length && <tr><td colSpan={5} className="erp-empty">처리 대기 중인 입출금 예정이 없습니다.</td></tr>}</tbody></table></div>
        <div className="mt-3 flex justify-end"><Link href="/cash" className="erp-row-action">전체 내역 조회 ›</Link></div>
      </Section>
      <Section title="현장별 계약 현황" description="최근 수정한 현장 8건 · 계약 공급가액은 부가세 제외입니다.">
        <div className="overflow-x-auto"><table><thead><tr><th className="text-left">현장명 / 발주처</th><th>공사 상태</th><th className="text-right">계약 공급가액</th></tr></thead><tbody>{projects.slice(0, 8).map((p) => <tr key={p.id}><td><Link href={`/projects?edit=${p.id}`} className="font-medium text-blue-800">{p.name}</Link><p className="mt-1 text-[10px] text-slate-500">{p.client?.name ?? "발주처 미지정"}</p></td><td><span className={`erp-badge ${p.status === "IN_PROGRESS" ? "erp-badge-blue" : ""}`}>{STATUS_LABELS[p.status]}</span></td><td className="erp-numeric">{formatWon(p.contractAmount)}</td></tr>)}{!projects.length && <tr><td colSpan={3} className="erp-empty">등록된 현장이 없습니다.</td></tr>}</tbody></table></div>
        <div className="mt-3 flex justify-end"><Link href="/projects" className="erp-row-action">현장 관리 ›</Link></div>
      </Section>
      <Section title="법인 계좌 현황" description="계좌별 약정 한도를 표시합니다. 한도는 현금 잔액에 포함하지 않습니다.">
        <div className="overflow-x-auto"><table><thead><tr><th>은행</th><th className="text-left">계좌 별칭</th><th className="text-right">마이너스 약정 한도</th></tr></thead><tbody>{accounts.slice(0, 8).map((a) => <tr key={a.id}><td className="whitespace-nowrap">{a.bankName}</td><td>{a.label}</td><td className="erp-numeric">{a.overdraftLimit === null ? <span className="erp-badge">확인 필요</span> : formatWon(a.overdraftLimit)}</td></tr>)}{!accounts.length && <tr><td colSpan={3} className="erp-empty">등록된 법인 계좌가 없습니다.</td></tr>}</tbody></table></div>
        <div className="mt-3 flex justify-end"><Link href="/accounts" className="erp-row-action">계좌 관리 ›</Link></div>
      </Section>
      <Section title="청구자료 기준 미수·미지급" description="입출금 예정과 별도 집계입니다. 등록 청구액에서 은행 연결액을 뺀 금액이며 서로 더하지 않습니다."><table><thead><tr><th>구분</th><th>잔액</th><th>자료</th></tr></thead><tbody><tr><td>매출 미수금</td><td>{won(tradeRemaining("SALE"))}</td><td><Link className="erp-row-action" href="/trades?kind=SALE">매출</Link></td></tr><tr><td>매입 미지급금</td><td>{won(tradeRemaining("PURCHASE"))}</td><td><Link className="erp-row-action" href="/trades?kind=PURCHASE">매입</Link></td></tr></tbody></table><div className="mt-3"><Link className="erp-row-action" href="/receivables">현장·거래처별 잔액</Link> <Link className="erp-row-action" href="/tax-summary">부가세 추정</Link></div></Section>
      <Section title="업무 확인 사항">
        <table><thead><tr><th className="text-left">확인 항목</th><th>현황</th><th>바로가기</th></tr></thead><tbody><tr><td>자금계획 기준 잔액</td><td><span className={`erp-badge ${baseline ? "erp-badge-green" : "erp-badge-red"}`}>{baseline ? "등록" : "미등록"}</span></td><td><Link href="/forecast" className="erp-row-action">확인</Link></td></tr><tr><td>예정일 지난 입출금</td><td>{overdue}건</td><td><Link href="/cash" className="erp-row-action">조회</Link></td></tr><tr><td>한도 미확인 계좌</td><td>{accounts.filter((a) => a.overdraftLimit === null).length}건</td><td><Link href="/accounts" className="erp-row-action">확인</Link></td></tr></tbody></table>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">은행 실시간 연동·급여·어음·현장 원가는 순차 개발 중입니다. 현재 금액은 수기 등록한 예정과 실제 처리 내역을 기준으로 합니다.</p>
      </Section>
    </div>
    <div className="erp-bottom-strip"><strong>기준정보</strong><Link href="/partners">거래처 관리</Link><span>·</span><Link href="/settings">회사 정보</Link><span className="ml-auto">공사별 원가와 자금 흐름을 연결하는 동양계전 ERP</span></div>
  </>;
}
export default function Home() { return <Suspense fallback={<p>업무 현황을 불러오는 중입니다.</p>}><Overview /></Suspense>; }

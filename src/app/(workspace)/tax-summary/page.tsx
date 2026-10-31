import { Suspense } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { koreanToday } from "@/lib/forecast";
import { taxPeriod, summarizeVat } from "@/lib/tax-summary";
import { TRADE_EVIDENCE, INPUT_VAT_REVIEWS, TAX_KINDS } from "@/lib/trade-types";
import { InputError, formatWon } from "@/lib/validation";
import { Field, Select, Section } from "@/components/fields";
type Query = { month?: string; mode?: string };
const won = (n: bigint) => `${n.toLocaleString("ko-KR")}원`;
async function Content({searchParams}: {searchParams:Promise<Query>}) {
  await requireAdmin(); const company = await requireCompany(); const q = await searchParams; const month = q.month ?? koreanToday().slice(0,7); const mode = q.mode ?? "MONTH"; let period; let error = "";
  try { period = taxPeriod(month,mode); } catch(e) { error = e instanceof InputError ? e.message : "조회 조건을 확인해 주세요."; period = taxPeriod(koreanToday().slice(0,7),"MONTH"); }
  const db = getDb(); const where = { companyId: company.id, voidedAt: null, issuedDate: { gte:period.from, lt:period.to }, ...(error ? {id:"invalid-period"} : {}) };
  const [groups, rows, count] = await Promise.all([
    db.tradeDocument.groupBy({ by:["kind","evidence","proofConfirmed","inputVatReview","taxKind"], where, _sum:{supplyAmount:true,taxAmount:true} }),
    db.tradeDocument.findMany({where,include:{partner:true},orderBy:[{issuedDate:"desc"},{id:"desc"}],take:100}),db.tradeDocument.count({where}),
  ]);
  const s = summarizeVat(groups.map((r) => ({...r,supply:r._sum.supplyAmount?.toFixed(0) ?? "0",tax:r._sum.taxAmount?.toFixed(0) ?? "0"})));
  return <><h1>부가세 추정</h1><p className="erp-page-description">등록한 증빙·청구일 기준의 월별·분기별 자료 점검입니다. 은행 입출금일이나 납부서 기준이 아니며 실제 신고·납부세액과 차이가 날 수 있습니다.</p>
  <Section title="조회 기간"><form method="get" className="flex flex-wrap items-end gap-3"><Field label="기준 월" name="month" type="month" defaultValue={month} required /><Select label="조회 기간 구분" name="mode" defaultValue={mode}><option value="MONTH">월별</option><option value="QUARTER">선택 월이 속한 분기</option></Select><button className="erp-button">조회</button></form>{error && <p role="alert">{error}</p>}<p>{period.label} · {count}건 · 취소 문서 제외</p></Section>
  <div className="erp-summary mt-4">{[["확인된 매출세액",s.output],["공제 가능 확인 매입세액",s.deductible],[s.estimate < 0n ? "차감 결과 (음수)" : "차감 결과",s.estimate]].map(([label,n]) => <div key={String(label)} className="erp-summary-item"><p>{String(label)}</p><strong className="erp-summary-value">{won(n as bigint)}</strong></div>)}</div>
  <Section title="공제·증빙 확인 대기"><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>항목</th><th>금액</th><th>반영 기준</th></tr></thead><tbody><tr><td>매출 증빙 확인 대기 세액</td><td>{won(s.pendingSale)}</td><td>확인된 매출세액에서 제외 · 누락 확인 필요</td></tr><tr><td>매입 증빙·공제 확인 대기 세액</td><td>{won(s.pendingPurchase)}</td><td>공제 가능 매입세액에서 제외</td></tr><tr><td>불공제 확인 매입세액</td><td>{won(s.nondeductible)}</td><td>공제 제외</td></tr><tr><td>확인된 영세율 매출 공급가액</td><td>{won(s.zeroSupply)}</td><td>세액 0원 · 신고 자료 별도 확인</td></tr><tr><td>확인된 면세 매출 공급가액</td><td>{won(s.exemptSupply)}</td><td>과세 매출세액과 구분</td></tr></tbody></table></div><p className="mt-3 text-xs leading-6 text-slate-600">매출세액은 원본 확인된 과세 세금계산서, 매입세액은 원본 확인된 과세 세금계산서 중 ‘공제 가능 확인’ 자료만 반영합니다. 거래명세서·기타 증빙의 세액은 확인 대기로 남깁니다. 미발행·누락 매출, 카드·현금영수증 공제, 공통매입세액 안분, 세액공제·예정고지·가산세 등은 아직 반영하지 않습니다. 음수 차액도 환급 확정액이 아닙니다.</p><Link className="erp-row-action mt-3" href="/trades">증빙·공제 검토 수정</Link></Section>
  <div className="mt-4"><Section title="기간 내 증빙 목록" description="최신 100건을 표시하며 합계는 기간 전체 기준입니다. 미리보기·엑셀 저장은 표시 목록 기준입니다."><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>날짜</th><th>구분·관리번호</th><th>거래처</th><th>증빙·과세</th><th>공급가액</th><th>부가세</th><th>검토</th><th>자료</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{r.issuedDate.toISOString().slice(0,10)}</td><td>{r.kind === "SALE" ? "매출" : "매입"} · {r.reference}</td><td>{r.partner.name}</td><td>{TRADE_EVIDENCE[r.evidence]} · {TAX_KINDS[r.taxKind]}</td><td>{formatWon(r.supplyAmount)}</td><td>{formatWon(r.taxAmount)}</td><td>{r.proofConfirmed ? "원본 확인" : "원본 확인 필요"}{r.kind === "PURCHASE" && ` · ${INPUT_VAT_REVIEWS[r.inputVatReview]}`}</td><td><Link className="erp-row-action" href={`/trades?edit=${r.id}`}>확인</Link></td></tr>)}{!rows.length && <tr><td colSpan={8}>등록된 자료가 없습니다.</td></tr>}</tbody></table></div></Section></div></>;
}
export default function Page(props:{searchParams:Promise<Query>}) { return <Suspense fallback={<p>부가세 자료를 집계하는 중입니다.</p>}><Content {...props}/></Suspense>; }

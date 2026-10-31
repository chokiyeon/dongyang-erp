import { Suspense } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { koreanToday } from "@/lib/forecast";
import { Section } from "@/components/fields";
const won = (n: bigint) => `${n.toLocaleString("ko-KR")}원`;
async function Content() {
  await requireAdmin(); const company = await requireCompany(); const db = getDb(); const today = koreanToday(); const base = { companyId: company.id, voidedAt: null };
  const [byProject, byPartner, lateProject, latePartner, projects, partners, overdue] = await Promise.all([
    db.tradeDocument.groupBy({ by: ["projectId","kind"], where: base, _sum: { grossAmount: true, settledAmount: true } }),
    db.tradeDocument.groupBy({ by: ["partnerId","kind"], where: base, _sum: { grossAmount: true, settledAmount: true } }),
    db.tradeDocument.groupBy({ by: ["projectId","kind"], where: { ...base, dueDate: { lt: new Date(today) }, settledAmount: { lt: db.tradeDocument.fields.grossAmount } }, _sum: { grossAmount: true, settledAmount: true } }),
    db.tradeDocument.groupBy({ by: ["partnerId","kind"], where: { ...base, dueDate: { lt: new Date(today) }, settledAmount: { lt: db.tradeDocument.fields.grossAmount } }, _sum: { grossAmount: true, settledAmount: true } }),
    db.project.findMany({ where: { companyId: company.id }, orderBy: { code: "asc" } }), db.partner.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" } }),
    db.tradeDocument.findMany({ where: { ...base, dueDate: { lt: new Date(today) }, settledAmount: { lt: db.tradeDocument.fields.grossAmount } }, include: { partner: true, project: true }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: 50 }),
  ]);
  type Total = { _sum: { grossAmount: { toFixed(n: number): string } | null; settledAmount: { toFixed(n: number): string } | null } };
  const remaining = (r?: Total) => BigInt(r?._sum.grossAmount?.toFixed(0) ?? "0")-BigInt(r?._sum.settledAmount?.toFixed(0) ?? "0");
  const total = (kind: string) => byProject.filter((r) => r.kind === kind).reduce((sum,r) => sum+remaining(r),0n);
  const late = (kind: string) => lateProject.filter((r) => r.kind === kind).reduce((sum,r) => sum+remaining(r),0n);
  return <><h1>미수·미지급 현황</h1><p className="erp-page-description">등록된 청구금액(부가세 포함)에서 은행에 연결한 수금·지급액을 뺀 잔액입니다. 미청구 계약대금·어음으로 받은 금액·현금 정산은 아직 반영하지 않습니다.</p>
  <div className="erp-summary">{[["매출 미수금",total("SALE")],["매입 미지급금",total("PURCHASE")],["기한 경과 미수",late("SALE")],["기한 경과 미지급",late("PURCHASE")]].map(([label,value]) => <div className="erp-summary-item" key={String(label)}><p>{String(label)}</p><strong className="erp-summary-value">{won(value as bigint)}</strong></div>)}</div>
  <Section title="현장별 잔액" description="취소 자료는 제외합니다. 미수·미지급을 서로 상계하지 않습니다."><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>현장</th><th>미수금</th><th>기한 경과 미수</th><th>미지급금</th><th>기한 경과 미지급</th><th>자료</th></tr></thead><tbody>{[...projects.map((p) => ({id:p.id as string|null,name:`${p.code} · ${p.name}`})),{id:null,name:"본사·공통·현장 미지정"}].map((p) => <tr key={p.id ?? "company"}><td>{p.name}</td><td>{won(remaining(byProject.find((r) => r.projectId === p.id && r.kind === "SALE")))}</td><td>{won(remaining(lateProject.find((r) => r.projectId === p.id && r.kind === "SALE")))}</td><td>{won(remaining(byProject.find((r) => r.projectId === p.id && r.kind === "PURCHASE")))}</td><td>{won(remaining(lateProject.find((r) => r.projectId === p.id && r.kind === "PURCHASE")))}</td><td><Link className="erp-row-action" href={`/trades?${new URLSearchParams({project:p.id ?? "__none",kind:"SALE"})}`}>매출</Link> <Link className="erp-row-action" href={`/trades?${new URLSearchParams({project:p.id ?? "__none",kind:"PURCHASE"})}`}>매입</Link></td></tr>)}</tbody></table></div></Section>
  <div className="mt-4"><Section title="거래처별 잔액"><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>거래처</th><th>미수금</th><th>기한 경과 미수</th><th>미지급금</th><th>기한 경과 미지급</th></tr></thead><tbody>{partners.filter((p) => byPartner.some((r) => r.partnerId === p.id)).map((p) => <tr key={p.id}><td>{p.name}</td><td>{won(remaining(byPartner.find((r) => r.partnerId === p.id && r.kind === "SALE")))}</td><td>{won(remaining(latePartner.find((r) => r.partnerId === p.id && r.kind === "SALE")))}</td><td>{won(remaining(byPartner.find((r) => r.partnerId === p.id && r.kind === "PURCHASE")))}</td><td>{won(remaining(latePartner.find((r) => r.partnerId === p.id && r.kind === "PURCHASE")))}</td></tr>)}</tbody></table></div></Section></div>
  <div className="mt-4"><Section title="기한 경과 내역" description="오래된 기한부터 최대 50건 표시합니다. 전체 합계는 위 요약 기준입니다."><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>기한</th><th>구분</th><th>거래처·현장</th><th>내용</th><th>미정산 잔액</th><th>작업</th></tr></thead><tbody>{overdue.map((r) => <tr key={r.id}><td>{r.dueDate?.toISOString().slice(0,10)}</td><td>{r.kind === "SALE" ? "미수" : "미지급"}</td><td>{r.partner.name} · {r.project?.name ?? "본사·공통"}</td><td>{r.title}</td><td>{won(BigInt(r.grossAmount.toFixed(0))-BigInt(r.settledAmount.toFixed(0)))}</td><td><Link className="erp-row-action" href={`/trades?edit=${r.id}`}>은행 연결</Link></td></tr>)}{!overdue.length && <tr><td colSpan={6}>기한 경과 내역이 없습니다.</td></tr>}</tbody></table></div></Section></div></>;
}
export default function Page() { return <Suspense fallback={<p>잔액을 조회하는 중입니다.</p>}><Content /></Suspense>; }

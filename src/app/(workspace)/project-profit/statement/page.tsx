import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { koreanToday } from "@/lib/forecast";
import { summarizeProjectProfit } from "@/lib/project-profit-summary";
import { PROJECT_COST_CATEGORIES } from "@/lib/project-profit-types";
import { Section } from "@/components/fields";
const won=(n:bigint|string|null)=>n===null?"검토 대기":`${BigInt(n).toLocaleString("ko-KR")}원`;
async function Content({searchParams}:{searchParams:Promise<{project?:string}>}){
  await requireAdmin();const company=await requireCompany();const q=await searchParams;if(!q.project)redirect("/project-profit");const today=koreanToday();
  const p=await getDb().project.findFirst({where:{id:q.project,companyId:company.id},include:{client:true,tradeDocuments:{where:{companyId:company.id,kind:"PURCHASE",voidedAt:null,issuedDate:{lte:new Date(today)}},orderBy:{issuedDate:"asc"}},costEntries:{where:{voidedAt:null,incurredDate:{lte:new Date(today)}},orderBy:{incurredDate:"asc"}}}});
  if(!p)notFound();const s=summarizeProjectProfit(p,p.tradeDocuments,p.costEntries);
  const rows=[
    ["확정 계약 수입 (공급가액)",p.contractAmount?BigInt(p.contractAmount.toFixed(0)):null],
    ["발생 자재비 (지급·미지급 포함)",s.costs.MATERIAL],["발생 인건비 (지급·미지급 포함)",s.costs.LABOR],["발생 현장 기타비",s.costs.OTHER],["발생 배부 공통경비",s.costs.OVERHEAD],["발생원가 참고 합계",s.incurred],
    ["남은 예상 자재비",p.remainingMaterial?BigInt(p.remainingMaterial.toFixed(0)):null],["남은 예상 인건비",p.remainingLabor?BigInt(p.remainingLabor.toFixed(0)):null],["남은 예상 현장 기타비",p.remainingOther?BigInt(p.remainingOther.toFixed(0)):null],["남은 예상 배부 공통경비",p.remainingOverhead?BigInt(p.remainingOverhead.toFixed(0)):null],["남은 예상 원가 합계",s.remaining],
    ["준공 예상 총원가",s.ready?s.expectedCost:null],["준공 예상 이익·손실",s.expectedProfit],
  ] as const;
  return <><h1>공사별 손익계산서 — {p.name}</h1><p className="erp-page-description">{company.name} · {p.code} · 작성 기준 {today} · 계약 대비 준공 예상 손익 (관리용)</p><div className="mb-4 flex flex-wrap gap-3"><Link className="erp-row-action" href={`/project-profit?project=${p.id}`}>이 공사 원가·전망 수정</Link><Link className="erp-row-action" href="/project-profit">공사별 손익 목록</Link></div>
  <Section title="공사 기본정보"><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>정보</th><th>내용</th><th>정보</th><th>내용</th></tr></thead><tbody><tr><td>공사명</td><td>{p.name}</td><td>현장 코드</td><td>{p.code}</td></tr><tr><td>발주처</td><td>{p.client?.name??"미지정"}</td><td>공종</td><td>{p.workTypes.join(" · ")||"미지정"}</td></tr><tr><td>착공일</td><td>{p.startDate?.toISOString().slice(0,10)??"미등록"}</td><td>준공 예정일</td><td>{p.endDate?.toISOString().slice(0,10)??"미등록"}</td></tr><tr><td>원가 최종 검토</td><td>{p.profitReviewedAt?.toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})??"미검토"}</td><td>손익 상태</td><td>{s.ready?s.expectedProfit!<0n?"적자 예상":s.expectedProfit===0n?"손익분기":"이익 예상":"자료·전망 검토 대기"}</td></tr></tbody></table></div></Section>
  <div className="mt-4"><Section title="계약 대비 준공 예상 손익계산서 (관리용)" description="지급액 기준이 아닌 발생원가 기준입니다. 공제 가능한 부가세는 제외하고 불공제 확인 세액은 원가에 포함합니다. 회사 전체 결산 손익이나 법인세 계산서는 아닙니다.">
  {!s.ready&&<div role="note" className="mb-3 rounded border border-red-200 p-3 text-sm text-red-800">미확인 자료 또는 검토 후 변경이 있어 준공 이익을 계산하지 않았습니다. 원가 구분·증빙·부가세·계약금액·남은 원가를 확인한 뒤 해당 공사의 원가·전망 화면에서 검토를 완료하세요.</div>}
  <div className="overflow-x-auto"><table className="erp-table" aria-label="공사별 손익계산서"><thead><tr><th>손익 항목</th><th>금액</th></tr></thead><tbody>{rows.map(([label,value])=><tr key={label}><td>{label}</td><td className={label==="준공 예상 이익·손실"?`font-bold ${value!==null&&value<0n?"text-red-700":"text-blue-800"}`:""}>{won(value)}</td></tr>)}<tr><td>준공 예상 이익률</td><td className="font-bold">{s.margin??"검토 대기"}</td></tr><tr><td>계산 상태</td><td>{s.ready?"발생원가·남은 원가 검토 완료 (예상치)":"자료·전망 검토 대기"}</td></tr><tr><td>작성 기준</td><td>확정 계약 대비 준공 예상 · 발생원가 기준 · 결산 손익/법인세 계산 아님</td></tr></tbody></table></div>
  <p className="mt-3 text-xs leading-6 text-slate-600">이미 발생한 원가에는 등록한 미지급 매입과 추가 발생원가가 포함됩니다. 은행 출금·미지급 잔액을 다시 원가에 더하지 않습니다. 매입 문서에 없는 급여·미청구 자재·경비·공통경비와 남은 비용은 별도 확인이 필요합니다. 승인된 추가공사는 확정 계약금액에 반영해야 합니다.</p></Section></div>
  <div className="mt-4"><Section title="손익과 구분해 확인할 금액"><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>확인 항목</th><th>금액</th><th>손익 반영</th></tr></thead><tbody><tr><td>등록 매입의 미지급 잔액 (부가세 포함)</td><td>{won(s.unpaid)}</td><td>해당 발생원가에 이미 포함 · 다시 더하지 않음</td></tr><tr><td>미승인 추가공사 공급가액</td><td>{p.unapprovedAdditional?won(p.unapprovedAdditional.toFixed(0)):"미입력"}</td><td>계약 수입에 미포함</td></tr></tbody></table></div></Section></div>
  {s.issues.length>0&&<div className="mt-4"><Section title="계산 보류 사유"><ul className="text-xs">{s.issues.map((v,i)=><li key={i}>{v}</li>)}</ul></Section></div>}
  <div className="mt-4"><Section title="발생원가 근거" description="이 공사에 등록한 매입과 추가 발생원가만 표시합니다. 근거 목록은 각각 최대 100건이며 위 합계는 전체 자료 기준입니다."><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>발생일</th><th>근거</th><th>내용</th><th>구분</th><th>원가 반영액</th></tr></thead><tbody>{p.tradeDocuments.slice(0,100).map(d=><tr key={d.id}><td>{d.issuedDate.toISOString().slice(0,10)}</td><td>매입 {d.reference}</td><td>{d.title}</td><td>{d.profitCategory?PROJECT_COST_CATEGORIES[d.profitCategory]:"미지정"}</td><td>{d.profitCategory?won(BigInt(d.supplyAmount.toFixed(0))+(d.inputVatReview==="NONDEDUCTIBLE"?BigInt(d.taxAmount.toFixed(0)):0n)):"원가 구분 필요"}</td></tr>)}{p.costEntries.slice(0,100).map(c=><tr key={c.id}><td>{c.incurredDate.toISOString().slice(0,10)}</td><td>추가 원가 {c.reference}</td><td>{c.title}</td><td>{PROJECT_COST_CATEGORIES[c.category]}</td><td>{won(c.amount.toFixed(0))}</td></tr>)}</tbody></table></div></Section></div></>;
}
export default function Page(props:{searchParams:Promise<{project?:string}>}){return<Suspense fallback={<p>공사별 손익계산서를 준비하는 중입니다.</p>}><Content {...props}/></Suspense>;}

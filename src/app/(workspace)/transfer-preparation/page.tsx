import {randomUUID} from "node:crypto";
import {Suspense} from "react";
import Link from "next/link";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {koreanToday} from "@/lib/forecast";
import {recurringDue} from "@/lib/payment-terms";
import {transferPreparation} from "@/lib/transfer-preparation";
import {TransferPreparation} from "@/components/transfer-preparation";
import {Field,Select,Section} from "@/components/fields";
import {InputError} from "@/lib/validation";
async function Content({searchParams}:{searchParams:Promise<{until?:string;project?:string}>}){
 await requireAdmin();const company=await requireCompany();const q=await searchParams;const db=getDb();const until=q.until??recurringDue(koreanToday().slice(0,7),0);const project=(q.project??"").slice(0,50);let error="";let data;
 try{data=await transferPreparation(db,until,project);}catch(e){error=e instanceof InputError?e.message:"송금 내역을 조회하지 못했습니다.";data={ready:[],held:[],nonTransfer:0,missingTemplates:0};}
 const projects=await db.project.findMany({where:{companyId:company.id},orderBy:{code:"asc"}});
 return <><h1>송금 준비표</h1><p className="erp-page-description">{company.name} · 작성 {new Date().toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} · 기준일까지 지급기한이 도래한 미지급 내역과 월별 정기 지급을 모읍니다. 기한이 지난 미지급도 포함합니다.</p>
 <div data-erp-report-exclude><Section title="송금 준비 조회"><form method="get" className="flex flex-wrap items-end gap-3"><Field label="송금 준비 기준일" name="until" type="date" required defaultValue={until}/><Select label="송금 조회 현장" name="project" defaultValue={project}><option value="">전체 현장·본사</option><option value="__company">본사·공통만</option>{projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select><button className="erp-button">최신 내역으로 조회</button></form>{error&&<p role="alert">{error}</p>}<p className="mt-2 text-xs">계좌 송금 대상 {data.ready.length}건 · 확인 보류 {data.held.length}건 · 어음/기타 지급 {data.nonTransfer}건 제외</p><p className="mt-2 text-xs">직원 통합 급여는 전체 현장·본사 조회에서만 표시합니다. 급여 지급 확인에서 등록한 급여만 포함됩니다.</p><div className="mt-3 flex flex-wrap gap-3"><Link className="erp-row-action" href={`/recurring-payments?period=${until.slice(0,7)}`}>월세·전기요금 등 정기 지급 준비</Link><Link className="erp-row-action" href="/partners">거래처 계좌·지급 조건 등록</Link><Link className="erp-row-action" href="/trades?kind=PURCHASE">매입 기한·지급방법 확인</Link><Link className="erp-row-action" href="/payroll-payments">급여 지급 확인</Link></div>{data.missingTemplates>0&&<p className="mt-3 text-red-700">이번 지급월에 아직 준비하지 않은 정기 지급 {data.missingTemplates}건이 있습니다. 월별 준비를 실행해야 누락 여부를 확인할 수 있습니다.</p>}</Section></div>
 <div className="mt-4"><Section title="송금 준비 내역" description="선택한 내역만 합산·미리보기·인쇄·엑셀 저장합니다. 여러 공사에 배부한 청구는 공사 필터에서도 거래처에 보낼 청구 전체 미지급액을 한 번 표시합니다. 계좌 확인 및 송금 직전 잔액·금액 최종 대조가 필요합니다. 출력은 지급 완료나 은행 이체를 실행하지 않습니다."><TransferPreparation key={`${until}:${project}`} rows={data.ready} until={until} requestId={randomUUID()}/></Section></div>
 {data.held.length>0&&<div className="mt-4" data-erp-report-exclude><Section title="확인 전 송금 보류" description="계좌·예금주·금액·현장 또는 기한이 미확인인 내역은 송금표에 넣지 않습니다."><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>거래처</th><th>내용·현장</th><th>금액</th><th>보류 사유</th><th>확인</th></tr></thead><tbody>{data.held.map(r=><tr key={r.id}><td>{r.partner}</td><td>{r.description} · {r.project}</td><td>{r.amount?`${BigInt(r.amount).toLocaleString()}원`:"금액 미확인"}</td><td>{r.issues.join(" · ")}</td><td><Link className="erp-row-action" href={r.sourceLink}>원본 확인</Link> <Link className="erp-row-action" href={r.recipientLink??`/partners?edit=${r.partnerId}`}>송금정보 확인</Link></td></tr>)}</tbody></table></div></Section></div>}</>;
}
export default function Page(props:{searchParams:Promise<{until?:string;project?:string}>}){return<Suspense fallback={<p>월말 송금 내역을 모으는 중입니다.</p>}><Content {...props}/></Suspense>;}

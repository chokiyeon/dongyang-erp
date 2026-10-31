import {DocumentLink} from "@/components/document-link";
import {Suspense} from "react";
import {randomUUID} from "node:crypto";
import Link from "next/link";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {koreanToday} from "@/lib/forecast";
import {paymentMonth,recurringDue} from "@/lib/payment-terms";
import {LABOR_ROLES} from "@/lib/labor-types";
import {InputError} from "@/lib/validation";
import {Field,Select,Section} from "@/components/fields";
import {RecordForm} from "@/components/record-form";
import {WorkRecordForm} from "@/components/work-record-form";
import {saveWorkAction,voidWorkAction} from "../employees/actions";
type Query={period?:string;project?:string;employee?:string;edit?:string;saved?:string;cancelled?:string};
async function Content({searchParams}:{searchParams:Promise<Query>}){
 await requireAdmin();const company=await requireCompany();const q=await searchParams;const db=getDb();let period=q.period??koreanToday().slice(0,7);let error="";try{paymentMonth(period);}catch(e){error=e instanceof InputError?e.message:"조회월을 확인하세요.";period=koreanToday().slice(0,7);}
 const [people,projects,records,selected]=await Promise.all([
 db.employee.findMany({where:{companyId:company.id,kind:"DAILY"},include:{rates:{where:{voidedAt:null},orderBy:[{effectiveDate:"desc"},{id:"asc"}]}},orderBy:{code:"asc"}}),db.project.findMany({where:{companyId:company.id},orderBy:{code:"asc"}}),
 db.workRecord.findMany({where:{employee:{companyId:company.id},workedDate:{gte:new Date(`${period}-01`),lte:new Date(recurringDue(period,0))},...(q.project?{projectId:q.project}:{}),...(q.employee?{employeeId:q.employee}:{}),...(q.cancelled==="1"?{}:{voidedAt:null})},include:{employee:true,project:true},orderBy:[{workedDate:"asc"},{id:"asc"}],take:500}),q.edit?db.workRecord.findFirst({where:{id:q.edit,employee:{companyId:company.id}},include:{employee:true}}):null]);
 if(q.edit&&!selected)notFound();
 return <><h1>현장 출역·공수</h1><p className="erp-page-description">실제 지급 일당을 작업일의 근로계약에서 적용합니다. 저장 시 공수·일당·금액을 보존하며 신고용 노무대장과 구분합니다.</p>{q.saved&&<p role="status">인력 자료를 저장했습니다.</p>}{error&&<p role="alert">{error}</p>}
 {selected&&<div className="my-3" data-erp-report-exclude><DocumentLink type="WORK" id={selected.id}/></div>}
 <div data-erp-report-exclude><Section title="출역 조회"><form className="flex flex-wrap items-end gap-3"><Field label="출역 조회월" name="period" type="month" defaultValue={period}/><Select label="출역 조회 현장" name="project" defaultValue={q.project??""}><option value="">전체 현장</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select><Select label="출역 조회 직원" name="employee" defaultValue={q.employee??""}><option value="">전체 직원</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select><label><input type="checkbox" name="cancelled" value="1" defaultChecked={q.cancelled==="1"}/>취소 포함</label><button className="erp-button">조회</button><Link className="erp-row-action" href={`/payroll-review?period=${period}`}>직원별 월 합산 확인</Link><Link className="erp-row-action" href="/employees">직원·계약 관리</Link></form></Section></div>
 <div className="mt-4 erp-ledger-layout"><Section title={`${period} 출역 내역`} description="조회 결과 최대 500건입니다. 월별 급여 검토의 합계는 해당 월 전체 내역을 사용합니다."><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>작업일</th><th>직원</th><th>현장</th><th>구분</th><th>공수</th><th>실지급 일당</th><th>계산 지급액</th><th>원본 메모</th><th>상태</th><th>처리</th></tr></thead><tbody>{records.map(r=><tr key={r.id}><td>{r.workedDate.toISOString().slice(0,10)}</td><td>{r.employee.code} · {r.employee.name}</td><td>{r.project.name}</td><td>{LABOR_ROLES[r.role]}</td><td>{r.units.toFixed(2)}</td><td>{BigInt(r.rateAmount.toFixed(0)).toLocaleString()}원</td><td>{BigInt(r.amount.toFixed(0)).toLocaleString()}원</td><td>{r.source}</td><td>{r.voidedAt?"취소":"사용"}</td><td>{!r.voidedAt&&<Link className="erp-row-action" href={`/work-records?period=${period}&edit=${r.id}`}>출역 수정</Link>}</td></tr>)}</tbody></table></div></Section>
 <div data-erp-report-exclude><Section title={selected?`${selected.employee.name} 출역 수정`:"출역 등록"}>{selected?.voidedAt?<p>취소된 출역입니다. {selected.voidReason}</p>:<><WorkRecordForm key={`${selected?.id??"new"}:${selected?.version??0}`} action={saveWorkAction} people={people.filter(p=>p.active||p.id===selected?.employeeId).map(p=>({id:p.id,code:p.code,name:p.name,rates:p.rates.map(r=>({effectiveDate:r.effectiveDate.toISOString().slice(0,10),role:r.role,amount:r.amount.toFixed(0)}))}))} projects={projects.map(p=>({id:p.id,code:p.code,name:p.name}))} requestId={randomUUID()} today={koreanToday()} record={selected?{id:selected.id,employeeId:selected.employeeId,projectId:selected.projectId,workedDate:selected.workedDate.toISOString().slice(0,10),role:selected.role,units:selected.units.toFixed(2),source:selected.source,version:selected.version}:undefined}/>{selected&&<details className="mt-4"><summary>이 출역 취소</summary><RecordForm action={voidWorkAction} label="출역 취소 저장"><input type="hidden" name="employeeId" value={selected.employeeId}/><input type="hidden" name="workId" value={selected.id}/><input type="hidden" name="version" value={selected.version}/><input type="hidden" name="requestId" value={randomUUID()}/><Field label="출역 취소 사유" name="reason" required maxLength={300}/></RecordForm></details>}</>}</Section></div></div></>;
}
export default function Page(props:{searchParams:Promise<Query>}){return<Suspense fallback={<p>출역을 불러오는 중입니다.</p>}><Content {...props}/></Suspense>;}

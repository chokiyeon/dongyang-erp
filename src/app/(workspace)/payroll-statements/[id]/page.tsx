import {PayrollSlip} from "@/components/payroll-slip";
import {PayrollSlipPreview} from "@/components/payroll-slip-preview";
import {Suspense} from "react";
import Link from "next/link";
import {notFound} from "next/navigation";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {loadPayrollSlip} from "@/lib/payroll-slip-data";
import {won} from "@/lib/cash";
import {Section} from "@/components/fields";
async function Content({params}:{params:Promise<{id:string}>}){
 await requireAdmin();const company=await requireCompany();const{id}=await params;const db=getDb();
 const loaded=await loadPayrollSlip(db,company,id);if(!loaded)notFound();const{payment,statement,issues,slip,projects}=loaded;const employee=payment.employee;const projectLabel=(id:string)=>{const p=projects.find(p=>p.id===id);return p?`${p.code} · ${p.name}`:"현장명 확인 필요";};
 return <><h1>급여명세서 · 검토용</h1><p className="erp-page-description">직원별 A4 세로 명세서입니다. 지급·공제를 나란히 표시하고 실수령액을 아래에 모았습니다.</p><div className="mb-4 flex flex-wrap gap-2" data-erp-report-exclude><PayrollSlipPreview name={employee.name} period={payment.period}><PayrollSlip data={slip}/></PayrollSlipPreview><a className="erp-button erp-button-excel" data-payroll-slip-excel href={`/api/payroll-statements/${payment.id}`}>명세서 엑셀 한 장 저장</a><Link className="erp-row-action" href={`/payroll-payments?period=${payment.period}&employee=${employee.id}`}>급여 확인·정정</Link><Link className="erp-row-action" href={`/payroll-review?period=${payment.period}`}>급여대장</Link></div>{issues.length>0&&<div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-4"><strong>재검토 대상</strong>{issues.map(issue=><p key={issue}>{issue}</p>)}</div>}
 <PayrollSlip data={slip}/>
 <details className="mt-5" data-erp-report-exclude><summary className="cursor-pointer text-sm font-semibold">상세 출역·지급 이력 펼치기</summary>
 {statement.lines.length>0&&<div className="mt-4"><Section title="저장 당시 출역 상세"><table data-erp-report-title="일용직 저장 출역 내역"><thead><tr><th>작업일</th><th>현장</th><th>작업 구분</th><th>공수</th><th>실지급 일당</th><th>계산 지급액</th></tr></thead><tbody>{statement.lines.map((row,index)=><tr key={index}><td>{row.date}</td><td>{projectLabel(row.projectId)}</td><td>{row.role==="SIGNAL"?"신호수":"일반"}</td><td>{row.units}</td><td>{won(BigInt(row.rate))}</td><td>{won(BigInt(row.amount))}</td></tr>)}</tbody></table></Section></div>}
 <div className="mt-4"><Section title="실제 지급 내역"><table><thead><tr><th>처리일</th><th>처리 구분</th><th>금액</th><th>상태</th></tr></thead><tbody>{payment.cashPlan.settlements.map(row=><tr key={row.id}><td>{row.processedDate.toISOString().slice(0,10)}</td><td>{row.bankTransactionId?"은행 거래 연결":"수기 처리"}</td><td>{won(BigInt(row.amount.toFixed(0)))}</td><td>{row.voidedAt?"취소 · 합계 제외":"유효"}</td></tr>)}</tbody></table></Section></div></details></>;
}
export default function Page(props:{params:Promise<{id:string}>}){return <Suspense fallback={<p>직원별 급여명세서를 준비하는 중입니다.</p>}><Content {...props}/></Suspense>;}

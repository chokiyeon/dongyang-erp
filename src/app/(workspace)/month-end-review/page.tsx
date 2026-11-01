import {Suspense} from "react";
import Link from "next/link";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {koreanToday} from "@/lib/forecast";
import {paymentMonth} from "@/lib/payment-terms";
import {loadMonthEndReview} from "@/lib/month-end-review";
async function Content({searchParams}:{searchParams:Promise<{period?:string}>}){
 await requireAdmin();const company=await requireCompany();const q=await searchParams;let period=q.period??koreanToday().slice(0,7),error="";
 try{paymentMonth(period);}catch{period=koreanToday().slice(0,7);error="조회월을 확인하세요.";}
 const{checks,latest}=await loadMonthEndReview(getDb(),company.id,period);const remaining=checks.filter(c=>c.count>0).length;
 return <><h1>월말 경리 마감 점검</h1><p className="erp-page-description">장부·증빙·급여·송금의 남은 작업을 월별로 확인합니다. 등록 자료 기준 점검이며 은행 원본·세금계산서·출역표의 누락 여부는 별도로 대조해야 합니다.</p>{error&&<p role="alert">{error}</p>}<form className="my-4 flex items-end gap-3" data-erp-report-exclude><label>마감 점검월<input aria-label="마감 점검월" className="block border p-2" name="period" type="month" defaultValue={period}/></label><button className="erp-button">점검월 조회</button></form><p className="my-4 font-semibold">{period} · 확인할 항목 {remaining}/{checks.length}개 · 항목별 건수는 중복될 수 있습니다.</p><div className="overflow-x-auto"><table className="erp-table" data-erp-report-title="월말 경리 점검표"><thead><tr><th>점검 항목</th><th>대상 건수</th><th>확인 내용</th><th>처리</th></tr></thead><tbody>{checks.map(c=><tr key={c.key}><td>{c.title}</td><td><span className={`erp-badge ${c.count?"erp-badge-red":""}`}>{c.count}건</span></td><td>{c.description}</td><td><Link className="erp-row-action" href={c.href}>자료 확인</Link></td></tr>)}</tbody></table></div><div className="my-5 rounded border bg-white p-4"><h2 className="font-semibold">마감 전 마지막 대조</h2><p className="my-2">각 은행의 월말 잔액과 거래 누락, 어음 만기, 급여 신고자료·회사 부담금, 다음 3~6개월 입출금 예정을 확인하세요. 점검 건수가 0이어도 세무 신고나 장부 마감이 완료된 것은 아닙니다.</p><div className="flex flex-wrap gap-3"><Link className="erp-row-action" href="/accounts">계좌·한도</Link><Link className="erp-row-action" href="/issued-notes">발행어음</Link><Link className="erp-row-action" href="/received-notes">수취어음</Link><Link className="erp-row-action" href={`/payroll-statements?period=${period}`}>급여명세서 검토</Link><Link className="erp-row-action" href="/forecast">예산안</Link></div></div><p>최근 회계 전달본: {latest?`${latest.revision}차 · ${{DRAFT:"정리 중",DELIVERED:"전달 완료",CLOSED:"전달본 마감"}[latest.state]??latest.state}`:"없음"}</p><Link className="erp-button erp-button-primary mt-3 inline-block" href={`/accounting-delivery?period=${period}`}>회계 전달·인수인계 자료 확인</Link><p className="mt-3 text-sm">이 화면은 원본을 변경하거나 회계 기간을 잠그지 않습니다. 회계 전달본이 생성된 뒤 원본이 바뀌었는지는 전달 화면에서 다시 확인합니다.</p></>;
}
export default function Page(props:{searchParams:Promise<{period?:string}>}){return <Suspense fallback={<p>월말 점검 자료를 확인하고 있습니다.</p>}><Content {...props}/></Suspense>;}

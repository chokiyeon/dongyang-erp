import {Suspense} from "react";
import Link from "next/link";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {paymentMonth} from "@/lib/payment-terms";
import {koreanToday} from "@/lib/forecast";
import {loadPayrollSlip} from "@/lib/payroll-slip-data";
import {PayrollSlipBatch} from "@/components/payroll-slip-batch";
async function Content({searchParams}:{searchParams:Promise<{period?:string;kind?:string}>}){
 await requireAdmin();const company=await requireCompany();const q=await searchParams;let period=q.period??koreanToday().slice(0,7);let error="";
 try{paymentMonth(period);}catch{error="조회월을 YYYY-MM 형식으로 입력하세요.";period=koreanToday().slice(0,7);}
 const kind=q.kind==="MONTHLY"?"MONTHLY":"DAILY";
 const db=getDb();
 const records=await db.payrollPayment.findMany({where:{period,voidedAt:null,employee:{companyId:company.id,kind}},include:{employee:{select:{name:true,code:true}}},orderBy:{employee:{code:"asc"}}});
 const rows=[];
 // Keep database concurrency bounded when preparing a month with many employees.
 for(let offset=0;offset<records.length;offset+=4){
  const batch=await Promise.all(records.slice(offset,offset+4).map(async row=>{
   const loaded=await loadPayrollSlip(db,company,row.id);
   return{id:row.id,employeeId:row.employeeId,name:row.employee.name,code:row.employee.code,dueDate:row.dueDate.toISOString().slice(0,10),net:row.netAmount.toFixed(0),issues:loaded?.issues??["명세서가 변경되었거나 삭제되었습니다. 다시 조회하세요."]};
  }));rows.push(...batch);
 }
 return <><h1>급여명세서 모아 저장</h1><p className="erp-page-description">상용직·일용직을 나누어 직원별 JPG를 ZIP으로 저장합니다. 한 번에 최대 30명을 선택할 수 있습니다. 재검토가 필요한 명세서는 먼저 정정해야 합니다.</p>{error&&<p role="alert">{error}</p>}<form className="my-4 flex flex-wrap items-end gap-3" data-erp-report-exclude><label>명세서 조회월<input className="block border p-2" aria-label="명세서 조회월" name="period" type="month" defaultValue={period}/></label><label>급여 구분<select className="block border p-2" aria-label="명세서 급여 구분" name="kind" defaultValue={kind}><option value="DAILY">일용직</option><option value="MONTHLY">상용직</option></select></label><button className="erp-button">명세서 조회</button><Link className="erp-row-action" href={`/payroll-payments?period=${period}`}>급여 지급 확인·정정</Link></form><PayrollSlipBatch key={`${period}:${kind}`} period={period} rows={rows}/></>;
}
export default function Page(props:{searchParams:Promise<{period?:string;kind?:string}>}){return <Suspense fallback={<p>급여명세서를 조회하고 있습니다.</p>}><Content {...props}/></Suspense>;}

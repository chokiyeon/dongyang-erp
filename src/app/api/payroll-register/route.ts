import {NextResponse} from "next/server";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {paymentMonth} from "@/lib/payment-terms";
import {InputError} from "@/lib/validation";
import {laborMonth} from "@/lib/labor";
import {payrollBasis} from "@/lib/payroll";
import {payrollWorkbook} from "@/lib/payroll-export";
export async function GET(request:Request){
 await requireAdmin();const company=await requireCompany();const q=new URL(request.url).searchParams;const period=q.get("period")??"";const kind=q.get("kind");
 try{paymentMonth(period);if(kind!=="MONTHLY"&&kind!=="DAILY")throw new InputError("상용직/일용직 구분을 확인하세요.");}catch(e){return NextResponse.json({error:e instanceof InputError?e.message:"조회 조건을 확인하세요."},{status:400,headers:{"Cache-Control":"private, no-store"}});}
 const {data,payments,bases}=await getDb().$transaction(async tx=>{const data=await laborMonth(tx,period);const payments=await tx.payrollPayment.findMany({where:{employee:{companyId:company.id},period,voidedAt:null},include:{cashPlan:{include:{settlements:true}}}});const ids=new Set([...data.daily,...data.monthly].map(row=>row.employee.id));const bases=await Promise.all(payments.filter(p=>ids.has(p.employeeId)).map(p=>payrollBasis(tx,period,p.employeeId,data)));return{data,payments,bases};},{isolationLevel:"RepeatableRead",timeout:30000});
 const bytes=await payrollWorkbook(company.name,data,payments,bases,kind as "MONTHLY"|"DAILY");return new NextResponse(bytes,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="payroll-${kind.toLowerCase()}-${period}.xlsx"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

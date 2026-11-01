import {NextResponse} from "next/server";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {loadPayrollSlip} from "@/lib/payroll-slip-data";
import {payrollSlipWorkbook} from "@/lib/payroll-slip-export";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){await requireAdmin();const company=await requireCompany();const{id}=await params;const loaded=await loadPayrollSlip(getDb(),company,id);if(!loaded)return NextResponse.json({error:"급여명세서를 찾을 수 없습니다."},{status:404,headers:{"Cache-Control":"private, no-store"}});const bytes=await payrollSlipWorkbook(loaded.slip);return new NextResponse(bytes,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="payslip-${loaded.payment.period}.xlsx"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}

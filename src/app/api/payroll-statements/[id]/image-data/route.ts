import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {loadPayrollSlip} from "@/lib/payroll-slip-data";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 await requireAdmin();const company=await requireCompany();const{id}=await params;
 const loaded=await loadPayrollSlip(getDb(),company,id);
 const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
 if(!loaded)return Response.json({error:"명세서를 찾을 수 없습니다."},{status:404,headers});
 if(loaded.payment.voidedAt||loaded.issues.length)return Response.json({error:"급여 확인·정정 화면에서 재검토를 마친 후 저장하세요."},{status:409,headers});
 return Response.json(loaded.slip,{headers});
}

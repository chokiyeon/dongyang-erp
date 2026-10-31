import {accountingWorkbook} from "@/lib/accounting-export";
import {NextResponse} from "next/server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {COMPANY_ID} from "@/lib/constants";
import type {DeliverySnapshot} from "@/lib/accounting-delivery";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 await requireAdmin();const {id}=await params;const record=await getDb().accountingPackage.findFirst({where:{id,companyId:COMPANY_ID}});if(!record)return NextResponse.json({error:"전달본을 찾을 수 없습니다."},{status:404});const snapshot=record.snapshot as DeliverySnapshot; const buffer=await accountingWorkbook(snapshot,record);return new NextResponse(new Uint8Array(buffer),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="accounting-${record.period}-r${record.revision}.xlsx"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

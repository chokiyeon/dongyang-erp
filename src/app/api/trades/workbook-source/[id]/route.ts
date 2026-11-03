import {createHash} from "node:crypto";
import {NextResponse} from 'next/server';
import {isAuthenticated} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {COMPANY_ID} from '@/lib/constants';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 if(!await isAuthenticated())return NextResponse.json({error:'로그인이 필요합니다.'},{status:401,headers:{'Cache-Control':'no-store'}});
 const {id}=await params;let source=await getDb().tradeWorkbookSource.findFirst({where:{id,document:{companyId:COMPANY_ID},file:{companyId:COMPANY_ID}},select:{file:{select:{content:true,checksum:true}}}});
 if(!source)source=await getDb().tradeCancellation.findFirst({where:{id,companyId:COMPANY_ID,file:{companyId:COMPANY_ID}},select:{file:{select:{content:true,checksum:true}}}});
 if(!source)source=await getDb().tradeReduction.findFirst({where:{id,companyId:COMPANY_ID,file:{companyId:COMPANY_ID}},select:{file:{select:{content:true,checksum:true}}}});
 if(!source)return NextResponse.json({error:'원본이 없습니다.'},{status:404,headers:{'Cache-Control':'no-store'}});
 if(createHash("sha256").update(source.file.content).digest("hex")!==source.file.checksum)return NextResponse.json({error:"보관 원본 무결성 확인이 필요합니다."},{status:409,headers:{"Cache-Control":"no-store"}});
 return new Response(new Uint8Array(source.file.content),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="source.xlsx"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

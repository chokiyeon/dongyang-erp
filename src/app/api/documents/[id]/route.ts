import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {COMPANY_ID} from "@/lib/constants";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 await requireAdmin();const {id}=await params;const file=await getDb().documentAttachment.findFirst({where:{id,companyId:COMPANY_ID},select:{content:true,checksum:true,fileName:true,mediaType:true,size:true}});if(!file)return NextResponse.json({error:"첨부 파일을 찾을 수 없습니다."},{status:404});if(file.content.byteLength!==file.size||createHash("sha256").update(file.content).digest("hex")!==file.checksum)return NextResponse.json({error:"첨부 파일의 보관 상태를 확인해야 합니다."},{status:409});const preview=new URL(request.url).searchParams.get("preview")==="1"&&["image/png","image/jpeg"].includes(file.mediaType);return new NextResponse(new Uint8Array(file.content),{headers:{"Content-Type":file.mediaType,"Content-Length":String(file.size),"Content-Disposition":`${preview?"inline":"attachment"}; filename="document.${file.fileName.split('.').pop()?.toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'","Referrer-Policy":"no-referrer"}});
}

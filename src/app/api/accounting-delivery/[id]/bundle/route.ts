import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {COMPANY_ID} from "@/lib/constants";
import type {DeliverySnapshot} from "@/lib/accounting-delivery";
import {accountingWorkbook} from "@/lib/accounting-export";
import {attachmentParts,bundledName,storedZip} from "@/lib/attachment-bundle";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 await requireAdmin();const {id}=await params;const db=getDb();const record=await db.accountingPackage.findFirst({where:{id,companyId:COMPANY_ID}});if(!record)return NextResponse.json({error:"전달본을 찾을 수 없습니다."},{status:404});const snapshot=record.snapshot as DeliverySnapshot;const manifests=snapshot.attachments??[];const parts=attachmentParts(manifests);const part=Number(new URL(request.url).searchParams.get("part")??"1");if(!Number.isInteger(part)||part<1||part>parts.length)return NextResponse.json({error:"다운로드 묶음을 확인하세요."},{status:400});const files:{name:string;data:Uint8Array}[]=[{name:`accounting-${record.period}-r${record.revision}.xlsx`,data:await accountingWorkbook(snapshot,record)}];const mapping:string[]=["전달본 생성 당시 사용 중인 원본 첨부입니다. 취소한 첨부는 목록에만 표시합니다.","파일명\t보관 원본 파일명\t검증값"];
 for(const meta of parts[part-1]){const file=await db.documentAttachment.findFirst({where:{id:meta.id,companyId:COMPANY_ID},select:{content:true,checksum:true,size:true}});if(!file||file.size!==meta.size||file.checksum!==meta.checksum||createHash("sha256").update(file.content).digest("hex")!==meta.checksum)return NextResponse.json({error:"보관 당시 첨부 파일의 무결성을 확인하지 못했습니다. 원본을 확인하세요."},{status:409});const name=bundledName(meta,manifests.findIndex(f=>f.id===meta.id));files.push({name,data:file.content});mapping.push(`${name}\t${meta.fileName}\t${meta.checksum}`);}
 files.push({name:"attachment-manifest.txt",data:Buffer.from(mapping.join("\n"),"utf8")});const zip=storedZip(files);return new NextResponse(new Uint8Array(zip),{headers:{"Content-Type":"application/zip","Content-Disposition":`attachment; filename="accounting-${record.period}-r${record.revision}-part${part}.zip"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

import {NextResponse} from "next/server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {uploadDocument} from "@/lib/documents";
import {DOCUMENT_MAX_BYTES} from "@/lib/document-types";
import {InputError} from "@/lib/validation";
export async function POST(request:Request){
 await requireAdmin();try{
  const origin=request.headers.get("origin");if(origin&&new URL(origin).host!==(request.headers.get("host")??new URL(request.url).host))return NextResponse.json({error:"같은 ERP 화면에서 첨부하세요."},{status:403});
  const limit=DOCUMENT_MAX_BYTES+128*1024;const declared=request.headers.get("content-length");if(declared&&Number(declared)>limit)return NextResponse.json({error:"첨부 파일은 10MB 이하로 선택하세요."},{status:413});if(!request.headers.get("content-type")?.startsWith("multipart/form-data;"))throw new InputError("파일 첨부 양식을 사용하세요.");const reader=request.body?.getReader();if(!reader)throw new InputError("첨부할 파일이 없습니다.");const chunks:Uint8Array[]=[];let bytes=0;try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>limit){await reader.cancel();return NextResponse.json({error:"첨부 파일은 10MB 이하로 선택하세요."},{status:413});}chunks.push(r.value);}}finally{reader.releaseLock();}
  const body=Buffer.concat(chunks);const data=await new Response(body,{headers:{"content-type":request.headers.get("content-type")!}}).formData();const file=data.get("file");if(!(file instanceof File)||data.getAll("file").length!==1)throw new InputError("한 번에 파일 하나를 선택하세요.");if(file.size>DOCUMENT_MAX_BYTES)return NextResponse.json({error:"첨부 파일은 10MB 이하로 선택하세요."},{status:413});const content=new Uint8Array(await file.arrayBuffer());const saved=await getDb().$transaction(tx=>uploadDocument(tx,data,file.name,content),{timeout:20000});return NextResponse.json({id:saved.id,fileName:saved.fileName},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return NextResponse.json({error:e instanceof InputError?e.message:"첨부 파일을 저장하지 못했습니다. 형식과 연결 원본을 다시 확인하세요."},{status:e instanceof InputError?400:500,headers:{"Cache-Control":"no-store"}});}
}

import {preparePaidCancellation,registerPaidCancellation} from "@/lib/trade-paid-cancellations";
import {prepareTradeReduction,registerTradeReduction} from "@/lib/trade-reductions";
import {createHash} from "node:crypto";
import {prepareTradeCancellation,registerTradeCancellation} from "@/lib/trade-cancellations";
import {NextResponse} from 'next/server';
import {isAuthenticated} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {prepareTradeWorkbookBatch,importTradeWorkbookBatch,prepareTradeWorkbookImport,importTradeWorkbookRow} from '@/lib/trade-workbook-import';
import {DOCUMENT_MAX_BYTES} from '@/lib/document-types';
import {InputError} from '@/lib/validation';
import {revalidatePath} from 'next/cache';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(!await isAuthenticated())return reply({error:'로그인 후 다시 이관하세요.'},401);
 try{
  const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==(request.headers.get('host')??new URL(request.url).host))return reply({error:'같은 ERP 화면에서 이관하세요.'},403);
  const contentType=request.headers.get('content-type');if(!contentType?.startsWith('multipart/form-data;'))throw new InputError('원본 파일과 이관할 행을 선택하세요.');
  const reader=request.body?.getReader();if(!reader)throw new InputError('원본 파일이 없습니다.');let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>DOCUMENT_MAX_BYTES+128*1024){await reader.cancel();return reply({error:'10MB 이하 원본을 선택하세요.'},413);}chunks.push(part.value);}}finally{reader.releaseLock();}
  const data=await new Response(Buffer.concat(chunks),{headers:{'content-type':contentType}}).formData(),file=data.get('file');if(!(file instanceof File)||data.getAll('file').length!==1)throw new InputError('원본 파일 하나를 선택하세요.');
  const content=new Uint8Array(await file.arrayBuffer()),expected=data.get('fileHash');if(expected!==null&&(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||createHash('sha256').update(content).digest('hex')!==expected))throw new InputError('검토한 원본과 파일이 달라졌습니다. 파일을 다시 선택해 검토하세요.');
  if(data.get('operation')==='REDUCTION'){const source=await prepareTradeReduction(data,file.name,content);const saved=await getDb().$transaction(tx=>registerTradeReduction(tx,source),{timeout:20000});revalidatePath('/','layout');return reply(saved);}
  if(data.get('operation')==='BATCH'){const prepared=await prepareTradeWorkbookBatch(data,file.name,content);const results=await getDb().$transaction(tx=>importTradeWorkbookBatch(tx,prepared),{timeout:60000});revalidatePath('/','layout');return reply({results,checksum:prepared[0].checksum});}
  if(data.get('operation')==='PAID_CANCEL'){const source=await preparePaidCancellation(data,file.name,content);const saved=await getDb().$transaction(tx=>registerPaidCancellation(tx,source),{timeout:20000});revalidatePath('/','layout');return reply(saved);}
  if(data.get('operation')==='CANCEL'){const source=await prepareTradeCancellation(data,file.name,content);const saved=await getDb().$transaction(tx=>registerTradeCancellation(tx,source),{timeout:20000});revalidatePath('/','layout');return reply(saved);}
  const prepared=await prepareTradeWorkbookImport(data,file.name,content);const saved=await getDb().$transaction(tx=>importTradeWorkbookRow(tx,prepared),{timeout:20000});revalidatePath('/','layout');return reply(saved);
 }catch(e){return reply({error:e instanceof InputError?e.message:e&&typeof e==='object'&&'code'in e&&e.code==='P2002'?'이미 이관한 원본 행·승인번호·관리번호입니다. 기존 문서를 확인하세요.':'원본을 이관하지 못했습니다. 기존 자료를 확인하고 다시 시도하세요.'},e instanceof InputError||e&&typeof e==='object'&&'code'in e&&e.code==='P2002'?400:500);}
}

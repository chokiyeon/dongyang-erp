import {NextResponse} from 'next/server';
import {isAuthenticated} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {findExistingWorkbookTrades} from '@/lib/trade-workbook-existing';
import {InputError} from '@/lib/validation';
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(!await isAuthenticated())return response({error:'로그인 후 다시 대조하세요.'},401);
 try{
  const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==(request.headers.get('host')??new URL(request.url).host))return response({error:'같은 ERP 화면에서 대조하세요.'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'승인번호 대조 요청 형식을 확인하세요.'},415);
  const limit=64*1024,reader=request.body?.getReader();if(!reader)throw new InputError('대조할 승인번호가 없습니다.');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>limit){await reader.cancel();return response({error:'대조 요청 크기를 줄여 주세요.'},413);}chunks.push(item.value);}}finally{reader.releaseLock();}
  let data:unknown;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new InputError('대조 요청을 확인하세요.');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new InputError('승인번호 목록을 확인하세요.');
  const documents=await findExistingWorkbookTrades(getDb(),(data as {approvals?:unknown}).approvals);return response({documents,checkedAt:new Date().toISOString()});
 }catch(e){return response({error:e instanceof InputError?e.message:'기존 ERP 자료를 대조하지 못했습니다. 다시 시도하세요.'},e instanceof InputError?400:500);}
}

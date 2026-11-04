import {laterCancellationCandidates} from "@/lib/trade-later-cancellations";
import {paidCancellationCandidates} from "@/lib/trade-paid-cancellations";
import {reductionCandidates} from "@/lib/trade-reductions";
import {NextResponse} from 'next/server';
import {isAuthenticated} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {replacementCandidates,cancellationCandidates} from '@/lib/trade-cancellations';
import {InputError} from '@/lib/validation';
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(!await isAuthenticated())return reply({error:'로그인 후 조회하세요.'},401);
 try{
 const origin=request.headers.get('origin');if(origin&&new URL(origin).host!==(request.headers.get('host')??new URL(request.url).host))return reply({error:'같은 ERP 화면에서 조회하세요.'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new InputError('조회 형식을 확인하세요.');const reader=request.body?.getReader();if(!reader)throw new InputError('조회 자료가 없습니다.');const chunks:Uint8Array[]=[];let size=0;try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();return reply({error:'조회 요청이 너무 큽니다.'},413);}chunks.push(part.value);}}finally{reader.releaseLock();}
 const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!raw||typeof raw!=='object'||!['kind','date','gross','supply','tax','businessNumber'].every(k=>typeof raw[k]==='string'&&raw[k].length<=80))throw new InputError('수정증빙 행을 다시 선택하세요.');
 if(raw.mode==='LATER_PAID_CANCEL')return reply({documents:await paidCancellationCandidates(getDb(),{kind:raw.kind,date:raw.date,gross:raw.gross,supply:raw.supply,tax:raw.tax,businessNumber:raw.businessNumber},'LATER')});
 if(raw.mode==='LATER_CANCEL')return reply({documents:await laterCancellationCandidates(getDb(),{kind:raw.kind,date:raw.date,gross:raw.gross,supply:raw.supply,tax:raw.tax,businessNumber:raw.businessNumber})});
 if(raw.mode==='PAID_CANCEL')return reply({documents:await paidCancellationCandidates(getDb(),{kind:raw.kind,date:raw.date,gross:raw.gross,supply:raw.supply,tax:raw.tax,businessNumber:raw.businessNumber})});
 if(raw.mode==='REDUCTION')return reply({documents:await reductionCandidates(getDb(),{kind:raw.kind,date:raw.date,gross:raw.gross,supply:raw.supply,tax:raw.tax,businessNumber:raw.businessNumber})});
 if(raw.mode==='REISSUE')return reply({documents:await replacementCandidates(getDb(),{kind:raw.kind,date:raw.date,businessNumber:raw.businessNumber})});
 return reply({documents:await cancellationCandidates(getDb(),{kind:raw.kind,date:raw.date,gross:raw.gross,supply:raw.supply,tax:raw.tax,businessNumber:raw.businessNumber})});
 }catch(e){return reply({error:e instanceof InputError?e.message:'취소 원본 후보를 조회하지 못했습니다.'},e instanceof InputError||e instanceof SyntaxError?400:500);}
}

import {NextResponse} from 'next/server';
import {isAuthenticated} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {COMPANY_ID} from '@/lib/constants';
export async function GET(request:Request){
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!await isAuthenticated())return reply({error:'로그인 후 반품을 조회하세요.'},401);
 const id=new URL(request.url).searchParams.get('document')??'';if(!id||id.length>50)return reply({error:'원본 청구를 선택하세요.'},400);
 const db=getDb();if(!await db.tradeDocument.findFirst({where:{id,companyId:COMPANY_ID,kind:'PURCHASE',voidedAt:null},select:{id:true}}))return reply({returns:[]});
 const rows=await db.stockMovement.findMany({where:{documentId:id,material:{companyId:COMPANY_ID},kind:{in:['RETURN','VALUE_CREDIT']},voidedAt:null,reductionId:null,cancellationId:null},include:{material:{select:{name:true,unit:true}},returnOf:{select:{reference:true}}},orderBy:[{movedDate:'asc'},{sequence:'asc'}],take:101});
 if(rows.length>100)return reply({error:'대조할 반품이 많습니다. 입고·반품 내역을 먼저 정리하세요.'},400);
 return reply({returns:rows.map(r=>({id:r.id,kind:r.kind,reference:r.reference,date:r.movedDate.toISOString().slice(0,10),material:r.material.name,unit:r.material.unit,quantity:r.quantity.toFixed(4),supply:r.supplyAmount?.toFixed(0)??'0',receipt:r.returnOf?.reference??''}))});
}

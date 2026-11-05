import {creditVehicleCost} from '@/lib/trade-vehicle-settlement';
import {NextResponse} from 'next/server';
import {isAuthenticated} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {creditCostAllocation} from '@/lib/trade-cost-settlement';
export async function GET(request:Request){
 const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(!await isAuthenticated())return reply({error:'로그인 후 원가 배부를 조회하세요.'},401);
 const id=new URL(request.url).searchParams.get('document')??'';if(!id||id.length>50)return reply({error:'원본 청구를 선택하세요.'},400);
 const db=getDb(),[allocation,vehicle]=await Promise.all([creditCostAllocation(db,id),creditVehicleCost(db,id)]);return reply({allocation,vehicle});
}

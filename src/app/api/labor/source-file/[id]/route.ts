import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {isAuthenticated} from '@/lib/auth';
import {getDb} from '@/lib/db';
import {COMPANY_ID} from '@/lib/constants';
export async function GET(_r:Request,{params}:{params:Promise<{id:string}>}){if(!await isAuthenticated())return NextResponse.json({error:'로그인이 필요합니다.'},{status:401});const {id}=await params,file=await getDb().laborImportFile.findFirst({where:{id,companyId:COMPANY_ID}});if(!file)return NextResponse.json({error:'원본이 없습니다.'},{status:404});if(createHash('sha256').update(file.content).digest('hex')!==file.checksum)return NextResponse.json({error:'보관 원본 무결성 확인이 필요합니다.'},{status:409});const ext=file.fileName.split('.').pop()?.toLowerCase()??'bin';return new Response(new Uint8Array(file.content),{headers:{'Content-Type':file.mediaType,'Content-Disposition':`attachment; filename="work.${ext}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}

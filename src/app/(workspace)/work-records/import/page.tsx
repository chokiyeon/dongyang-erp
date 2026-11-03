import {Suspense} from 'react';
import {requireAdmin} from '@/lib/auth';
import {requireCompany} from '@/lib/company';
import {getDb} from '@/lib/db';
import {LaborSourceImport} from '@/components/labor-source-import';
async function Content(){await requireAdmin();const company=await requireCompany(),db=getDb();const[people,projects]=await Promise.all([db.employee.findMany({where:{companyId:company.id,active:true},select:{id:true,code:true,name:true,kind:true,version:true},orderBy:{code:'asc'}}),db.project.findMany({where:{companyId:company.id,active:true},select:{id:true,code:true,name:true},orderBy:{code:'asc'}})]);return <><h1>현장 근무자료 읽기·급여대장 적용</h1><p className="erp-page-description">현장 노임대장의 XLS/XLSX는 날짜별 공수와 지급·공제 내역을 읽습니다. 사진/스캔 PDF는 글자 인식 후 원본과 직접 대조합니다. 직원·현장·작업 구분을 확인한 공수만 등록하며 급여 검토에서 지급·공제를 확인한 뒤 확정합니다.</p><LaborSourceImport people={people} projects={projects}/></>;}
export default function Page(){return <Suspense fallback={<p>근무자료 검토 화면을 준비하고 있습니다.</p>}><Content/></Suspense>;}

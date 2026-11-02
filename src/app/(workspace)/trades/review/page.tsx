import {Suspense} from "react";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import {requireAdmin} from "@/lib/auth";
import {TradeWorkbookReviewForm} from "@/components/trade-workbook-review";
import {Section} from "@/components/fields";
async function Content(){await requireAdmin();const company=await requireCompany(),db=getDb();const [partners,projects]=await Promise.all([db.partner.findMany({where:{companyId:company.id,active:true},select:{id:true,name:true,type:true,businessNumber:true,paymentTerm:true,paymentMethod:true},orderBy:{name:"asc"}}),db.project.findMany({where:{companyId:company.id,active:true},select:{id:true,code:true,name:true},orderBy:{code:"asc"}})]);return <><h1>매입매출 엑셀 검토</h1><Section title="원본 검토·중복 확인" description="등록 전에 원본 전체·월별 시트의 중복과 수정·음수·계산 오류를 구분합니다."><TradeWorkbookReviewForm partners={partners} projects={projects}/></Section></>;}
export default function Page(){return <Suspense fallback={<p>검토 화면을 불러오는 중입니다.</p>}><Content/></Suspense>;}

import {Suspense} from "react";
import {requireAdmin} from "@/lib/auth";
import {TradeWorkbookReviewForm} from "@/components/trade-workbook-review";
import {Section} from "@/components/fields";
async function Content(){await requireAdmin();return <><h1>매입매출 엑셀 검토</h1><Section title="원본 검토·중복 확인" description="등록 전에 원본 전체·월별 시트의 중복과 수정·음수·계산 오류를 구분합니다."><TradeWorkbookReviewForm/></Section></>;}
export default function Page(){return <Suspense fallback={<p>검토 화면을 불러오는 중입니다.</p>}><Content/></Suspense>;}

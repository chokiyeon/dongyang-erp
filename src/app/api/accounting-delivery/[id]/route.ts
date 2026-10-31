import ExcelJS from "exceljs";
import {NextResponse} from "next/server";
import {requireAdmin} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {COMPANY_ID} from "@/lib/constants";
import type {DeliverySnapshot} from "@/lib/accounting-delivery";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 await requireAdmin();const {id}=await params;const record=await getDb().accountingPackage.findFirst({where:{id,companyId:COMPANY_ID}});if(!record)return NextResponse.json({error:"전달본을 찾을 수 없습니다."},{status:404});const snapshot=record.snapshot as DeliverySnapshot;const workbook=new ExcelJS.Workbook();const info=workbook.addWorksheet("전달본 안내");info.addRows([["회사",snapshot.company],["대상월",snapshot.period],["차수",String(record.revision)],["상태",({DRAFT:"정리 중",DELIVERED:"전달 완료",CLOSED:"전달본 마감"} as Record<string,string>)[record.state]],["생성시각",record.createdAt.toISOString()],["원본 지문",record.digest],["검토사항",snapshot.issues.join(" / ")||"원본 누락 별도 확인"],["안내","생성 당시 보관본. 급여 실지급액은 노무 신고금액·총 노무원가가 아닙니다. 은행·매입·급여·차량·재고의 같은 지출을 중복 합산하지 마세요."]]);info.columns=[{width:20},{width:100}];
 for(const t of snapshot.tables){const sheet=workbook.addWorksheet(t.title.slice(0,31));sheet.addRow(t.headers);for(const row of t.rows)sheet.addRow(row.map((value,i)=>/금액|가액|부가세|총액|지급액|수금액|할인료|순입금|총원가|공통액|세액|과세표준|추정액|잔액/.test(t.headers[i])&&/^-?\d{1,15}$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):value));sheet.getRow(1).font={bold:true};sheet.columns.forEach(c=>c.width=23);sheet.views=[{state:"frozen",ySplit:1}];}
 const buffer=await workbook.xlsx.writeBuffer();return new NextResponse(new Uint8Array(buffer),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="accounting-${record.period}-r${record.revision}.xlsx"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}

import ExcelJS from "exceljs";
import type {PayrollSlipData} from "@/components/payroll-slip";
import {payrollExcelMoney} from "./payroll-export";
export async function payrollSlipWorkbook(d:PayrollSlipData){
 const book=new ExcelJS.Workbook();book.creator="동양 ERP";const sheet=book.addWorksheet("임금명세서");sheet.columns=[{width:27},{width:23},{width:27},{width:23}];
 const money=(value:string|null)=>value===null?"미확인":payrollExcelMoney(value);
 sheet.mergeCells("A1:D1");sheet.getCell("A1").value=`${d.period} 임 금 명 세 서`;sheet.getRow(1).height=36;
 sheet.addRow(["귀속월",d.period,"급여 구분",`${d.kind} · 검토용`]);sheet.addRow(["성명",d.employee,"지급예정일",d.dueDate]);sheet.addRow(["직원 코드",d.code,"수취계좌",d.account]);sheet.addRow(d.daily?["산정 기간",`${d.period} 1일~말일`,"계산 기준","확인 일당 × 공수 − 공제합계"]:["일수·공수",d.units,"단가 (시급·일당)",d.rate]);sheet.addRow([d.daily?"지급 항목":"지급·수당 항목","금액","공제 항목","금액"]);
 for(let i=0;i<Math.max(d.earnings.length,d.deductions.length);i++){const e=d.earnings[i],c=d.deductions[i];sheet.addRow([e?.label??"",e?(e.display??money(e.amount)):null,c?.label??"",c?money(c.amount):null]);}
 sheet.addRow([d.daily?"지급합계액":"지급항목 합계",money(d.earningTotal),d.daily?"공제액":"공제합계 (근태 포함)",money(d.deductionTotal)]);
 sheet.addRow(d.daily?["실지급액 산식","지급총액 − 공제합계",d.dailyCalculationConfirmed?"실 수령액":"기존 확인액 (공제 확인 필요)",money(d.net)]:["연말정산 조정 (+환급 / -추가공제)",money(d.adjustment),"실수령액",money(d.net)]);const netRow=sheet.rowCount;
 sheet.addRow(["실제 지급액",money(d.actual),"남은 지급액",money(d.remaining)]);
 const footer=(value:string,height=30)=>{const row=sheet.addRow([value]);sheet.mergeCells(row.number,1,row.number,4);row.height=height;};
 footer(`지급예정일 ${d.dueDate}`);footer(d.company);const companyRow=sheet.rowCount;
 footer(d.method,36);footer(`조정·산정 근거: ${d.reason}`,42);footer(`검토 상태: ${d.review.join(" / ")||"저장 기준 일치 · 근로시간/수당 산식/공제 근거 원본 대조 필요"}`,42);footer("검토용 명세서입니다. 미확인 항목을 0원으로 가정하지 않습니다. 출력만으로 실제 지급·교부가 완료되는 것은 아닙니다.",36);
 for(let r=1;r<=sheet.rowCount;r++){const row=sheet.getRow(r);if(r>1&&r<netRow+2)row.height=25;for(let c=1;c<=4;c++){const cell=row.getCell(c);cell.font={name:"맑은 고딕",size:r===1?17:r===companyRow?15:10,bold:r===1||r===6||r===netRow||c%2===1};cell.alignment={horizontal:r===1||r===companyRow||r>netRow+1?"center":c%2===0?"right":"center",vertical:"middle",wrapText:true};cell.border={top:{style:"thin",color:{argb:"FF82766D"}},bottom:{style:"thin",color:{argb:"FF82766D"}},left:{style:"thin",color:{argb:"FF82766D"}},right:{style:"thin",color:{argb:"FF82766D"}}};cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:r===companyRow||r===companyRow-1?"FFD5D0FF":r===1?"FFFCE4D6":r>6&&r<=netRow+1&&c%2===0?"FFFBE5D6":c%2===1?"FFFFE699":"FFFFFFFF"}};if(r>6&&r<=netRow+1&&c%2===0)cell.numFmt='#,##0"원"';}}
 for(const[index,row]of d.earnings.entries())if(row.display){const length=[...row.display].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?2:1),0);sheet.getRow(7+index).height=Math.max(25,Math.ceil(length/21)*16);}
 sheet.views=[{state:"frozen",ySplit:6}];sheet.pageSetup={paperSize:9,orientation:"portrait",fitToPage:true,fitToWidth:1,fitToHeight:1,printArea:`A1:D${sheet.rowCount}`,horizontalCentered:true,margins:{left:0.3,right:0.3,top:0.3,bottom:0.3,header:0.1,footer:0.1}};
 return new Uint8Array(await book.xlsx.writeBuffer());
}

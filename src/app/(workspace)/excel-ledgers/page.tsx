import {Suspense} from "react";
import Link from "next/link";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {getDb} from "@/lib/db";
import layouts from "@/lib/original-workbook-layout.json";
import {NOTE_LEDGER_BANKS} from "@/lib/received-note-types";
import {ISSUED_NOTE_STATUSES} from "@/lib/issued-note-types";
const day=(d:Date|null)=>d?.toISOString().slice(0,10)??"";
async function Content({searchParams}:{searchParams:Promise<{sheet?:string;page?:string}>}){
 await requireAdmin();const company=await requireCompany(),db=getDb(),p=await searchParams;
 const sheet=p.sheet&&Object.hasOwn(layouts,p.sheet)?p.sheet as keyof typeof layouts:"SALE";
 const issued=sheet==="ISSUED"||sheet==="ISSUED_DUE",received=sheet.startsWith("BANK_")||sheet==="UNASSIGNED";
 const ledgerBank=sheet==="UNASSIGNED"?null:NOTE_LEDGER_BANKS[Number(sheet.slice(5))];
 const receivedWhere={companyId:company.id,ledgerBank,status:{not:"VOID" as const}};
 const layout=layouts[sheet],parsed=Number(p.page),count=received?await db.receivedNote.count({where:receivedWhere}):issued?await db.issuedNote.count({where:{companyId:company.id}}):await db.tradeDocument.count({where:{companyId:company.id,kind:sheet==="PURCHASE"?"PURCHASE":"SALE",voidedAt:null}});
 const pages=Math.max(1,Math.ceil(count/50)),page=Math.min(pages,Number.isSafeInteger(parsed)&&parsed>0?parsed:1);
 const records:{id:string;values:Partial<Record<number,string>>;href:string;description:string}[]=[];
 if(received){
  const notes=await db.receivedNote.findMany({where:receivedWhere,include:{partner:true},orderBy:[{receivedDate:"desc"},{id:"desc"}],take:50,skip:(page-1)*50});
  for(const [i,n] of notes.entries())records.push({id:n.id,href:`/received-notes?view=${n.id}`,description:n.reference,values:{1:String((page-1)*50+i+1),2:day(n.receivedDate),4:n.sourceNoteKind??"",5:n.reference,6:n.partner.name,7:day(n.sourceIssuedDate),9:day(n.dueDate),11:n.issuingBank??"",12:n.amount.toFixed(0),13:n.discountFee?.toFixed(0)??""}});
 }else if(issued){
  const notes=await db.issuedNote.findMany({where:{companyId:company.id},include:{partner:true},orderBy:sheet==="ISSUED_DUE"?[{dueDate:"asc"},{id:"asc"}]:[{issuedDate:"desc"},{id:"desc"}],take:50,skip:(page-1)*50});
  for(const n of notes)records.push({id:n.id,href:`/issued-notes?view=${n.id}`,description:n.reference,values:{2:n.reference,3:n.amount.toFixed(0),6:ISSUED_NOTE_STATUSES[n.status],8:day(n.issuedDate),9:day(n.dueDate),11:n.partner.name}});
 }else{
  const docs=await db.tradeDocument.findMany({where:{companyId:company.id,kind:sheet==="PURCHASE"?"PURCHASE":"SALE",voidedAt:null},include:{workbookSource:{select:{cells:true}},partner:true,links:{where:{voidedAt:null},include:{transaction:{include:{account:true}}}}},orderBy:[{issuedDate:"desc"},{id:"desc"}],take:50,skip:(page-1)*50});
  for(const d of docs){const original=Array.isArray(d.workbookSource?.cells)?d.workbookSource.cells:[];const originalValues=Object.fromEntries(original.map((value,index)=>[index+1,typeof value==="string"?value:""]));const paid=d.settledAmount.equals(d.grossAmount),dates=[...new Set(d.links.map(l=>day(l.transaction.tradedDate)))].sort();records.push({id:d.id,href:`/trades?edit=${d.id}`,description:`${d.reference} · ${d.title}`,values:{...originalValues,[sheet==="SALE"?10:5]:originalValues[sheet==="SALE"?10:5]||d.partner.businessNumber||"",1:day(d.issuedDate),2:d.taxApprovalNumber??"",[sheet==="SALE"?7:12]:company.name,[sheet==="SALE"?12:7]:d.partner.name,15:d.grossAmount.toFixed(0),16:d.supplyAmount.toFixed(0),17:d.taxAmount.toFixed(0),21:[typeof original[20]==="string"?original[20]:"",d.note].filter(Boolean).join(" / "),27:d.title,34:paid?dates.join(", "):"",36:[typeof original[35]==="string"?original[35]:"",original[33]?`원본 수금/결재 표기: ${String(original[33])} (은행 별도 대조)`:"",d.settledAmount.isZero()?"":`${paid?"은행 전액 연결":"은행 일부 연결"} ${d.settledAmount.toFixed(0)}원`].filter(Boolean).join(" / "),37:day(d.dueDate),...(sheet==="PURCHASE"?{38:[...new Set(d.links.map(l=>`${l.transaction.account.bankName} ${l.transaction.account.label}`))].join(", ")}:{} )}});}
 }
 const amounts=received?[12,13]:issued?[3]:[15,16,17];
 return <><h1>엑셀 양식 장부</h1><p className="erp-page-description">원본의 열 순서·항목명·머리글 색상을 유지합니다. 현재 ERP에 등록된 자료만 표시하며, 미등록 항목은 빈칸입니다.</p>
 <nav className="excel-sheet-tabs" aria-label="원본 장부 시트">{Object.entries(layouts).map(([key,{title:label}])=><Link key={key} href={`/excel-ledgers?sheet=${key}`} aria-current={sheet===key?"page":undefined}>{label}</Link>)}</nav>
 <section className="erp-panel"><header className="erp-panel-heading"><h2>{layout.title}</h2></header><div className="erp-panel-body"><p>총 {count}건 · {page}/{pages}쪽 · 합계와 출력은 현재 페이지 최대 50건 기준</p><p className="text-xs">발급·전송일, 사업자 상세정보, 품목별 명세는 원본 이관 전에는 표시되지 않습니다. 수금·결재일은 은행 전액 연결 시 실제 연결일을 표시하며 분할 연결은 비고에서 구분합니다. 발행어음 번호는 현재 등록번호이며 은행 원본 번호 대조가 필요합니다.</p>
 <div className="excel-original-scroll"><table className="excel-original-grid" style={{width:layout.columns.reduce((sum,c)=>sum+c.width*c.span,0)}} data-erp-report-title={layout.title}><colgroup>{layout.columns.map(c=><col key={c.column} style={{width:c.width*c.span}}/>)}</colgroup><thead><tr>{layout.columns.map(c=><th key={c.column} style={{backgroundColor:c.background??"#edf3e7"}}>{c.label||"　"}</th>)}</tr></thead><tbody>{records.map(r=><tr key={r.id}>{layout.columns.map(c=><td key={c.column} className={amounts.includes(c.column)?"excel-number":undefined}>{c.column===(received?5:issued?2:1)?<Link title={r.description} href={r.href}>{r.values[c.column]||"상세"}</Link>:r.values[c.column]??""}</td>)}</tr>)}{!records.length&&<tr><td colSpan={layout.columns.length}>등록된 자료가 없습니다. 원본 파일은 아직 자동으로 가져오지 않았습니다.</td></tr>}<tr className="excel-original-total">{layout.columns.map((c,i)=><td key={c.column} className={amounts.includes(c.column)?"excel-number":undefined}>{i===0?"현재 페이지 합계":amounts.includes(c.column)?records.reduce((sum,r)=>sum+BigInt(r.values[c.column]||"0"),0n).toString():""}</td>)}</tr></tbody></table></div>
 <div className="mt-3 flex gap-4" data-erp-report-exclude>{page>1&&<Link href={`/excel-ledgers?sheet=${sheet}&page=${page-1}`}>이전</Link>}{page<pages&&<Link href={`/excel-ledgers?sheet=${sheet}&page=${page+1}`}>다음</Link>}<Link href={received?"/received-notes":issued?"/issued-notes":`/trades?kind=${sheet}`}>등록·수정 화면</Link></div></div></section><p className="mt-3 text-xs">은행별 시트는 수취어음 등록 시 직접 확인한 대장 은행으로 분류합니다. 미분류 자료를 임의 은행에 넣지 않습니다. 날짜는 수취일이며 발행일은 별도 원본 입력값입니다. 할인신청금액은 실제 할인 실입금액과 다르므로 원본 이관 전에는 빈칸입니다. 원본 실자료는 아직 자동 등록하지 않았습니다.</p></>;
}
export default function Page(props:{searchParams:Promise<{sheet?:string;page?:string}>}){return <Suspense fallback={<p>장부를 불러오는 중입니다.</p>}><Content {...props}/></Suspense>;}

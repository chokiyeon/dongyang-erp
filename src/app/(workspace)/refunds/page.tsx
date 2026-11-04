import {paidReductionRefundAmount} from "@/lib/trade-reduction-types";
import {Suspense} from 'react';
import Link from 'next/link';
import type {Prisma} from '@/generated/prisma/client';
import {requireAdmin} from '@/lib/auth';
import {requireCompany} from '@/lib/company';
import {getDb} from '@/lib/db';
import {cashSummary,won} from '@/lib/cash';
import {koreanToday} from '@/lib/forecast';
import {date,InputError} from '@/lib/validation';
import {Section,Field,Select} from '@/components/fields';

type Params={q?:string;direction?:string;project?:string;until?:string;page?:string};
async function Content({searchParams}:{searchParams:Promise<Params>}){
    await requireAdmin();const company=await requireCompany(),db=getDb(),params=await searchParams,today=koreanToday();
    const q=(params.q??'').slice(0,100),project=(params.project??'').slice(0,50),until=(params.until??'').slice(0,10),direction=params.direction==='IN'||params.direction==='OUT'?params.direction:undefined;
    let end:Date|null=null,error='';try{if(until)end=date(until,'환급 예정일 조회 기준');}catch(e){error=e instanceof InputError?e.message:'조회 기준일을 확인하세요.';}
    const source:Prisma.TradeDocumentWhereInput={companyId:company.id,...(project?{projectId:project==='__none'?null:project}:{}),...(q?{OR:[{reference:{contains:q,mode:'insensitive'}},{title:{contains:q,mode:'insensitive'}},{partner:{name:{contains:q,mode:'insensitive'}}}]}:{})};
    const [plans,projects]=await Promise.all([
        error?Promise.resolve([]):db.cashPlan.findMany({where:{companyId:company.id,completedAt:null,...(direction?{direction}:{}),...(end?{plannedDate:{lte:end}}:{}),OR:[{refundCancellation:{companyId:company.id,voidedAt:null,originalDocument:source}},{refundReduction:{companyId:company.id,voidedAt:null,originalDocument:source}}]},include:{settlements:{where:{voidedAt:null},select:{amount:true}},refundCancellation:{include:{originalDocument:{include:{reductions:{where:{voidedAt:null,refundPlanId:{not:null}},include:{refundPlan:true}},cancellations:{where:{voidedAt:null},select:{id:true}},partner:{select:{name:true}},project:{select:{code:true,name:true}}}}}},refundReduction:{include:{originalDocument:{include:{reductions:{where:{voidedAt:null,refundPlanId:{not:null}},include:{refundPlan:true}},cancellations:{where:{voidedAt:null},select:{id:true}},partner:{select:{name:true}},project:{select:{code:true,name:true}}}}}}},orderBy:[{plannedDate:'asc'},{id:'asc'}]}),
        db.project.findMany({where:{companyId:company.id},select:{id:true,code:true,name:true},orderBy:{code:'asc'}}),
    ]);
    const rows=plans.map(p=>{const c=p.refundCancellation??p.refundReduction!,d=c.originalDocument,s=cashSummary(p),r=p.refundReduction;const valid=Boolean((r?(!d.voidedAt||d.cancellations.length>0)&&r.paidAmount&&d.grossAmount.lte(r.afterGross)&&d.settledAmount.equals(r.paidAmount)&&p.plannedAmount.equals(paidReductionRefundAmount(r).toString()):p.refundCancellation&&d.voidedAt&&d.version===p.refundCancellation.documentVersionAfter&&p.plannedAmount.toFixed(0)===(BigInt(d.settledAmount.toFixed(0))-d.reductions.reduce((v,r)=>v+BigInt(r.refundPlan!.plannedAmount.toFixed(0)),0n)).toString())&&p.direction===(d.kind==='PURCHASE'?'IN':'OUT')&&!p.replacedById&&s.actual<=s.planned&&s.remaining>0n);return{p,c,d,s,valid,late:p.plannedDate.toISOString().slice(0,10)<today,sourceHref:r?`/trade-reductions?view=${c.id}`:`/trade-cancellations?view=${c.id}`};});
    const sum=(axis:'IN'|'OUT',late=false)=>rows.filter(r=>r.valid&&r.p.direction===axis&&(!late||r.late)).reduce((v,r)=>v+r.s.remaining,0n);
    const pages=Math.max(1,Math.ceil(rows.length/50)),parsed=Number(params.page),page=Math.min(pages,Number.isSafeInteger(parsed)&&parsed>0?parsed:1),held=rows.filter(r=>!r.valid).length;
    const href=(next:number)=>`/refunds?${new URLSearchParams({q,project,until,direction:direction??'',page:String(next)})}`;
    return <><h1>환급 잔액 현황</h1><p className="erp-page-description">{company.name} · 확인일 {today} · 취소·부분 감액 거래의 원 지급 기록을 보존하고 실제 환급에 연결한 금액을 뺀 잔액입니다. 회수할 돈과 지급할 돈을 서로 상계하지 않습니다.</p>
    <div className="erp-summary">{[['돌려받을 환급금',sum('IN')],['돌려줄 환급금',sum('OUT')],['기한 경과 회수액',sum('IN',true)],['기한 경과 지급액',sum('OUT',true)]].map(([label,value])=><div className="erp-summary-item" key={String(label)}><p>{String(label)}</p><strong className="erp-summary-value">{won(value as bigint)}</strong></div>)}</div>
    <Section title="미완료 환급 내역" description="합계는 조회 조건에 맞는 정상 연결 자료 전체 기준입니다. 목록·출력·엑셀은 현재 페이지 50건이며, 환급을 완료하거나 취소 등록을 정정한 자료는 제외합니다.">
    <form className="erp-query-bar" data-erp-report-exclude><Field label="환급 내역 검색" name="q" defaultValue={q} maxLength={100}/><Select label="환급 구분" name="direction" defaultValue={direction??''}><option value="">회수·지급 전체</option><option value="IN">돌려받을 돈</option><option value="OUT">돌려줄 돈</option></Select><Select label="환급 공사" name="project" defaultValue={project}><option value="">공사·본사 전체</option><option value="__none">본사·공통·미지정</option>{projects.map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select><Field label="환급 예정일 조회 기준" name="until" type="date" defaultValue={until}/><button className="erp-button">환급 잔액 조회</button></form>
    {error&&<p role="alert">{error}</p>}{held>0&&<p role="alert">원본·금액 재대조가 필요한 {held}건은 합계에서 제외했습니다. 수정증빙 상세에서 확인하세요.</p>}
    <p>{rows.length}건 · {page}/{pages}쪽 · 기준일을 비워 두면 향후 환급 일정도 모두 표시합니다.</p>
    <div className="overflow-x-auto"><table className="erp-table" data-erp-report-title="환급 잔액 현황"><thead><tr>{['환급 예정일','구분','거래처','공사','원 청구','원 지급 보존','환급 예정액','이미 환급','남은 환급액','상태','확인'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice((page-1)*50,page*50).map(({p,d,s,valid,late,sourceHref})=><tr key={p.id}><td>{p.plannedDate.toISOString().slice(0,10)}</td><td>{p.direction==='IN'?'환급 회수':'환급 지급'} · {p.refundReduction?'부분 감액':'전액취소'}</td><td>{d.partner.name}</td><td>{d.project?`${d.project.code} · ${d.project.name}`:d.companyExpense?'본사·공통':'미지정'}</td><td>{d.reference}<br/>{d.title}</td><td>{won(BigInt(d.settledAmount.toFixed(0)))}</td><td>{won(s.planned)}</td><td>{won(s.actual)}</td><td>{won(s.remaining)}</td><td>{!valid?'원본 재대조':late?'기한 경과':'환급 예정'}</td><td><Link className="erp-row-action" href={sourceHref}>수정증빙·예정일 변경</Link><br/><Link className="erp-row-action" href={`/cash?process=${p.id}`}>환급 은행 연결</Link></td></tr>)}{!rows.length&&<tr><td colSpan={11}>조회 조건에 맞는 미완료 환급이 없습니다.</td></tr>}</tbody></table></div>
    <div className="mt-3 flex gap-3" data-erp-report-exclude>{page>1&&<Link href={href(page-1)}>이전</Link>}{page<pages&&<Link href={href(page+1)}>다음</Link>}<Link href="/trade-cancellations">수정증빙 전체 이력</Link><Link href="/transfer-preparation">송금 준비표</Link></div>
    </Section></>;
}
export default function Page(props:{searchParams:Promise<Params>}){return <Suspense fallback={<p>환급 잔액을 조회하는 중입니다.</p>}><Content {...props}/></Suspense>;}

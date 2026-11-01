"use client";
import {useRef,useState} from "react";
import {flushSync} from "react-dom";
import Link from "next/link";
import {PayrollSlip,type PayrollSlipData} from "./payroll-slip";
import {payrollSlipJpeg} from "@/lib/payroll-slip-image";
import {PAYROLL_SLIP_BATCH_LIMIT,uniquePayrollSlipFilename} from "@/lib/payroll-slip-batch";
type Worker={id:string;name:string;code:string;dueDate:string};
export function PayrollSlipBatch({rows,period}:{rows:Worker[];period:string}){
 const[selected,setSelected]=useState<string[]>([]);const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");const[slip,setSlip]=useState<PayrollSlipData|null>(null);const paper=useRef<HTMLDivElement>(null);
 async function download(){
  if(!selected.length||selected.length>PAYROLL_SLIP_BATCH_LIMIT)return;
  setBusy(true);setMessage("명세서를 준비하고 있습니다.");
  try{
   const{default:JSZip}=await import("jszip");const zip=new JSZip();const used=new Set<string>();
   const workers=rows.filter(row=>selected.includes(row.id));
   for(const[index,worker]of workers.entries()){
    setMessage(`${index+1}/${workers.length} · ${worker.name} 명세서 만드는 중…`);
    const response=await fetch(`/api/payroll-statements/${worker.id}/image-data`,{cache:"no-store"});
    if(!response.ok){const result=await response.json().catch(()=>null);throw Error(`${worker.name}: ${result?.error??"명세서를 불러오지 못했습니다. 다시 로그인하고 확인하세요."}`);}
    const data:PayrollSlipData=await response.json();
    flushSync(()=>setSlip(data));
    const node=paper.current?.querySelector<HTMLElement>("[data-payroll-slip]");if(!node)throw Error("명세서 화면을 준비하지 못했습니다.");
    const blob=await payrollSlipJpeg(node);zip.file(uniquePayrollSlipFilename(data.employee,period,used),await blob.arrayBuffer());
   }
   const blob=await zip.generateAsync({type:"blob",compression:"STORE"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`${period}_급여명세서_JPG.zip`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
   setMessage(`${workers.length}명 JPG 묶음 저장 완료. 압축을 풀면 직원별 파일이 나옵니다.`);
  }catch(error){setMessage(error instanceof Error?error.message:"묶음 저장에 실패했습니다.");}finally{setSlip(null);setBusy(false);}
 }
 return <><div className="my-4 flex flex-wrap items-center gap-3" data-erp-report-exclude><button className="erp-button" disabled={busy} onClick={()=>setSelected(rows.slice(0,PAYROLL_SLIP_BATCH_LIMIT).map(row=>row.id))}>전체 선택 (최대 {PAYROLL_SLIP_BATCH_LIMIT}명)</button><button className="erp-button" disabled={busy} onClick={()=>setSelected([])}>선택 해제</button><button className="erp-button erp-button-primary" disabled={busy||!selected.length} onClick={download}>{busy?"JPG 만드는 중…":`선택 ${selected.length}명 JPG 묶음 저장`}</button></div><p role="status" aria-live="polite">{message}</p><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>선택</th><th>직원 코드</th><th>이름</th><th>지급일</th><th>확인</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><input type="checkbox" aria-label={`${row.code} 명세서 선택`} checked={selected.includes(row.id)} disabled={busy||(!selected.includes(row.id)&&selected.length>=PAYROLL_SLIP_BATCH_LIMIT)} onChange={event=>setSelected(old=>event.target.checked?[...old,row.id]:old.filter(id=>id!==row.id))}/></td><td>{row.code}</td><td>{row.name}</td><td>{row.dueDate}</td><td><Link className="erp-row-action" href={`/payroll-statements/${row.id}`}>명세서 확인</Link></td></tr>)}</tbody></table></div>{!rows.length&&<p className="my-4">저장된 급여 지급 확인이 없습니다. 먼저 급여 지급 확인을 저장하세요.</p>}<div ref={paper} aria-hidden="true" data-erp-report-exclude style={{position:"fixed",left:-20000,top:0,width:794,pointerEvents:"none"}}>{slip&&<PayrollSlip data={slip}/>}</div></>;
}

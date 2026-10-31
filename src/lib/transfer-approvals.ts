import {createHash} from "node:crypto";
import type {Prisma,PrismaClient} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError,text,date,revision} from "./validation";
import {koreanToday} from "./forecast";
import {transferPreparation,type TransferPreparationRow} from "./transfer-preparation";
export const APPROVAL_STATES:Record<string,string>={DRAFT:"승인 전 검토본",APPROVED:"구두승인 기록",REJECTED:"승인 보류",VOID:"검토본 취소"};
export function transferBasis(rows:TransferPreparationRow[]){return createHash("sha256").update(JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)))).digest("hex");}
function selectedIds(raw:string){let v:unknown;try{v=JSON.parse(raw);}catch{throw new InputError("송금 대상을 다시 선택하세요.");}if(!Array.isArray(v)||!v.length||v.length>200||v.some(id=>typeof id!=="string"||id.length>80)||new Set(v).size!==v.length)throw new InputError("중복 없이 1~200건의 송금 대상을 선택하세요.");return v as string[];}
export async function approvalCurrent(db:PrismaClient|Prisma.TransactionClient,until:string,rows:TransferPreparationRow[],basis:string){const current=await transferPreparation(db,until);const ids=new Set(rows.map(r=>r.id));const selected=current.ready.filter(r=>ids.has(r.id));return selected.length===rows.length&&transferBasis(selected)===basis;}
export async function saveTransferApproval(tx:Prisma.TransactionClient,op:"create"|"approve"|"reject"|"void",d:FormData){
 const requestId=text(d,"requestId","요청",true,50);const reason=text(d,"reason","승인 기록 사유",true,500);if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("화면을 다시 열어 주세요.");const fingerprint=createHash("sha256").update(JSON.stringify({op,values:Object.fromEntries([...d.entries()].sort(([a],[b])=>a.localeCompare(b)))})).digest("hex");const replay=await tx.transferApprovalChange.findUnique({where:{requestId},include:{approval:true}});if(replay){if(replay.approval.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용에 사용한 요청입니다.");return replay.approvalId;}
 let id="";let previous:Prisma.InputJsonValue={};let next:Prisma.InputJsonValue={};
 if(op==="create"){
  const until=text(d,"until","송금 기준일",true,10);const untilDate=date(until,"송금 기준일")!;const ids=selectedIds(text(d,"selectedIds","송금 선택",true,20000));if(d.get("confirmed")!=="on")throw new InputError("선택한 송금 금액·수취계좌·공사 내역을 확인하세요.");const data=await transferPreparation(tx,until);const rows=data.ready.filter(r=>ids.includes(r.id)).sort((a,b)=>a.id.localeCompare(b.id));if(rows.length!==ids.length)throw new InputError("계좌·금액·원본 상태가 변경되었거나 보류된 내역입니다. 송금 준비표를 다시 조회하세요.");const total=rows.reduce((s,r)=>s+BigInt(r.amount),0n).toString();if(total.length>20)throw new InputError("합계 금액이 저장 범위를 초과합니다.");const title=text(d,"title","송금 검토본 제목",true,200);const saved=await tx.transferApproval.create({data:{companyId:COMPANY_ID,title,untilDate,rows:JSON.parse(JSON.stringify(rows)),basis:transferBasis(rows),totalAmount:total}});id=saved.id;next={state:"DRAFT",id,basis:saved.basis,total};
 }else{
  id=text(d,"approvalId","송금 검토본",true,50);const version=revision(d);const old=await tx.transferApproval.findFirst({where:{id,companyId:COMPANY_ID}});if(!old||old.version!==version||old.state==="VOID")throw new InputError("송금 검토본 상태가 변경되었습니다. 다시 조회하세요.");if(op!=="void"&&old.state!=="DRAFT")throw new InputError("승인 전 검토본만 승인·보류할 수 있습니다. 새 검토본을 생성하세요.");let approvedBy:string|null=null;let approvalDate:Date|null=null;
  if(op==="approve"){
   if(!await approvalCurrent(tx,old.untilDate.toISOString().slice(0,10),old.rows as TransferPreparationRow[],old.basis))throw new InputError("금액·계좌·지급 또는 원본 상태가 변경되었습니다. 새 검토본으로 확인하세요.");const company=await tx.company.findUniqueOrThrow({where:{id:COMPANY_ID}});approvedBy=text(d,"approvedBy","구두승인 대표자",true,100);if(!company.representatives.includes(approvedBy))throw new InputError("회사 정보에 등록한 실제 승인 대표자를 선택하세요.");approvalDate=date(text(d,"approvalDate","승인 전달일",true),"승인 전달일")!;if(approvalDate.toISOString().slice(0,10)>koreanToday())throw new InputError("승인 전달일은 오늘 이후일 수 없습니다.");if(d.get("confirmed")!=="on")throw new InputError("대표자의 실제 구두승인을 전달받았음을 확인하세요.");
  }
  const state=op==="approve"?"APPROVED":op==="reject"?"REJECTED":"VOID";const changed=await tx.transferApproval.updateMany({where:{id,companyId:COMPANY_ID,version,state:old.state},data:{state,...(op==="approve"?{approvedBy,approvalDate}:{}),version:{increment:1}}});if(changed.count!==1)throw new InputError("다른 화면에서 승인 상태를 변경했습니다.");previous={state:old.state};next={state,method:op==="approve"?"ADMIN_RECORDED_VERBAL":null,approvedBy,approvalDate:approvalDate?.toISOString().slice(0,10)??null};
 }
 await tx.transferApprovalChange.create({data:{approvalId:id,requestId,fingerprint,operation:op,previous,next,reason}});return id;
}

import { createHash,randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { koreanToday } from "./forecast";
import { discountedProceeds } from "./received-note-types";
import { text,date,amount,choice,revision,InputError } from "./validation";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function request(data:FormData){const id=text(data,"requestId","요청",true,50);if(!/^[0-9a-f-]{36}$/i.test(id))throw new InputError("화면을 다시 열어 주세요.");return id;}
async function replay(tx:Prisma.TransactionClient,requestId:string,fingerprint:string){const r=await tx.receivedNoteChange.findUnique({where:{requestId},include:{note:true}});if(r&&(r.note.companyId!==COMPANY_ID||r.fingerprint!==fingerprint))throw new InputError("다른 내용으로 사용된 요청입니다. 다시 조회해 주세요.");return r?.noteId;}
export async function createReceivedNote(tx:Prisma.TransactionClient,data:FormData){
 const requestId=request(data);const reference=text(data,"reference","수취어음번호·관리번호",true,50);const partnerId=text(data,"partnerId","지급 거래처",true,50);const projectId=text(data,"projectId","현장",false,50)||null;const receivedDate=date(text(data,"receivedDate","수취일",true),"수취일")!;const dueDate=date(text(data,"dueDate","어음 만기일",true),"어음 만기일")!;
 if(receivedDate.toISOString().slice(0,10)>koreanToday())throw new InputError("실제 받은 어음만 등록하세요. 수취일은 오늘 이후일 수 없습니다.");
 const value=amount(text(data,"amount","액면금액",true,20),"액면금액")!;if(BigInt(value)<=0n)throw new InputError("액면금액은 0보다 커야 합니다.");const mode=choice(text(data,"scheduleMode","예정 연결",true),["NEW","EXISTING"] as const,"예정 연결");const cashPlanId=text(data,"cashPlanId","기존 예정",false,50);const note=text(data,"note","수취어음 비고",false,500);const reason=text(data,"reason","등록 사유",true,300);
 const fingerprint=digest({reference,partnerId,projectId,receivedDate,dueDate,value,mode,cashPlanId,note,reason});const previous=await replay(tx,requestId,fingerprint);if(previous)return previous;
 const [partner,project]=await Promise.all([tx.partner.findFirst({where:{id:partnerId,companyId:COMPANY_ID,active:true,type:{in:["CLIENT","BOTH"]}}}),projectId?tx.project.findFirst({where:{id:projectId,companyId:COMPANY_ID,active:true}}):null]);if(!partner||(projectId&&!project))throw new InputError("사용 중인 회사 발주·매출 거래처와 현장을 선택하세요.");
 let planId="";
 if(mode==="EXISTING"){
  const rawVersion=text(data,"planVersion","기존 예정 버전",true,9);if(!/^\d{1,9}$/.test(rawVersion))throw new InputError("기존 입금 예정을 다시 선택하세요.");
  const plan=await tx.cashPlan.findFirst({where:{id:cashPlanId,companyId:COMPANY_ID},include:{receivedNote:true,issuedNote:true,settlements:{where:{voidedAt:null}}}});
  if(!plan||plan.version!==Number(rawVersion)||plan.receivedNote||plan.issuedNote||plan.completedAt||plan.direction!=="IN"||!["공사대금","수취어음"].includes(plan.category)||plan.plannedDate.getTime()!==dueDate.getTime()||plan.plannedAmount.toFixed(0)!==value||plan.settlements.length)throw new InputError("만기일·금액이 같은 미처리 공사대금·수취어음 입금 예정만 연결할 수 있습니다.");
  const changed=await tx.cashPlan.updateMany({where:{id:plan.id,companyId:COMPANY_ID,version:plan.version,completedAt:null},data:{certainty:"ESTIMATED",version:{increment:1}}});if(changed.count!==1)throw new InputError("입금 예정이 변경되었습니다. 다시 조회하세요.");planId=plan.id;
 }else{
  if(data.get("scheduleConfirmed")!=="on")throw new InputError("같은 어음 입금 예정이 이미 등록되어 있지 않은지 확인하세요.");
  planId=(await tx.cashPlan.create({data:{companyId:COMPANY_ID,direction:"IN",certainty:"ESTIMATED",title:`수취어음 ${reference} · ${partner.name}`,category:"수취어음",plannedDate:dueDate,plannedAmount:value,requestId:randomUUID()}})).id;
 }
 const created=await tx.receivedNote.create({data:{companyId:COMPANY_ID,reference,partnerId,projectId,receivedDate,dueDate,amount:value,cashPlanId:planId,note}});
 await tx.receivedNoteChange.create({data:{noteId:created.id,requestId,fingerprint,previous:{},next:{status:"HELD",reference,amount:value,receivedDate:receivedDate.toISOString().slice(0,10),dueDate:dueDate.toISOString().slice(0,10),cashPlanId:planId},reason}});return created.id;
}
export async function discountReceivedNote(tx:Prisma.TransactionClient,data:FormData){
 const id=text(data,"noteId","수취어음",true,50);const version=revision(data);const requestId=request(data);const transactionId=text(data,"transactionId","실입금 은행 거래",true,50);const fee=amount(text(data,"discountFee","할인료·수수료",true,20),"할인료·수수료")!;const reason=text(data,"reason","할인 처리 사유",true,300);const fingerprint=digest({id,version,transactionId,fee,reason});const prior=await replay(tx,requestId,fingerprint);if(prior)return prior;
 const note=await tx.receivedNote.findFirst({where:{id,companyId:COMPANY_ID},include:{cashPlan:{include:{settlements:{where:{voidedAt:null}}}}}});if(!note||note.version!==version||note.status!=="HELD"||note.cashPlan.completedAt||note.cashPlan.settlements.length)throw new InputError("처리 실적이 없는 보유 어음만 할인할 수 있습니다. 변경 내역을 다시 확인하세요.");
 let net;try{net=discountedProceeds(note.amount.toFixed(0),fee);}catch{throw new InputError("할인료는 액면금액보다 작은 0 이상 금액이어야 합니다.");}
 const bank=await tx.bankTransaction.findFirst({where:{id:transactionId,account:{companyId:COMPANY_ID},direction:"IN",internalTransfer:false},include:{cashSettlements:{where:{voidedAt:null}}}});if(!bank||bank.tradedDate<note.receivedDate||bank.tradedDate>=note.dueDate||bank.tradedDate.toISOString().slice(0,10)>koreanToday())throw new InputError("수취일 이후·만기 전 실제 은행 입금을 선택하세요. 계좌 간 이체는 사용할 수 없습니다.");
 const used=bank.cashSettlements.reduce((sum,s)=>sum+BigInt(s.amount.toFixed(0)),0n);if(used+BigInt(net)>BigInt(bank.amount.toFixed(0)))throw new InputError("실입금액이 은행 거래의 연결 가능한 금액을 초과합니다.");
 const planChanged=await tx.cashPlan.updateMany({where:{id:note.cashPlanId,companyId:COMPANY_ID,version:note.cashPlan.version,completedAt:null},data:{completedAt:new Date(),completionNote:`수취어음 할인 · 할인료 ${fee}원 · ${reason}`,version:{increment:1}}});if(planChanged.count!==1)throw new InputError("연결된 예정이 변경되었습니다. 다시 조회하세요.");
 const bankChanged=await tx.bankTransaction.updateMany({where:{id:bank.id,settlementVersion:bank.settlementVersion,classificationVersion:bank.classificationVersion,internalTransfer:false},data:{settlementVersion:{increment:1}}});if(bankChanged.count!==1)throw new InputError("은행 연결 상태가 변경되었습니다. 다시 조회하세요.");
 const settlement=await tx.cashSettlement.create({data:{planId:note.cashPlanId,bankTransactionId:bank.id,processedDate:bank.tradedDate,amount:net,finalized:true,note:`수취어음 할인 ${note.reference} · 액면 ${note.amount.toFixed(0)}원 · 할인료 ${fee}원 · ${reason}`,requestId}});
 const changed=await tx.receivedNote.updateMany({where:{id,companyId:COMPANY_ID,version,status:"HELD"},data:{status:"DISCOUNTED",realizedDate:bank.tradedDate,discountFee:fee,netProceeds:net,version:{increment:1}}});if(changed.count!==1)throw new InputError("어음 상태가 변경되었습니다. 다시 조회하세요.");
 await tx.receivedNoteChange.create({data:{noteId:id,requestId,fingerprint,previous:{status:"HELD"},next:{status:"DISCOUNTED",discountFee:fee,netProceeds:net,date:bank.tradedDate.toISOString().slice(0,10),settlementId:settlement.id},reason}});return id;
}
export async function changeReceivedNote(tx:Prisma.TransactionClient,data:FormData,operation:"void"|"mature"|"undoMaturity"){
 const id=text(data,"noteId","수취어음",true,50);const version=revision(data);const requestId=request(data);const reason=text(data,"reason","처리 사유",true,300);const fingerprint=digest({id,version,reason,operation});const prior=await replay(tx,requestId,fingerprint);if(prior)return prior;
 const note=await tx.receivedNote.findFirst({where:{id,companyId:COMPANY_ID},include:{cashPlan:{include:{settlements:{where:{voidedAt:null}}}}}});if(!note||note.version!==version)throw new InputError("어음이 변경되었습니다. 다시 조회하세요.");
 const next=operation==="void"?"VOID":operation==="mature"?"MATURED":"DISCOUNTED";
 if(operation==="void"){
  if(note.status!=="HELD"||note.cashPlan.completedAt||note.cashPlan.settlements.length)throw new InputError("실적이 없는 보유 어음만 등록 취소할 수 있습니다. 먼저 현금화 실적을 취소하세요.");
  const changed=await tx.cashPlan.updateMany({where:{id:note.cashPlanId,companyId:COMPANY_ID,version:note.cashPlan.version,completedAt:null},data:{completedAt:new Date(),completionNote:`수취어음 등록 취소: ${reason}`,version:{increment:1}}});if(changed.count!==1)throw new InputError("연결된 예정이 변경되었습니다. 다시 조회하세요.");
 }else if(operation==="mature"){
  if(note.status!=="DISCOUNTED"||note.dueDate.toISOString().slice(0,10)>koreanToday()||data.get("confirmed")!=="on")throw new InputError("만기 도래 후 할인어음의 추심 완료와 환수 부담 해소를 확인한 경우에만 처리하세요.");
 }else if(note.status!=="MATURED")throw new InputError("만기 확인을 완료한 할인어음만 확인 취소할 수 있습니다.");
 const changed=await tx.receivedNote.updateMany({where:{id,companyId:COMPANY_ID,version,status:note.status},data:{status:next,version:{increment:1},...(operation==="void"?{voidReason:reason}:{}),...(operation==="mature"?{maturityConfirmedAt:new Date()}:operation==="undoMaturity"?{maturityConfirmedAt:null}:{})}});if(changed.count!==1)throw new InputError("어음 상태가 변경되었습니다. 다시 조회하세요.");
 await tx.receivedNoteChange.create({data:{noteId:id,requestId,fingerprint,previous:{status:note.status},next:{status:next},reason}});return id;
}

import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { koreanToday } from "./forecast";
import { issuedNoteMaturity } from "./issued-note-types";
import { amount, choice, date, InputError, revision, text } from "./validation";
const digest = (value:unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function request(data:FormData) { const key=text(data,"requestId","요청",true,50); if(!/^[0-9a-f-]{36}$/i.test(key))throw new InputError("화면을 다시 열어 주세요."); return key; }
export async function createIssuedNote(tx:Prisma.TransactionClient,data:FormData) {
  const requestId=request(data); const reference=text(data,"reference","어음번호·관리번호",true,50); const partnerId=text(data,"partnerId","수취 거래처",true,50); const projectId=text(data,"projectId","현장",false,50)||null; const accountId=text(data,"accountId","결제 계좌",true,50);
  const issuedDate=date(text(data,"issuedDate","발행일",true),"발행일")!; if(issuedDate.toISOString().slice(0,10)>koreanToday())throw new InputError("실제 발행일은 오늘 이후일 수 없습니다.");
  const dueDate=new Date(issuedNoteMaturity(issuedDate.toISOString().slice(0,10))); const value=amount(text(data,"amount","어음금액",true,20),"어음금액")!; if(BigInt(value)<=0n)throw new InputError("어음금액은 0보다 커야 합니다.");
  const mode=choice(text(data,"scheduleMode","자금계획 연결",true),["NEW","EXISTING"] as const,"자금계획 연결"); const cashPlanId=text(data,"cashPlanId","기존 예정",false,50); const note=text(data,"note","어음 비고",false,500); const reason=text(data,"reason","등록 사유",true,300);
  const fingerprint=digest({reference,partnerId,projectId,accountId,issuedDate,dueDate,value,mode,cashPlanId,note,reason});
  const replay=await tx.issuedNoteChange.findUnique({where:{requestId},include:{note:true}}); if(replay){if(replay.note.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용된 요청입니다. 다시 조회해 주세요.");return replay.noteId;}
  const [account,partner,project]=await Promise.all([tx.bankAccount.findFirst({where:{id:accountId,companyId:COMPANY_ID,active:true}}),tx.partner.findFirst({where:{id:partnerId,companyId:COMPANY_ID,active:true,type:{in:["SUPPLIER","BOTH"]}}}),projectId?tx.project.findFirst({where:{id:projectId,companyId:COMPANY_ID,active:true}}):null]);
  if(!account||!partner||(projectId&&!project))throw new InputError("사용 중인 회사 결제 계좌·매입 거래처·현장을 선택해 주세요.");
  let planId="";
  if(mode==="EXISTING") {
    const planVersion=text(data,"planVersion","기존 예정 버전",true,9); if(!/^\d{1,9}$/.test(planVersion))throw new InputError("기존 지출 예정을 다시 선택해 주세요.");
    const plan=await tx.cashPlan.findFirst({where:{id:cashPlanId,companyId:COMPANY_ID,tradeDocument:null,payroll:null,monthlyPayment:null},include:{issuedNote:true,settlements:{where:{voidedAt:null}}}});
    if(!plan||plan.version!==Number(planVersion)||plan.issuedNote||plan.completedAt||plan.direction!=="OUT"||plan.category!=="어음결제"||plan.plannedDate.getTime()!==dueDate.getTime()||plan.plannedAmount.toFixed(0)!==value||plan.settlements.length)throw new InputError("금액·만기일이 같은 미처리 어음결제 예정만 연결할 수 있습니다. 이미 처리·연결된 내역은 제외됩니다.");
    const changed=await tx.cashPlan.updateMany({where:{id:plan.id,companyId:COMPANY_ID,version:plan.version,completedAt:null},data:{certainty:"CONFIRMED",version:{increment:1}}}); if(changed.count!==1)throw new InputError("예정 내역이 변경되었습니다. 다시 조회해 주세요."); planId=plan.id;
  } else {
    if(data.get("scheduleConfirmed")!=="on")throw new InputError("같은 어음의 지출 예정을 이미 등록하지 않았는지 확인해 주세요.");
    const plan=await tx.cashPlan.create({data:{companyId:COMPANY_ID,direction:"OUT",certainty:"CONFIRMED",title:`발행어음 ${reference} · ${partner.name}`,category:"어음결제",plannedDate:dueDate,plannedAmount:value,requestId:randomUUID()}}); planId=plan.id;
  }
  const created=await tx.issuedNote.create({data:{companyId:COMPANY_ID,reference,partnerId,projectId,accountId,issuedDate,dueDate,amount:value,cashPlanId:planId,note}});
  await tx.issuedNoteChange.create({data:{noteId:created.id,requestId,fingerprint,previous:{},next:{status:"OPEN",reference,amount:value,issuedDate:issuedDate.toISOString().slice(0,10),dueDate:dueDate.toISOString().slice(0,10),cashPlanId:planId},reason}}); return created.id;
}
export async function voidIssuedNote(tx:Prisma.TransactionClient,data:FormData) {
  const id=text(data,"noteId","어음",true,50); const version=revision(data); const requestId=request(data); const reason=text(data,"reason","취소 사유",true,300); const fingerprint=digest({id,version,reason,void:true});
  const replay=await tx.issuedNoteChange.findUnique({where:{requestId},include:{note:true}}); if(replay){if(replay.note.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용된 요청입니다.");return id;}
  const note=await tx.issuedNote.findFirst({where:{id,companyId:COMPANY_ID},include:{cashPlan:{include:{settlements:{where:{voidedAt:null}}}}}});
  if(!note||note.version!==version)throw new InputError("어음이 변경되었습니다. 다시 조회해 주세요."); if(note.status!=="OPEN"||note.cashPlan.completedAt||note.cashPlan.settlements.length)throw new InputError("미결제이고 처리 실적이 없는 어음 등록만 취소할 수 있습니다. 결제 실적이 있으면 먼저 실적을 취소하세요.");
  const plan=await tx.cashPlan.updateMany({where:{id:note.cashPlanId,companyId:COMPANY_ID,version:note.cashPlan.version,completedAt:null},data:{completedAt:new Date(),completionNote:`어음 등록 취소: ${reason}`,version:{increment:1}}}); if(plan.count!==1)throw new InputError("연결된 예정이 변경되었습니다. 다시 조회해 주세요.");
  const changed=await tx.issuedNote.updateMany({where:{id,companyId:COMPANY_ID,version,status:"OPEN"},data:{status:"VOID",voidReason:reason,version:{increment:1}}}); if(changed.count!==1)throw new InputError("어음이 변경되었습니다. 다시 조회해 주세요.");
  await tx.issuedNoteChange.create({data:{noteId:id,requestId,fingerprint,previous:{status:"OPEN"},next:{status:"VOID"},reason}}); return id;
}

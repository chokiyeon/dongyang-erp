import {assertPeriodsOpen} from "./period-guard";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { InputError, text, amount, date, revision, choice } from "./validation";
import { koreanToday } from "./forecast";
import { PROJECT_COST_CATEGORIES, REMAINING_COST_FIELDS } from "./project-profit-types";
import { summarizeProjectProfit } from "./project-profit-summary";
export async function profitSources(tx: Prisma.TransactionClient, projectId: string) {
  const [documents,entries] = await Promise.all([
    tx.tradeDocument.findMany({where:{companyId:COMPANY_ID,projectId,kind:"PURCHASE",voidedAt:null,issuedDate:{lte:new Date(koreanToday())}},orderBy:{id:"asc"}}),
    tx.projectCostEntry.findMany({where:{projectId,project:{companyId:COMPANY_ID},voidedAt:null,incurredDate:{lte:new Date(koreanToday())}},orderBy:{id:"asc"}}),
  ]);return {documents,entries};
}
export async function saveProjectProfit(tx: Prisma.TransactionClient,data:FormData,operation:"estimate"|"cost"|"void") {
  const projectId=text(data,"projectId","현장",true,50); const version=revision(data);const requestId=text(data,"requestId","요청",true,50);const reason=text(data,"reason","처리 사유",true,300);
  if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new InputError("화면을 다시 열어 주세요.");
  const submitted=Object.fromEntries(data.entries());const fingerprint=createHash("sha256").update(JSON.stringify({operation,submitted})).digest("hex");
  const replay=await tx.projectProfitChange.findUnique({where:{requestId},include:{project:true}});
  if(replay){if(replay.project.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용한 요청입니다. 다시 조회해 주세요.");return projectId;}
  const project=await tx.project.findFirst({where:{id:projectId,companyId:COMPANY_ID}});if(!project)throw new InputError("회사 현장을 선택해 주세요.");
  if(project.profitVersion!==version)throw new InputError("다른 화면에서 원가·전망을 변경했습니다. 다시 조회해 주세요.");
  let previous:Prisma.InputJsonValue={};let next:Prisma.InputJsonValue={};
  if(operation==="estimate"){
    const values=Object.fromEntries(Object.entries(REMAINING_COST_FIELDS).map(([key,label])=>[key,amount(text(data,key,label,false,20),label)])) as Record<keyof typeof REMAINING_COST_FIELDS,string|null>;
    const unapprovedAdditional=amount(text(data,"unapprovedAdditional","미승인 추가공사",false,20),"미승인 추가공사");
    const sources=await profitSources(tx,projectId);const summary=summarizeProjectProfit(project,sources.documents,sources.entries);const confirmed=data.get("confirmed")==="on";
    if(confirmed&&(summary.issues.length||project.contractAmount===null||Object.values(values).some(v=>v===null)))throw new InputError("계약금액·매입 원가 구분·증빙/부가세 검토·남은 원가 네 항목을 먼저 확인해 주세요.");
    const profitBasis=confirmed?summary.basis:null;const profitReviewedAt=confirmed?new Date():null;
    previous={...Object.fromEntries(Object.keys(REMAINING_COST_FIELDS).map(key=>[key,project[key as keyof typeof REMAINING_COST_FIELDS]?.toFixed(0)??null])),unapprovedAdditional:project.unapprovedAdditional?.toFixed(0)??null,reviewed:project.profitReviewedAt?.toISOString()??null};next={...values,unapprovedAdditional,reviewed:profitReviewedAt?.toISOString()??null,basis:profitBasis};
    const changed=await tx.project.updateMany({where:{id:projectId,companyId:COMPANY_ID,profitVersion:version},data:{...values,unapprovedAdditional,profitBasis,profitReviewedAt,profitVersion:{increment:1}}});if(changed.count!==1)throw new InputError("원가·전망이 변경되었습니다. 다시 조회해 주세요.");
  }else{
    const id=text(data,"costId","추가 발생원가",false,50);const old=id?await tx.projectCostEntry.findFirst({where:{id,projectId,project:{companyId:COMPANY_ID}}}):null;
    if(old?.sourceReviewId)throw new InputError("원본 연결 원가는 원가 배부 화면에서 수정·취소하세요.");
    if(id&&(!old||old.voidedAt))throw new InputError("유효한 추가 발생원가를 선택해 주세요.");
    if(operation==="void"&&!old)throw new InputError("취소할 원가를 선택해 주세요.");
    let values;
    if(operation==="cost"){
      const incurredDate=date(text(data,"incurredDate","발생일",true),"발생일")!;if(incurredDate.toISOString().slice(0,10)>koreanToday())throw new InputError("이미 발생한 원가만 입력하세요. 미래 비용은 남은 예상 원가에 입력합니다.");
      const value=amount(text(data,"amount","발생원가",true,20),"발생원가")!;if(BigInt(value)<=0n)throw new InputError("발생원가는 0보다 커야 합니다.");
      values={reference:text(data,"reference","추가원가 관리번호",true,50),title:text(data,"title","발생원가 내용",true,200),category:choice(text(data,"category","원가 구분",true),Object.keys(PROJECT_COST_CATEGORIES) as (keyof typeof PROJECT_COST_CATEGORIES)[],"원가 구분"),incurredDate,amount:value};
    }
    await assertPeriodsOpen(tx,old?.incurredDate,values?.incurredDate);
    const changed=await tx.project.updateMany({where:{id:projectId,companyId:COMPANY_ID,profitVersion:version},data:{profitVersion:{increment:1}}});if(changed.count!==1)throw new InputError("원가·전망이 변경되었습니다. 다시 조회해 주세요.");
    previous=old?{id:old.id,reference:old.reference,title:old.title,category:old.category,date:old.incurredDate.toISOString(),amount:old.amount.toFixed(0)}:{};
    if(operation==="void"){await tx.projectCostEntry.update({where:{id:old!.id},data:{voidedAt:new Date(),voidReason:reason}});next={id:old!.id,voided:true};}
    else{const saved=old?await tx.projectCostEntry.update({where:{id:old.id},data:values!}):await tx.projectCostEntry.create({data:{...values!,projectId}});next={id:saved.id,reference:saved.reference,title:saved.title,category:saved.category,date:saved.incurredDate.toISOString(),amount:saved.amount.toFixed(0)};}
  }
  await tx.projectProfitChange.create({data:{projectId,requestId,fingerprint,previous,next,reason}});return projectId;
}

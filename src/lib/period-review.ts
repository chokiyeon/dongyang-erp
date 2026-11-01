import {createHash} from "node:crypto";
import type {Prisma} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError,text,revision} from "./validation";
import {paymentMonth,recurringDue} from "./payment-terms";
import {koreanToday} from "./forecast";
import {acquirePeriodReviewLock} from "./period-guard";
import {captureAccounting} from "./accounting-delivery";
import {loadMonthEndReview} from "./month-end-review";
export async function savePeriodReview(tx:Prisma.TransactionClient,op:"close"|"reopen",d:FormData){
 const period=paymentMonth(text(d,"period","마감월",true,7)),version=revision(d),requestId=text(d,"requestId","요청",true,50),reason=text(d,"reason","마감·재개방 사유",true,300);
 if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("마감 검토 화면을 다시 열어 주세요.");
 const fingerprint=createHash("sha256").update(JSON.stringify({op,period,version,reason,packageId:String(d.get("packageId")??"")})).digest("hex");
 const replay=await tx.financeChange.findUnique({where:{requestId}});if(replay){if(replay.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용된 요청입니다.");return replay.entityId;}
 await acquirePeriodReviewLock(tx);const old=await tx.accountingPeriodLock.findUnique({where:{companyId_period:{companyId:COMPANY_ID,period}}});if((old?.version??0)!==version)throw new InputError("마감 상태가 변경되었습니다. 다시 조회하세요.");
 let values:{locked:boolean;packageId:string;digest:string;lockedAt:Date};
 if(op==="close"){
  if(old?.locked)throw new InputError("이미 마감된 월입니다.");if(recurringDue(period,0)>koreanToday())throw new InputError("월말이 지난 기간만 마감할 수 있습니다.");if(d.get("confirmed")!=="on")throw new InputError("점검 항목과 미수·미지급 이월, 회계 전달본을 확인하세요.");
  const packageId=text(d,"packageId","회계 전달본",true,50),saved=await tx.accountingPackage.findFirst({where:{id:packageId,companyId:COMPANY_ID,period,state:"CLOSED"}});if(!saved)throw new InputError("해당 월의 회계 전달·검토 마감본을 먼저 준비하세요.");
  const current=await captureAccounting(tx,period);if(current.digest!==saved.digest)throw new InputError("전달본 이후 원본이 변경되었습니다. 새 전달본을 검토·마감한 뒤 다시 진행하세요.");
  const review=await loadMonthEndReview(tx,COMPANY_ID,period);if(!review.bankAccounts)throw new InputError("회사 통장을 등록하고 잔액 대조를 먼저 완료하세요.");const blockers=review.checks.filter(c=>c.key!=="cash"&&c.count>0);if(blockers.length)throw new InputError(`마감 전 정리할 항목: ${blockers.map(c=>c.title).join(" · ")}`);
  if(current.snapshot.issues.some(issue=>issue.includes("매입 미연결 자재")))throw new InputError("매입 미연결 자재 원본을 먼저 확인하세요.");
  values={locked:true,packageId:saved.id,digest:saved.digest,lockedAt:new Date()};
 }else{const later=await tx.accountingPeriodLock.findFirst({where:{companyId:COMPANY_ID,period:{gt:period},locked:true},orderBy:{period:"desc"}});if(later)throw new InputError(`이후 마감월 ${later.period}부터 먼저 재개방하세요.`);if(!old?.locked)throw new InputError("마감된 월을 선택하세요.");values={locked:false,packageId:old.packageId,digest:old.digest,lockedAt:old.lockedAt};}
 let saved;if(old){const changed=await tx.accountingPeriodLock.updateMany({where:{id:old.id,companyId:COMPANY_ID,version},data:{...values,version:{increment:1}}});if(changed.count!==1)throw new InputError("마감 상태가 변경되었습니다.");saved=await tx.accountingPeriodLock.findUniqueOrThrow({where:{id:old.id}});}else saved=await tx.accountingPeriodLock.create({data:{companyId:COMPANY_ID,period,...values}});
 await tx.financeChange.create({data:{companyId:COMPANY_ID,entityId:saved.id,operation:op==="close"?"periodClose":"periodReopen",requestId,fingerprint,previous:old?JSON.parse(JSON.stringify(old)):{},next:JSON.parse(JSON.stringify(saved)),reason}});return saved.id;
}

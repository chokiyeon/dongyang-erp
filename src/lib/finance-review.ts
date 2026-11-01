import {assertPeriodsOpen} from "./period-guard";
import {createHash} from "node:crypto";
import type {Prisma} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError,text,revision} from "./validation";
import {paymentMonth} from "./payment-terms";
import {estimateCorporateTax,type TaxAssumptions} from "./corporate-tax";
import {captureAccounting} from "./accounting-delivery";
export const TAX_FIELDS={profit:"연간 예상 회계이익",addbacks:"익금산입·손금불산입",deductions:"손금산입·익금불산입",losses:"적용 가능한 이월결손금",nationalCredits:"법인세 적용 공제감면",localCredits:"지방소득세 적용 공제감면",nationalPrepaid:"법인세 기납부액",localPrepaid:"지방소득세 기납부액"} as const;
export async function saveFinance(tx:Prisma.TransactionClient,op:"tax"|"capture"|"deliver"|"close"|"reopen",d:FormData){
 const requestId=text(d,"requestId","요청",true,50);const reason=text(d,"reason","처리 사유",true,300);if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("화면을 다시 열어 주세요.");const fingerprint=createHash("sha256").update(JSON.stringify({op,values:Object.fromEntries([...d.entries()].sort(([a],[b])=>a.localeCompare(b)))})).digest("hex");const replay=await tx.financeChange.findUnique({where:{requestId}});if(replay){if(replay.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용에 사용한 요청입니다.");return replay.entityId;}
 let entityId="";let previous:Prisma.InputJsonValue={};let next:Prisma.InputJsonValue={};const period=paymentMonth(text(d,"period","대상월",true,7));
 if(op==="tax"){
  await assertPeriodsOpen(tx,period);
  if(d.get("confirmed")!=="on")throw new InputError("세무조정·공제 한도·적용 세율을 확인하세요.");const a={...Object.fromEntries(Object.entries(TAX_FIELDS).map(([key,label])=>[key,text(d,key,label,true,21)])),limits:[0,1,2].map(i=>text(d,`limit${i}`,"과세표준 구간 상한",true,20)),nationalRates:[0,1,2,3].map(i=>text(d,`nationalRate${i}`,"법인세 세율",true,6)),localRates:[0,1,2,3].map(i=>text(d,`localRate${i}`,"지방소득세 세율",true,6))} as TaxAssumptions;const result=estimateCorporateTax(a);const sourceReference=text(d,"sourceReference","사업연도·세무 검토 근거",true,300);const old=await tx.corporateTaxEstimate.findUnique({where:{companyId_period:{companyId:COMPANY_ID,period}}});const version=revision(d);if(old&&old.version!==version||!old&&version!==0)throw new InputError("법인세 추정 기준이 변경되었습니다. 다시 조회하세요.");
  let saved;if(old){const c=await tx.corporateTaxEstimate.updateMany({where:{id:old.id,companyId:COMPANY_ID,version},data:{assumptions:a,result,sourceReference,version:{increment:1}}});if(c.count!==1)throw new InputError("법인세 추정이 변경되었습니다.");saved=await tx.corporateTaxEstimate.findUniqueOrThrow({where:{id:old.id}});}else saved=await tx.corporateTaxEstimate.create({data:{companyId:COMPANY_ID,period,assumptions:a,result,sourceReference}});entityId=saved.id;previous=old?JSON.parse(JSON.stringify(old)):{};next=JSON.parse(JSON.stringify(saved));
 }else if(op==="capture"){
  const captured=await captureAccounting(tx,period);const latest=await tx.accountingPackage.findFirst({where:{companyId:COMPANY_ID,period},orderBy:{revision:"desc"}});if(latest?.digest===captured.digest){entityId=latest.id;next={id:latest.id,unchanged:true};}else{const saved=await tx.accountingPackage.create({data:{companyId:COMPANY_ID,period,revision:(latest?.revision??0)+1,digest:captured.digest,snapshot:captured.snapshot}});entityId=saved.id;next={id:saved.id,revision:saved.revision,digest:saved.digest};}
 }else{
  entityId=text(d,"packageId","전달본",true,50);const version=revision(d);const old=await tx.accountingPackage.findFirst({where:{id:entityId,companyId:COMPANY_ID,period}});if(!old||old.version!==version)throw new InputError("전달본 상태가 변경되었습니다. 다시 조회하세요.");if(op==="deliver"&&old.state!=="DRAFT"||op==="close"&&old.state!=="DELIVERED"||op==="reopen"&&!['DELIVERED','CLOSED'].includes(old.state))throw new InputError("전달본의 현재 상태와 처리 순서를 확인하세요.");if(op!=="reopen"){const current=await captureAccounting(tx,period);if(current.digest!==old.digest)throw new InputError("전달본 생성 후 원본이 변경되었습니다. 새 전달본을 생성하세요.");if(d.get("checked")!=="on")throw new InputError("누락·검토사항과 전달본 내용을 확인하세요.");}const state=op==="deliver"?"DELIVERED":op==="close"?"CLOSED":"DRAFT";const changed=await tx.accountingPackage.updateMany({where:{id:old.id,companyId:COMPANY_ID,version},data:{state,version:{increment:1}}});if(changed.count!==1)throw new InputError("전달본 상태가 변경되었습니다.");previous={state:old.state};next={state,id:old.id};
 }
 await tx.financeChange.create({data:{companyId:COMPANY_ID,requestId,fingerprint,operation:op,entityId,previous,next,reason}});return entityId;
}

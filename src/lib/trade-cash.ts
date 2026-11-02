import {assertPeriodsOpen} from "./period-guard";
import {createHash,randomUUID} from "node:crypto";
import type {Prisma} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError,text,revision} from "./validation";
const marker=(id:string)=>`trade-bank:${id}`;
/** Mirror confirmed bank allocations; callers already hold the document revision lock. */
export async function refreshTradeCashPlan(tx:Prisma.TransactionClient,documentId:string){
 const doc=await tx.tradeDocument.findFirst({where:{id:documentId,companyId:COMPANY_ID},include:{cashPlan:{include:{settlements:{where:{voidedAt:null}}}},links:{where:{voidedAt:null},include:{transaction:true}}}});
 if(!doc?.cashPlan)return;
 const plan=doc.cashPlan;
 if(plan.companyId!==COMPANY_ID)throw new InputError("같은 회사의 자금예정만 연결하세요.");
 if(!doc.voidedAt&&(!doc.proofConfirmed||!doc.dueDate||(doc.kind==="PURCHASE"&&doc.paymentMethod!=="BANK_TRANSFER")))throw new InputError("예산안 연결 중에는 원본 확인·지급기한·계좌 송금을 유지하세요. 변경하려면 예산안 연결부터 해제하세요.");
 const active=new Set(doc.links.map(link=>link.id));
 for(const s of plan.settlements){
  const linkedId=s.tradeBankLinkId??(s.requestId.startsWith("trade-bank:")?s.requestId.slice("trade-bank:".length):null);
  if(!linkedId)throw new InputError("별도로 처리된 예정입니다. 자금 실적과 매입·매출 은행 연결을 대조하세요.");
  if(!active.has(linkedId)){
   if(s.bankTransactionId){const bank=await tx.bankTransaction.findUniqueOrThrow({where:{id:s.bankTransactionId}});const lock=await tx.bankTransaction.updateMany({where:{id:bank.id,settlementVersion:bank.settlementVersion},data:{settlementVersion:{increment:1}}});if(lock.count!==1)throw new InputError("은행 실적이 변경되었습니다. 다시 조회하세요.");}
   await tx.cashSettlement.update({where:{id:s.id},data:{voidedAt:new Date(),voidReason:"매입·매출 은행 연결 해제"}});
  }
 }
 for(const link of doc.links){
  const requestId=marker(link.id);const existing=await tx.cashSettlement.findFirst({where:{OR:[{tradeBankLinkId:link.id},{requestId}]}});
  if(existing){if(existing.voidedAt||existing.planId!==plan.id||existing.bankTransactionId!==link.transactionId||!existing.amount.equals(link.amount))throw new InputError("예산안과 은행 연결 이력을 확인하세요.");if(!existing.tradeBankLinkId)await tx.cashSettlement.update({where:{id:existing.id},data:{tradeBankLinkId:link.id}});continue;}
  const bank=await tx.bankTransaction.findFirstOrThrow({where:{id:link.transactionId,account:{companyId:COMPANY_ID}},include:{cashSettlements:{where:{voidedAt:null}}}});
  const used=bank.cashSettlements.reduce((sum,s)=>sum+BigInt(s.amount.toFixed(0)),0n);
  if(bank.internalTransfer||bank.direction!==plan.direction||used+BigInt(link.amount.toFixed(0))>BigInt(bank.amount.toFixed(0)))throw new InputError("이 은행 거래가 다른 자금예정에 이미 반영되어 있습니다. 중복 실적을 먼저 확인·해제하세요.");
  const lock=await tx.bankTransaction.updateMany({where:{id:bank.id,settlementVersion:bank.settlementVersion,classificationVersion:bank.classificationVersion,internalTransfer:false},data:{settlementVersion:{increment:1}}});if(lock.count!==1)throw new InputError("은행 실적이 변경되었습니다. 다시 조회하세요.");
  await tx.cashSettlement.create({data:{tradeBankLinkId:link.id,planId:plan.id,bankTransactionId:bank.id,processedDate:bank.tradedDate,amount:link.amount,note:link.note,requestId}});
 }
 const complete=Boolean(doc.voidedAt)||doc.settledAmount.equals(doc.grossAmount);
 const changed=await tx.cashPlan.updateMany({where:{id:plan.id,companyId:COMPANY_ID,version:plan.version},data:{projectId:doc.projectId,title:`${doc.kind==="SALE"?"매출 수금":"매입 지급"} ${doc.reference} · ${doc.title}`.slice(0,200),plannedAmount:doc.grossAmount,plannedDate:doc.dueDate??plan.plannedDate,certainty:"CONFIRMED",completedAt:complete?new Date():null,completionNote:doc.voidedAt?"매입·매출 문서 취소":complete?"매입·매출 은행 연결 전액 확인":null,version:{increment:1}}});if(changed.count!==1)throw new InputError("연결된 자금예정이 변경되었습니다. 다시 조회하세요.");
}
export async function connectTradeCashPlan(tx:Prisma.TransactionClient,d:FormData){
 if(d.get("mode")==="MERGE"){const{consolidateTradeCashPlans}=await import("./trade-cash-consolidation");return consolidateTradeCashPlans(tx,d);}
 const id=text(d,"documentId","문서",true,50),version=revision(d),requestId=text(d,"requestId","요청",true,50),reason=text(d,"reason","예산안 연결 사유",true,300),mode=text(d,"mode","연결 방식",true,20),planId=text(d,"cashPlanId","기존 예정",false,50);
 if(!/^[a-f0-9-]{36}$/i.test(requestId)||!["NEW","EXISTING","DETACH"].includes(mode))throw new InputError("연결 화면을 다시 열어 주세요.");
 const fingerprint=createHash("sha256").update(JSON.stringify({id,version,mode,planId,reason})).digest("hex");
 const replay=await tx.tradeDocumentChange.findUnique({where:{requestId},include:{document:true}});if(replay){if(replay.document.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용된 요청입니다.");return id;}
 const doc=await tx.tradeDocument.findFirst({where:{id,companyId:COMPANY_ID,voidedAt:null},include:{cashPlan:{include:{settlements:{where:{voidedAt:null}}}},monthlyPayment:true,links:{where:{voidedAt:null}}}});
 if(!doc||doc.version!==version)throw new InputError("매입·매출 자료가 변경되었습니다. 다시 조회하세요.");
 await assertPeriodsOpen(tx,doc.issuedDate,doc.dueDate);
 if(mode==="DETACH"){
  if(!doc.cashPlan||doc.cashPlan.settlements.length)throw new InputError("연결된 은행 실적을 먼저 매입·매출에서 해제해야 예산안 연결을 해제할 수 있습니다.");
  const closed=await tx.cashPlan.updateMany({where:{id:doc.cashPlan.id,companyId:COMPANY_ID,version:doc.cashPlan.version},data:{completedAt:new Date(),completionNote:`매입·매출 연결 해제: ${reason}`,version:{increment:1}}});if(closed.count!==1)throw new InputError("자금예정이 변경되었습니다.");
  const lock=await tx.tradeDocument.updateMany({where:{id,version,companyId:COMPANY_ID},data:{cashPlanId:null,version:{increment:1}}});if(lock.count!==1)throw new InputError("문서가 변경되었습니다.");
 }else{
  if(doc.cashPlanId)throw new InputError("이미 예산안에 연결된 문서입니다.");
  if(!doc.proofConfirmed||!doc.dueDate||(doc.kind==="PURCHASE"&&doc.paymentMethod!=="BANK_TRANSFER"))throw new InputError("원본·기한과 계좌 송금 여부를 먼저 확인하세요. 어음은 어음대장의 예정을 사용합니다.");
  if(d.get("noDuplicate")!=="on")throw new InputError("같은 거래의 다른 입출금 예정이 없거나 기존 예정을 선택했는지 확인하세요.");
  if(doc.monthlyPayment?.cashPlanId)throw new InputError("정기 지급에 연결된 자금예정부터 확인하세요.");
  let target=mode==="EXISTING"?await tx.cashPlan.findFirst({where:{id:planId,companyId:COMPANY_ID},include:{vehicleExpense:true,tradeDocument:true,payroll:true,monthlyPayment:true,issuedNote:true,receivedNote:true,settlements:{where:{voidedAt:null}}}}):null;
  if(mode==="EXISTING"&&(!target||target.vehicleExpense||target.replacedById||target.tradeDocument||target.payroll||target.monthlyPayment||target.issuedNote||target.receivedNote||!target.plannedAmount.equals(doc.grossAmount)||(!target.settlements.length&&target.plannedDate.getTime()!==doc.dueDate.getTime())||target.direction!==(doc.kind==="SALE"?"IN":"OUT")||(target.projectId&&target.projectId!==doc.projectId)))throw new InputError("같은 금액·방향·현장의 일반 예정만 연결하세요. 실적이 없는 예정은 지급기한도 같아야 하며 다른 원본이 사용 중인 예정은 제외합니다.");
  if(target?.settlements.length){const actual=target.settlements.reduce((sum,row)=>sum+BigInt(row.amount.toFixed(0)),0n);if(target.settlements.some(row=>!row.bankTransactionId||row.amount.lte(0)||row.tradeBankLinkId)||actual>BigInt(doc.grossAmount.toFixed(0))||(target.completedAt&&actual!==BigInt(doc.grossAmount.toFixed(0))))throw new InputError("은행 실적만 있고 최종 차액 정산이 없는 기존 예정만 승계할 수 있습니다. 원본 실적을 먼저 확인하세요.");if(d.get("existingPaidConfirmed")!=="on")throw new InputError("기존 은행 실적의 거래처·현장·금액·기한과 이번 청구가 같은 거래인지 확인하세요.");}
  if(target?.completedAt&&!target.settlements.length)throw new InputError("실적 없이 종료된 예정은 연결할 수 없습니다.");
  if(!target)target=await tx.cashPlan.create({data:{projectId:doc.projectId,companyId:COMPANY_ID,direction:doc.kind==="SALE"?"IN":"OUT",certainty:"CONFIRMED",title:doc.title,category:doc.kind==="SALE"?"공사대금":"자재대금",plannedDate:doc.dueDate,plannedAmount:doc.grossAmount,requestId},include:{vehicleExpense:true,tradeDocument:true,payroll:true,monthlyPayment:true,issuedNote:true,receivedNote:true,settlements:{where:{voidedAt:null}}}});
  const planLock=await tx.cashPlan.updateMany({where:{id:target.id,companyId:COMPANY_ID,version:target.version,completedAt:target.completedAt},data:{version:{increment:1}}});if(planLock.count!==1)throw new InputError("자금예정이 변경되었습니다.");
  let documentVersion=version;
  if(target.settlements.length){
   await assertPeriodsOpen(tx,target.plannedDate);
   const held=await tx.tradeDocument.updateMany({where:{id,companyId:COMPANY_ID,version:documentVersion,cashPlanId:null,voidedAt:null},data:{version:{increment:1}}});if(held.count!==1)throw new InputError("문서가 변경되었습니다.");documentVersion++;
   const used=new Set<string>();const{linkTradeBank}=await import("./trades");
   for(const settlement of target.settlements){
    let linked=doc.links.find(link=>!used.has(link.id)&&link.transactionId===settlement.bankTransactionId&&link.amount.equals(settlement.amount));
    if(!linked){const request=randomUUID(),posted=new FormData();for(const[key,value]of Object.entries({documentId:id,transactionId:settlement.bankTransactionId!,version:String(documentVersion),requestId:request,amount:settlement.amount.toFixed(0),note:`기존 예정 은행 실적 승계: ${reason}`.slice(0,300)}))posted.set(key,value);await linkTradeBank(tx,posted);documentVersion++;linked=await tx.tradeBankLink.findUniqueOrThrow({where:{requestId:request}});}else{const bank=await tx.bankTransaction.findUniqueOrThrow({where:{id:linked.transactionId}});await assertPeriodsOpen(tx,bank.tradedDate);}
    used.add(linked.id);const changed=await tx.cashSettlement.updateMany({where:{id:settlement.id,planId:target.id,tradeBankLinkId:null,voidedAt:null},data:{tradeBankLinkId:linked.id}});if(changed.count!==1)throw new InputError("승계할 은행 실적이 변경되었습니다.");
   }
  }
  const lock=await tx.tradeDocument.updateMany({where:{id,companyId:COMPANY_ID,version:documentVersion,voidedAt:null},data:{cashPlanId:target.id,version:{increment:1}}});if(lock.count!==1)throw new InputError("문서가 변경되었습니다.");
  await refreshTradeCashPlan(tx,id);
 }
 const saved=await tx.tradeDocument.findUniqueOrThrow({where:{id}});
 await tx.tradeDocumentChange.create({data:{documentId:id,requestId,fingerprint,previous:{cashPlanId:doc.cashPlanId},next:{cashPlanId:saved.cashPlanId,operation:mode},reason}});return id;
}

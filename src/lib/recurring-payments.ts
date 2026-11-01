import {assertPeriodsOpen} from "./period-guard";
import {createHash,randomUUID} from "node:crypto";
import type {Prisma} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {paymentMonth,recurringDue,RECURRING_CATEGORIES} from "./payment-terms";
import {text,amount,date,revision,choice,InputError} from "./validation";
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
function request(d:FormData){const id=text(d,"requestId","요청",true,50);if(!/^[0-9a-f-]{36}$/i.test(id))throw new InputError("화면을 다시 열어 주세요.");return id;}
async function sourceOwners(tx:Prisma.TransactionClient,partnerId:string,projectId:string|null,companyExpense:boolean){
 const [partner,project]=await Promise.all([tx.partner.findFirst({where:{id:partnerId,companyId:COMPANY_ID,active:true,type:{in:["SUPPLIER","BOTH"]}}}),projectId?tx.project.findFirst({where:{id:projectId,companyId:COMPANY_ID,active:true}}):null]);
 if(!partner||(projectId&&!project)||(!projectId&&!companyExpense)||(projectId&&companyExpense))throw new InputError("회사 매입 거래처와 현장을 선택하세요. 현장이 없으면 본사·공통 지급을 표시하세요.");return partner;
}
export async function saveRecurringTemplate(tx:Prisma.TransactionClient,d:FormData){
 const requestId=request(d);const id=text(d,"id","정기 지급",false,50);const version=revision(d);const reference=text(d,"reference","정기 지급 코드",true,40);const title=text(d,"title","정기 지급 내용",true,150);const partnerId=text(d,"partnerId","지급 거래처",true,50);const projectId=text(d,"projectId","현장",false,50)||null;const companyExpense=d.get("companyExpense")==="on";const category=choice(text(d,"category","정기 지급 구분",true),Object.keys(RECURRING_CATEGORIES) as (keyof typeof RECURRING_CATEGORIES)[],"정기 지급 구분");const defaultAmount=amount(text(d,"defaultAmount","기본 지급액",false,20),"기본 지급액");if(defaultAmount!==null&&BigInt(defaultAmount)<=0n)throw new InputError("기본 지급액은 0보다 크게 입력하거나 변동 요금이면 비워 두세요.");
 const rawDay=text(d,"dueDay","매월 지급일",true,2);if(!/^\d{1,2}$/.test(rawDay))throw new InputError("지급일은 0(말일)~31 사이입니다.");const dueDay=Number(rawDay);const startMonth=paymentMonth(text(d,"startMonth","시작 지급월",true,7));const endInput=text(d,"endMonth","종료 지급월",false,7);const endMonth=endInput?paymentMonth(endInput):null;recurringDue(startMonth,dueDay);if(endMonth&&endMonth<startMonth)throw new InputError("종료월은 시작월보다 빠를 수 없습니다.");const active=d.get("active")==="on";const reason=text(d,"reason","정기 지급 등록·수정 사유",true,300);
 const values={reference,title,partnerId,projectId,companyExpense,category,defaultAmount,dueDay,startMonth,endMonth,active};const fingerprint=digest({id,version,values,reason});const replay=await tx.recurringPaymentChange.findUnique({where:{requestId},include:{template:true}});if(replay){if(replay.template.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용된 요청입니다.");return replay.templateId;}
 const previous=id?await tx.recurringPaymentTemplate.findFirst({where:{id,companyId:COMPANY_ID}}):null;if(id&&!previous)throw new InputError("회사 정기 지급을 선택하세요.");await sourceOwners(tx,partnerId,projectId,companyExpense);let templateId=id;
 if(previous){const updated=await tx.recurringPaymentTemplate.updateMany({where:{id,companyId:COMPANY_ID,version},data:{...values,version:{increment:1}}});if(updated.count!==1)throw new InputError("정기 지급이 변경되었습니다. 다시 조회하세요.");}else templateId=(await tx.recurringPaymentTemplate.create({data:{...values,companyId:COMPANY_ID}})).id;
 await tx.recurringPaymentChange.create({data:{templateId,requestId,fingerprint,previous:previous?JSON.parse(JSON.stringify(previous)):{},next:values,reason}});return templateId;
}
export async function generateRecurringMonth(tx:Prisma.TransactionClient,d:FormData){
 const requestId=request(d);const period=paymentMonth(text(d,"period","준비할 지급월",true,7));const prior=await tx.recurringGeneration.findUnique({where:{requestId}});if(prior){if(prior.companyId!==COMPANY_ID||prior.period!==period)throw new InputError("다른 지급월로 사용된 요청입니다.");return{period,count:prior.count};}
 await assertPeriodsOpen(tx,period);
 const templates=await tx.recurringPaymentTemplate.findMany({where:{companyId:COMPANY_ID,active:true,startMonth:{lte:period},OR:[{endMonth:null},{endMonth:{gte:period}}]},orderBy:{id:"asc"}});
 const created=await tx.monthlyPayment.createMany({data:templates.map(t=>({templateId:t.id,period,title:t.title,partnerId:t.partnerId,projectId:t.projectId,companyExpense:t.companyExpense,amount:t.defaultAmount,dueDate:new Date(recurringDue(period,t.dueDay))})),skipDuplicates:true});
 await tx.recurringGeneration.create({data:{companyId:COMPANY_ID,requestId,period,count:created.count}});return{period,count:created.count};
}
export async function confirmMonthlyPayment(tx:Prisma.TransactionClient,d:FormData){
 const id=text(d,"monthlyId","월별 지급",true,50);const version=revision(d);const requestId=request(d);const value=amount(text(d,"amount","이번 달 실제 지급예정액",true,20),"이번 달 실제 지급예정액")!;if(BigInt(value)<=0n)throw new InputError("실제 지급예정액은 0보다 커야 합니다.");const dueDate=date(text(d,"dueDate","이번 달 지급기한",true),"이번 달 지급기한")!;const mode=choice(text(d,"sourceMode","자료 연결",true),["INVOICE","EXISTING_PLAN","NEW_PLAN"] as const,"자료 연결");const documentId=text(d,"documentId","매입 문서",false,50);const planId=text(d,"cashPlanId","기존 지출 예정",false,50);const reason=text(d,"reason","월별 지급 확인 사유",true,300);if(d.get("confirmed")!=="on")throw new InputError("이번 달 금액과 동일한 청구서·예정의 중복 여부를 확인하세요.");
 const fingerprint=digest({id,version,value,dueDate,mode,documentId,planId,reason});const replay=await tx.recurringPaymentChange.findUnique({where:{requestId},include:{template:true}});if(replay){if(replay.template.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용된 요청입니다.");return replay.monthlyPaymentId!;}
 const row=await tx.monthlyPayment.findFirst({where:{id,template:{companyId:COMPANY_ID}},include:{document:true,cashPlan:{include:{settlements:{where:{voidedAt:null}}}}}});if(!row||row.version!==version||row.voidedAt)throw new InputError("월별 지급 내역이 변경되었습니다. 다시 조회하세요.");await assertPeriodsOpen(tx,row.period);const partner=await sourceOwners(tx,row.partnerId,row.projectId,row.companyExpense);
 if(row.document&&row.document.settledAmount.toFixed(0)!=="0")throw new InputError("연결된 매입에 지급 실적이 있습니다. 원본 매입과 은행 연결부터 확인하세요.");
 if(row.document&&!row.document.voidedAt&&mode!=="INVOICE")throw new InputError("유효한 매입 문서가 연결되어 있습니다. 같은 지급을 별도 지출 예정으로 중복 만들 수 없습니다.");
 if(row.cashPlan&&(row.cashPlan.settlements.length||row.cashPlan.completedAt))throw new InputError("실적이 있거나 완료된 정기 지급입니다. 실제 처리 내역부터 확인하세요.");
 let sourcePlan:string|null=null;let sourceDoc:string|null=null;
 if(mode==="INVOICE"){
  const doc=await tx.tradeDocument.findFirst({where:{id:documentId,companyId:COMPANY_ID,kind:"PURCHASE",voidedAt:null},include:{monthlyPayment:true}});
  if(!doc||doc.partnerId!==row.partnerId||doc.projectId!==row.projectId||doc.companyExpense!==row.companyExpense||doc.grossAmount.toFixed(0)!==value||!doc.dueDate||doc.dueDate.getTime()!==dueDate.getTime()||doc.paymentMethod!=="BANK_TRANSFER"||(doc.monthlyPayment&&doc.monthlyPayment.id!==row.id))throw new InputError("같은 거래처·현장·금액의 계좌 송금 매입 문서만 연결하세요. 이미 연결된 문서는 제외됩니다.");sourceDoc=doc.id;
 }else if(mode==="EXISTING_PLAN"){
  const plan=await tx.cashPlan.findFirst({where:{id:planId,companyId:COMPANY_ID,payroll:null,tradeDocument:null},include:{issuedNote:true,receivedNote:true,monthlyPayment:true,settlements:{where:{voidedAt:null}}}});
  if(!plan||plan.direction!=="OUT"||plan.completedAt||plan.issuedNote||plan.receivedNote||plan.category==="어음결제"||plan.settlements.length||plan.plannedAmount.toFixed(0)!==value||plan.plannedDate.getTime()!==dueDate.getTime()||(plan.monthlyPayment&&plan.monthlyPayment.id!==row.id))throw new InputError("금액·지급기한이 같은 미처리 지출 예정만 연결하세요. 어음·이미 연결된 예정은 제외됩니다.");
  const changed=await tx.cashPlan.updateMany({where:{id:plan.id,companyId:COMPANY_ID,version:plan.version,completedAt:null},data:{version:{increment:1}}});if(changed.count!==1)throw new InputError("연결할 지출 예정이 변경되었습니다.");sourcePlan=plan.id;
 }else{
  if(d.get("noDuplicate")!=="on")throw new InputError("동일한 매입 문서나 기존 지출 예정이 없다는 확인이 필요합니다.");
  sourcePlan=(await tx.cashPlan.create({data:{companyId:COMPANY_ID,direction:"OUT",certainty:"CONFIRMED",title:`정기지급 ${row.period} ${row.title} · ${partner.name}`,category:row.projectId?"현장경비":"기타",plannedDate:dueDate,plannedAmount:value,requestId:randomUUID()}})).id;
 }
 if(row.cashPlan&&row.cashPlanId!==sourcePlan){const changed=await tx.cashPlan.updateMany({where:{id:row.cashPlan.id,companyId:COMPANY_ID,version:row.cashPlan.version,completedAt:null},data:{completedAt:new Date(),completionNote:`정기 지급 연결 변경: ${reason}`,version:{increment:1}}});if(changed.count!==1)throw new InputError("기존 지급 예정이 변경되었습니다.");}
 const changed=await tx.monthlyPayment.updateMany({where:{id,version,template:{companyId:COMPANY_ID},voidedAt:null},data:{amount:value,dueDate,cashPlanId:sourcePlan,documentId:sourceDoc,confirmed:true,version:{increment:1}}});if(changed.count!==1)throw new InputError("다른 화면에서 월별 지급을 변경했습니다.");
 await tx.recurringPaymentChange.create({data:{templateId:row.templateId,monthlyPaymentId:id,requestId,fingerprint,previous:{amount:row.amount?.toFixed(0)??null,cashPlanId:row.cashPlanId,documentId:row.documentId},next:{amount:value,dueDate:dueDate.toISOString().slice(0,10),cashPlanId:sourcePlan,documentId:sourceDoc,confirmed:true},reason}});return id;
}

export async function voidMonthlyPayment(tx:Prisma.TransactionClient,d:FormData){
 const id=text(d,"monthlyId","월별 지급",true,50);const version=revision(d);const requestId=request(d);const reason=text(d,"reason","월별 지급 취소 사유",true,300);const fingerprint=digest({id,version,reason,void:true});const replay=await tx.recurringPaymentChange.findUnique({where:{requestId},include:{template:true}});if(replay){if(replay.template.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용한 요청입니다.");return id;}
 const row=await tx.monthlyPayment.findFirst({where:{id,template:{companyId:COMPANY_ID}},include:{cashPlan:{include:{settlements:{where:{voidedAt:null}}}}}});if(!row||row.version!==version||row.voidedAt)throw new InputError("월별 지급이 변경되었거나 이미 취소됐습니다.");
 await assertPeriodsOpen(tx,row.period);
 if(row.cashPlan){if(row.cashPlan.settlements.length)throw new InputError("실제 처리 실적을 먼저 취소한 뒤 월별 지급을 취소하세요.");const changed=await tx.cashPlan.updateMany({where:{id:row.cashPlan.id,companyId:COMPANY_ID,version:row.cashPlan.version},data:{completedAt:new Date(),completionNote:`월별 정기 지급 취소: ${reason}`,version:{increment:1}}});if(changed.count!==1)throw new InputError("지출 예정이 변경됐습니다.");}
 const changed=await tx.monthlyPayment.updateMany({where:{id,version,voidedAt:null,template:{companyId:COMPANY_ID}},data:{voidedAt:new Date(),version:{increment:1}}});if(changed.count!==1)throw new InputError("월별 지급이 변경됐습니다.");
 await tx.recurringPaymentChange.create({data:{templateId:row.templateId,monthlyPaymentId:id,requestId,fingerprint,previous:{confirmed:row.confirmed,cashPlanId:row.cashPlanId,documentId:row.documentId},next:{voided:true},reason}});return id;
}

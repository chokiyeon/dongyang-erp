import {createHash} from "node:crypto";
import type {Prisma,PrismaClient} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError,text,revision} from "./validation";
import {signedAmount,koreanToday,saveBaseline} from "./forecast";
import {paymentMonth,recurringDue} from "./payment-terms";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function reconcileBankBalance(opening:string,closing:string,rows:{direction:"IN"|"OUT";amount:string}[]){
 const start=BigInt(signedAmount(opening)),actual=BigInt(signedAmount(closing));let incoming=0n,outgoing=0n;for(const row of rows){if(!/^(0|[1-9]\d{0,19})$/.test(row.amount))throw new InputError("은행 거래금액의 범위를 확인하세요.");if(row.direction==="IN")incoming+=BigInt(row.amount);else outgoing+=BigInt(row.amount);}
 const calculated=start+incoming-outgoing;return{incoming,outgoing,calculated,difference:actual-calculated};
}
export async function bankReconciliationMonth(db:PrismaClient|Prisma.TransactionClient,companyId:string,period:string){
 paymentMonth(period);const range={gte:new Date(`${period}-01`),lte:new Date(recurringDue(period,0))};
 const accounts=await db.bankAccount.findMany({where:{companyId},include:{transactions:{where:{tradedDate:range},orderBy:{id:"asc"},select:{id:true,tradedDate:true,direction:true,amount:true,bankBalance:true}},reconciliations:{where:{period}}},orderBy:{id:"asc"}});
 const rows=accounts.map(account=>{const record=account.reconciliations[0];const basis=digest(account.transactions.map(r=>({id:r.id,date:r.tradedDate.toISOString().slice(0,10),direction:r.direction,amount:r.amount.toFixed(0),balance:r.bankBalance?.toFixed(0)??null})));const flow=reconcileBankBalance("0","0",account.transactions.map(r=>({direction:r.direction,amount:r.amount.toFixed(0)})));const calculation=record?reconcileBankBalance(record.openingBalance.toFixed(0),record.closingBalance.toFixed(0),account.transactions.map(r=>({direction:r.direction,amount:r.amount.toFixed(0)}))):null;
  const ready=Boolean(record?.confirmed&&record.basis===basis&&calculation?.difference===0n);return{account,record,basis,calculation,ready,incoming:flow.incoming,outgoing:flow.outgoing};});
 const basis=digest(rows.map(row=>({accountId:row.account.id,basis:row.basis,recordId:row.record?.id??null,revision:row.record?.version??null,opening:row.record?.openingBalance.toFixed(0)??null,closing:row.record?.closingBalance.toFixed(0)??null,confirmed:row.record?.confirmed??false})));
 return{rows,basis,ready:rows.length>0&&rows.every(row=>row.ready),closing:rows.reduce((sum,row)=>sum+BigInt(row.record?.closingBalance.toFixed(0)??"0"),0n)};
}
export async function saveBankReconciliation(tx:Prisma.TransactionClient,d:FormData){
 const accountId=text(d,"accountId","통장",true,50),period=paymentMonth(text(d,"period","대조월",true,7)),version=revision(d),basis=text(d,"basis","거래 기준",true,64),requestId=text(d,"requestId","요청",true,50),reason=text(d,"reason","잔액 대조 사유",true,300);
 if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("통장 잔액 대조 화면을 다시 열어 주세요.");
 const fingerprint=digest(Object.fromEntries([...d.entries()].sort(([a],[b])=>a.localeCompare(b))));const replay=await tx.financeChange.findUnique({where:{requestId}});if(replay){if(replay.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용한 요청입니다.");return replay.entityId;}
 if(recurringDue(period,0)>koreanToday())throw new InputError("월말이 지난 기간의 잔액을 대조하세요.");
 const month=await bankReconciliationMonth(tx,COMPANY_ID,period),row=month.rows.find(row=>row.account.id===accountId);if(!row||row.basis!==basis)throw new InputError("은행 거래가 변경되었습니다. 다시 조회하세요.");if((row.record?.version??0)!==version)throw new InputError("잔액 대조 내용이 변경되었습니다.");
 const openingBalance=signedAmount(text(d,"openingBalance","월초 잔액",true,21)),closingBalance=signedAmount(text(d,"closingBalance","은행 월말 잔액",true,21)),sourceReference=text(d,"sourceReference","은행 원본 확인 근거",true,300),confirmed=d.get("confirmed")==="on";
 const calculation=reconcileBankBalance(openingBalance,closingBalance,row.account.transactions.map(r=>({direction:r.direction,amount:r.amount.toFixed(0)})));if(confirmed&&calculation.difference!==0n)throw new InputError("장부 계산 잔액과 은행 잔액이 다릅니다. 거래 누락·이월 잔액을 확인하거나 미확인 상태로 저장하세요.");
 const lock=await tx.bankAccount.updateMany({where:{id:accountId,companyId:COMPANY_ID,version:row.account.version},data:{version:{increment:1}}});if(lock.count!==1)throw new InputError("통장 또는 은행 거래가 변경되었습니다. 다시 조회하세요.");
 const values={openingBalance,closingBalance,basis,sourceReference,confirmed};let saved;if(row.record){const changed=await tx.bankReconciliation.updateMany({where:{id:row.record.id,version},data:{...values,version:{increment:1}}});if(changed.count!==1)throw new InputError("잔액 대조 내용이 변경되었습니다.");saved=await tx.bankReconciliation.findUniqueOrThrow({where:{id:row.record.id}});}else saved=await tx.bankReconciliation.create({data:{accountId,period,...values}});
 await tx.financeChange.create({data:{companyId:COMPANY_ID,entityId:saved.id,requestId,fingerprint,operation:"bankReconciliation",previous:row.record?JSON.parse(JSON.stringify(row.record)):{},next:JSON.parse(JSON.stringify(saved)),reason}});return saved.id;
}
export async function baselineFromReconciliation(tx:Prisma.TransactionClient,d:FormData){
 const period=paymentMonth(text(d,"period","대조월",true,7)),requestId=text(d,"requestId","요청",true,50),reason=text(d,"reason","기준 잔액 반영 사유",true,300),expected=text(d,"basis","대조 기준",true,64),version=revision(d);
 if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("잔액 대조 화면을 다시 열어 주세요.");const fingerprint=digest({period,reason,expected,version});const replay=await tx.financeChange.findUnique({where:{requestId}});if(replay){if(replay.companyId!==COMPANY_ID||replay.fingerprint!==fingerprint)throw new InputError("다른 내용으로 사용한 요청입니다.");return replay.entityId;}
 const month=await bankReconciliationMonth(tx,COMPANY_ID,period);if(!month.ready||month.basis!==expected)throw new InputError("모든 회사 통장의 잔액 대조를 완료하고 다시 조회하세요. 사용 중지 통장도 포함합니다.");if(d.get("confirmed")!=="on")throw new InputError("대출 한도를 더하지 않은 실제 순잔액인지 확인하세요.");
 for(const row of month.rows){const lock=await tx.bankAccount.updateMany({where:{id:row.account.id,companyId:COMPANY_ID,version:row.account.version},data:{version:{increment:1}}});if(lock.count!==1)throw new InputError("통장 또는 은행 거래가 변경되었습니다.");}
 const input=new FormData();input.set("baseDate",recurringDue(period,0));input.set("baseAmount",month.closing.toString());input.set("baseNote",`통장 잔액 대조 합산 ${period}: ${reason}`.slice(0,300));input.set("version",String(version));await saveBaseline(tx,input);
 const baseline=await tx.cashBaseline.update({where:{companyId_revision:{companyId:COMPANY_ID,revision:version+1}},data:{reconciliationPeriod:period,reconciliationBasis:month.basis}});
 await tx.financeChange.create({data:{companyId:COMPANY_ID,entityId:baseline.id,requestId,fingerprint,operation:"reconciledBaseline",previous:{},next:{period,basis:month.basis,amount:month.closing.toString()},reason}});return baseline.id;
}

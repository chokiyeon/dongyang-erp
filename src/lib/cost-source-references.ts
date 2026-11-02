import type {Prisma,PrismaClient} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
export type CostSourceIdentity={sourceType:string;sourceId:string};
export type CostSourceReference={reference:string;title:string;sourceDate:string;active:boolean;href:string};
export const costSourceKey=(source:CostSourceIdentity)=>`${source.sourceType}:${source.sourceId}`;
export async function costSourceReferences(db:PrismaClient|Prisma.TransactionClient,sources:CostSourceIdentity[],companyId=COMPANY_ID){
 const ids=(type:string)=>[...new Set(sources.filter(s=>s.sourceType===type).map(s=>s.sourceId))];
 const [trades,payrolls,vehicles]=await Promise.all([
  db.tradeDocument.findMany({where:{id:{in:ids("TRADE")},companyId,kind:"PURCHASE"},include:{partner:true}}),
  db.payrollPayment.findMany({where:{id:{in:ids("PAYROLL")},employee:{companyId}},include:{employee:true}}),
  db.vehicleExpense.findMany({where:{id:{in:ids("VEHICLE")},vehicle:{companyId}},include:{vehicle:true}}),
 ]);
 const result=new Map<string,CostSourceReference>();
 for(const d of trades)result.set(costSourceKey({sourceType:"TRADE",sourceId:d.id}),{reference:d.reference,title:`${d.partner.name} · ${d.title}`,sourceDate:d.issuedDate.toISOString().slice(0,10),active:!d.voidedAt,href:d.voidedAt?`/trades?kind=PURCHASE&cancelled=1&q=${encodeURIComponent(d.reference)}`:`/trades?edit=${d.id}`});
 for(const p of payrolls)result.set(costSourceKey({sourceType:"PAYROLL",sourceId:p.id}),{reference:`${p.period} · ${p.employee.code}`,title:p.employee.name,sourceDate:p.period,active:!p.voidedAt,href:`/payroll-payments?period=${p.period}&employee=${p.employeeId}`});
 for(const v of vehicles)result.set(costSourceKey({sourceType:"VEHICLE",sourceId:v.id}),{reference:`${v.vehicle.plate} · ${v.reference}`,title:v.title,sourceDate:v.incurredDate.toISOString().slice(0,10),active:!v.voidedAt,href:`/vehicles?vehicle=${v.vehicleId}&period=${v.incurredDate.toISOString().slice(0,7)}${v.voidedAt?"":`&expense=${v.id}`}`});
 return result;
}

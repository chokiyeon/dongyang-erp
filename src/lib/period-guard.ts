import type {Prisma} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {paymentMonth} from "./payment-terms";
import {InputError} from "./validation";
export async function acquirePeriodReviewLock(tx:Prisma.TransactionClient){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`erp-period:${COMPANY_ID}`})::bigint)`;}
export async function assertPeriodsOpen(tx:Prisma.TransactionClient,...dates:(Date|string|null|undefined)[]){
 const periods=[...new Set(dates.filter((d):d is Date|string=>Boolean(d)).map(d=>paymentMonth((d instanceof Date?d.toISOString():d).slice(0,7))))];if(!periods.length)return;
 await acquirePeriodReviewLock(tx);const closed=await tx.accountingPeriodLock.findFirst({where:{companyId:COMPANY_ID,period:{gte:[...periods].sort()[0]},locked:true},orderBy:{period:"asc"}});if(closed)throw new InputError(`${closed.period} 장부는 마감되어 있습니다. 이 월과 이전 기간은 보호됩니다. 마감 검토 화면에서 사유를 남겨 재개방한 뒤 수정하세요.`);
}
export async function assertEmploymentPeriodsOpen(tx:Prisma.TransactionClient,employeeId:string,from?:Date){
 await acquirePeriodReviewLock(tx);const closed=await tx.accountingPeriodLock.findMany({where:{companyId:COMPANY_ID,locked:true,...(from?{period:{gte:from.toISOString().slice(0,7)}}:{})}});
 for(const period of closed){const employee=await tx.employee.findFirst({where:{id:employeeId,companyId:COMPANY_ID}});if(!employee)continue;const fromMonth=employee.startDate.toISOString().slice(0,7),toMonth=employee.endDate?.toISOString().slice(0,7);if(period.period>=fromMonth&&(!toMonth||period.period<=toMonth))throw new InputError(`${period.period} 마감월에 영향을 주는 계약·고용 기간 변경입니다. 먼저 해당 월을 재개방하세요.`);}
}

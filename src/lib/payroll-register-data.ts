import type {laborMonth} from "./labor";
export type PayrollMonth=Awaited<ReturnType<typeof laborMonth>>;
export function dailyPayrollGroups(data:PayrollMonth){
 const dayCount=new Date(Date.UTC(Number(data.period.slice(0,4)),Number(data.period.slice(5)),0)).getUTCDate();
 const groups=new Map<string,{employeeId:string;employee:string;code:string;project:string;role:string;rate:bigint;days:bigint[];units:bigint;amount:bigint}>();
 for(const person of data.daily)for(const line of person.lines){const key=`${person.employee.id}:${line.projectId}:${line.role}:${line.rateAmount.toFixed(0)}`;const group=groups.get(key)??{employeeId:person.employee.id,employee:person.employee.name,code:person.employee.code,project:`${line.project.code} · ${line.project.name}`,role:line.role==="SIGNAL"?"신호수":"일반",rate:BigInt(line.rateAmount.toFixed(0)),days:Array<bigint>(dayCount).fill(0n),units:0n,amount:0n};const units=BigInt(line.units.toFixed(2).replace(".",""));group.days[line.workedDate.getUTCDate()-1]+=units;group.units+=units;group.amount+=BigInt(line.amount.toFixed(0));groups.set(key,group);}
 return{dayCount,groups};
}

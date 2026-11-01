import {InputError} from "./validation";
export const DAILY_DEDUCTIONS=[["incomeTax","소득세"],["localTax","주민세"],["employment","고용보험"],["pension","국민연금"],["health","건강보험"],["care","장기요양"],["union","노조 조합비"],["other","기타 공제"]] as const;
export type DailyDeduction=typeof DAILY_DEDUCTIONS[number][0];
export type DailyRateGroup={key:string;role:string;units:string};
export type DailyPayDetails={version:1;groups:(DailyRateGroup&{grossRate:string})[];deductions:Record<DailyDeduction,string>};
const limit=99999999999999999999n;
function money(v:string,label:string){if(typeof v!=="string"||!/^(0|[1-9]\d{0,19})$/.test(v))throw new InputError(`${label}: 원 단위 금액을 입력하세요. 해당 없으면 0을 입력하세요.`);return BigInt(v);}
function units(v:string){if(typeof v!=="string"||!/^(0|[1-9]\d{0,5})(\.\d{1,2})?$/.test(v))throw new InputError("일수는 소수 둘째 자리까지 확인하세요.");const[w,f=""]=v.split(".");const n=BigInt(w)*100n+BigInt(f.padEnd(2,"0"));if(n<=0n)throw new InputError("일수는 0보다 커야 합니다.");return n;}
export function dailyRateGroups(lines:{role:string;rate:string;units:string}[]):DailyRateGroup[]{const groups=new Map<string,{key:string;role:string;count:bigint}>();for(const line of lines){const key=`${line.role}:${line.rate}`;const row=groups.get(key)??{key,role:line.role,count:0n};row.count+=units(line.units);groups.set(key,row);}return [...groups.values()].map(row=>({key:row.key,role:row.role,units:`${row.count/100n}.${(row.count%100n).toString().padStart(2,"0")}`}));}
export function calculateDailyPay(groups:DailyPayDetails["groups"],values:Record<string,string>){
 if(!groups.length)throw new InputError("확인할 일수·일당 내역이 없습니다.");let gross=0n;const keys=new Set<string>();for(const row of groups){if(keys.has(row.key)||!["NORMAL","SIGNAL"].includes(row.role))throw new InputError("일당 구분을 다시 확인하세요.");keys.add(row.key);const rate=money(row.grossRate,"공제 전 일당");if(rate<=0n)throw new InputError("공제 전 일당은 0보다 커야 합니다.");const amount=rate*units(row.units);if(amount%100n)throw new InputError("일당 × 일수에 원 미만 금액이 있습니다.");gross+=amount/100n;}
 const deductions={} as Record<DailyDeduction,string>;let deducted=0n;for(const[key,label]of DAILY_DEDUCTIONS){const value=money(values[key]??"",label);deductions[key]=value.toString();deducted+=value;}
 if(gross>limit||deducted>limit)throw new InputError("급여 합계가 저장 범위를 초과합니다.");if(deducted>gross)throw new InputError("공제합계가 지급총액을 초과합니다.");return{gross,deducted,net:gross-deducted,details:{version:1 as const,groups,deductions}};
}
export function readDailyPayDetails(snapshot:unknown):DailyPayDetails|null{if(!snapshot||typeof snapshot!=="object"||!("dailyDetails"in snapshot))return null;const d=snapshot.dailyDetails as Partial<DailyPayDetails>|null;if(!d||d.version!==1||!Array.isArray(d.groups)||!d.deductions)return null;try{for(const r of d.groups)if(!r||typeof r.key!=="string"||typeof r.units!=="string"||typeof r.grossRate!=="string")return null;return calculateDailyPay(d.groups,d.deductions).details;}catch{return null;}}

export function dailyAttendanceSummary(lines:{date:string;units:string}[]){const count=lines.reduce((sum,row)=>sum+units(row.units),0n);return{units:`${count/100n}.${(count%100n).toString().padStart(2,"0")}`,days:new Set(lines.map(row=>row.date.slice(0,10))).size};}

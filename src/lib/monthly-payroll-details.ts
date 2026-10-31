import {InputError} from "./validation";
export const MONTHLY_PAY_FIELDS = [
 ["basic","기본급","earnings"],["job","직무(업무)수당","earnings"],["fixedOvertime","고정연장수당","earnings"],["fixedHoliday","고정휴일수당","earnings"],["extraOvertime","추가연장수당","earnings"],["extraHoliday","추가휴일수당","earnings"],["qualification","자격수당","earnings"],["annualLeave","연차수당","earnings"],["vehicle","차량유지","earnings"],["meal","식대보조","earnings"],
 ["late","지각·조퇴 공제","attendance"],["absence","결근 공제","attendance"],
 ["incomeTax","소득세","deductions"],["localTax","주민세","deductions"],["pension","국민연금","deductions"],["employment","고용보험","deductions"],["health","건강보험","deductions"],["care","장기요양","deductions"],["advance","가불금·기타 공제","deductions"],["adjustment","연말정산 조정액 (+환급 / -추가공제)","adjustment"],
] as const;
export type MonthlyPayKey=typeof MONTHLY_PAY_FIELDS[number][0];
export type MonthlyPayDetails={version:1;amounts:Record<MonthlyPayKey,string>};
const maximum=99999999999999999999n;
export function calculateMonthlyPay(values:Record<string,string>){
 const amounts={} as Record<MonthlyPayKey,string>;let earnings=0n,attendance=0n,deductions=0n,adjustment=0n;
 for(const[key,label,group]of MONTHLY_PAY_FIELDS){const value=values[key]??"";if(!(key==="adjustment"?/^-?(0|[1-9]\d{0,19})$/:/^(0|[1-9]\d{0,19})$/).test(value))throw new InputError(`${label}: 원 단위 정수를 입력하세요. 해당 없으면 0을 입력하세요.`);const n=BigInt(value);amounts[key]=n.toString();if(group==="earnings")earnings+=n;else if(group==="attendance")attendance+=n;else if(group==="deductions")deductions+=n;else adjustment=n;}
 const gross=earnings-attendance;const net=gross-deductions+adjustment;
 if(gross<0n||net<0n)throw new InputError("공제액이 지급액을 초과합니다. 급여 내역을 확인하세요.");
 if([earnings,attendance,deductions,gross,net].some(n=>n>maximum))throw new InputError("급여 합계는 20자리 이하로 입력하세요.");
 return{details:{version:1 as const,amounts},earnings,attendance,deductions,adjustment,gross,net};
}
export function readMonthlyPayDetails(snapshot:unknown):MonthlyPayDetails|null{
 if(!snapshot||typeof snapshot!=="object"||!("monthlyDetails"in snapshot))return null;
 const value=snapshot.monthlyDetails;if(!value||typeof value!=="object"||!("version"in value)||value.version!==1||!("amounts"in value)||!value.amounts||typeof value.amounts!=="object")return null;
 const fields=value.amounts as Record<string,unknown>;if(MONTHLY_PAY_FIELDS.some(([key])=>typeof fields[key]!=="string"))return null;
 try{return calculateMonthlyPay(fields as Record<string,string>).details;}catch{return null;}
}

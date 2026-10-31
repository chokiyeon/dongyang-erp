import {InputError} from "./validation";
const MAX=99999999999999999999n;
export const SALARY_DEDUCTIONS=[["pension","국민연금"],["health","건강보험"],["care","장기요양"],["employment","고용보험"],["incomeTax","소득세"],["localTax","지방소득세"],["other","기타 공제"]] as const;
export function calculatorMoney(value:string,label:string){if(!/^(0|[1-9]\d{0,19})$/.test(value))throw new InputError(`${label}은 원 단위 정수로 입력하세요.`);return BigInt(value);}
export function manwonToWon(value:string){if(!/^(0|[1-9]\d{0,15})(\.\d{1,4})?$/.test(value))throw new InputError("세후 월급은 만원 단위로 소수 넷째 자리까지 입력하세요.");const[w,f=""]=value.split(".");const n=BigInt(w)*10000n+BigInt(f.padEnd(4,"0"));if(n<=0n||n>MAX)throw new InputError("세후 월급의 입력 범위를 확인하세요.");return n.toString();}
export function reverseSalary(input:{target:string;mode:"FIXED"|"RATE";deductions?:Record<string,string>;rate?:string;fixed?:string}){
 const target=calculatorMoney(input.target,"목표 실수령액");if(target===0n)throw new InputError("목표 실수령액은 0보다 커야 합니다.");
 if(input.mode==="FIXED"){
  const lines=SALARY_DEDUCTIONS.map(([key,label])=>({label,amount:calculatorMoney(input.deductions?.[key]??"",label)}));const deduction=lines.reduce((s,l)=>s+l.amount,0n);const gross=target+deduction;if(gross>MAX)throw new InputError("세전 급여가 계산 범위를 초과합니다.");return{gross,net:target,deduction,lines};
 }
 const rate=input.rate??"";if(!/^(0|[1-9]\d?)(\.\d{1,4})?$/.test(rate))throw new InputError("합산 공제율은 0 이상 100 미만, 소수 넷째 자리까지 입력하세요.");const[w,f=""]=rate.split(".");const fraction=BigInt(w)*10000n+BigInt(f.padEnd(4,"0"));const fixed=calculatorMoney(input.fixed??"","고정 공제액");
 const net=(gross:bigint)=>gross-gross*fraction/1000000n-fixed;
 if(net(MAX)<target)throw new InputError("세전 급여가 계산 범위를 초과합니다.");
 let low=target,high=MAX;while(low<high){const mid=(low+high)/2n;if(net(mid)>=target)high=mid;else low=mid+1n;}
 const variable=low*fraction/1000000n;return{gross:low,net:net(low),deduction:variable+fixed,lines:[{label:`입력 합산 공제율 ${rate}% (원 미만 버림)`,amount:variable},{label:"별도 고정 공제액",amount:fixed}]};
}

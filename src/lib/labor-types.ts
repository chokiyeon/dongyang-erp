import {InputError} from "./validation";
export const EMPLOYMENT_KINDS={DAILY:"일용·일당제",MONTHLY:"사무실 월급제"} as const;
export const LABOR_ROLES={NORMAL:"일반 작업",SIGNAL:"신호수"} as const;
export function laborUnits(value:string){
 if(!/^(?:[0-9])(?:\.[0-9]{1,2})?$/.test(value))throw new InputError("공수는 0보다 크고 10보다 작은 소수 둘째 자리까지 입력하세요.");
 const [whole,part=""]=value.split(".");const cents=BigInt(whole)*100n+BigInt(part.padEnd(2,"0"));
 if(cents<=0n)throw new InputError("공수는 0보다 커야 합니다.");return cents;
}
export function laborAmount(rate:string,units:string){const total=BigInt(rate)*laborUnits(units);if(total%100n!==0n)throw new InputError("공수와 일당의 계산 결과가 원 미만입니다. 계약 기준을 확인하세요.");const result=(total/100n).toString();if(result.length>20)throw new InputError("계산 금액이 저장 범위를 초과합니다.");return result;}

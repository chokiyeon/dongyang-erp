import {date,InputError} from "./validation";
export const PAYMENT_TERMS={MANUAL:"기한 직접 입력",IMMEDIATE:"증빙일 즉시 지급",NEXT_MONTH_END:"증빙 다음 달 말일 지급"} as const;
export const PAYMENT_METHODS={UNCONFIRMED:"지급방법 확인 필요",BANK_TRANSFER:"계좌 송금",ISSUED_NOTE:"어음 지급",OTHER:"기타 지급"} as const;
export const RECURRING_CATEGORIES={RENT:"숙소·사무실 월세",ELECTRICITY:"전기요금",WATER:"수도요금",GAS:"가스요금",OTHER:"기타 정기 지급"} as const;
export function paymentDue(issued:string,term:keyof typeof PAYMENT_TERMS):string|null{
 const value=date(issued,"증빙일");if(!value)throw new InputError("증빙일을 입력하세요.");if(term==="MANUAL")return null;if(term==="IMMEDIATE")return issued;
 const next=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+2,0)).toISOString().slice(0,10);date(next,"계산 지급일");return next;
}
export function paymentMonth(value:string):string{if(!/^\d{4}-\d{2}$/.test(value))throw new InputError("지급월을 YYYY-MM 형식으로 입력하세요.");date(`${value}-01`,"지급월");return value;}
export function recurringDue(period:string,dueDay:number):string{
 paymentMonth(period);if(!Number.isSafeInteger(dueDay)||dueDay<0||dueDay>31)throw new InputError("지급일은 0(말일)~31 사이로 입력하세요.");const first=new Date(`${period}-01`);const end=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0));return new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),dueDay===0?end.getUTCDate():Math.min(dueDay,end.getUTCDate()))).toISOString().slice(0,10);
}
export function normalizePayeeAccount(value:string){const digits=value.replace(/[\s-]/g,"");if(!/^\d{6,30}$/.test(digits)||!/^[\d\s-]+$/.test(value))throw new InputError("송금 계좌번호는 숫자·공백·하이픈으로 입력하세요.");return value.trim();}

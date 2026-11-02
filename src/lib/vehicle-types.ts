export const VEHICLE_KINDS={TRUCK:"트럭",SEDAN:"승용차",OTHER:"기타 보유 차량"} as const;
export const VEHICLE_USAGE={FIXED:"현장 고정",SHARED:"여러 현장 공용",OFFICE:"본사 업무"} as const;
export const VEHICLE_CATEGORIES={FUEL:"유류비",REPAIR:"정비·수리",INSURANCE:"보험료",TAX:"자동차세",TOLL:"통행료",PARKING:"주차비",FINE:"과태료",PENALTY:"범칙금·벌금",OTHER:"기타 차량비"} as const;
export const VEHICLE_PAYERS={COMPANY:"회사 부담",DRIVER:"운전자 부담",UNKNOWN:"부담 주체 확인 필요"} as const;
export const VEHICLE_PAYMENTS={UNCONFIRMED:"납부 확인 필요",UNPAID:"미납부",PAID:"납부 확인"} as const;
export const VEHICLE_OPERATIONS:Record<string,string>={expenseCash:"은행 지급 대조",expenseLink:"매입 원본 연결·해제",vehicle:"차량 정보",assignment:"현장 사용",assignmentVoid:"현장 사용 취소",expense:"비용·위반 내역",expenseVoid:"비용·위반 취소"};

export function vehiclePaymentLabel(expense:{paymentStatus:string;cashPlanId?:string|null;document?:{settledAmount:{toFixed(n:number):string};grossAmount:{toFixed(n:number):string}}|null}){
 if(expense.cashPlanId)return "은행 출금 대조 완료";
 if(!expense.document)return VEHICLE_PAYMENTS[expense.paymentStatus as keyof typeof VEHICLE_PAYMENTS]??expense.paymentStatus;
 const paid=BigInt(expense.document.settledAmount.toFixed(0)),gross=BigInt(expense.document.grossAmount.toFixed(0));
 return paid>=gross?"매입 은행 지급 완료":paid>0n?`매입 일부 지급 · 잔액 ${(gross-paid).toLocaleString()}원`:"매입 미지급";
}

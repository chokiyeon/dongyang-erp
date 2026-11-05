export const PETTY_KINDS={OPENING:'기초 현금',FUNDING:'통장 인출·현금 보충',RETURN:'통장 입금·현금 반납',RECEIPT:'기타 현금 수입',EXPENSE:'현금 지출'} as const;
export type PettyKind=keyof typeof PETTY_KINDS;
export const pettyIncoming=(kind:string)=>['OPENING','FUNDING','RECEIPT'].includes(kind);

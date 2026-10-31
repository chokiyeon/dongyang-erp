export const RECEIVED_NOTE_STATUSES = { HELD:"보유 중",COLLECTED:"전액 입금 완료",DISCOUNTED:"할인 현금화 · 만기 확인 전",MATURED:"할인어음 만기 확인 완료",VOID:"등록 취소" } as const;
export function discountedProceeds(face:string,fee:string):string {
  if(!/^(0|[1-9]\d{0,19})$/.test(face)||!/^(0|[1-9]\d{0,19})$/.test(fee)||BigInt(face)<=0n||BigInt(fee)>=BigInt(face))throw new Error("할인료는 액면금액보다 작아야 합니다.");
  return (BigInt(face)-BigInt(fee)).toString();
}

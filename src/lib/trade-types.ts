export const TRADE_KINDS = { SALE: "매출·공사 청구", PURCHASE: "매입·지급 청구" } as const;
export const TAX_KINDS = { TAXABLE: "과세", ZERO: "영세율", EXEMPT: "면세" } as const;
export const TRADE_EVIDENCE = { TAX_INVOICE: "세금계산서", STATEMENT: "거래명세서·청구서", OTHER: "기타 증빙" } as const;
export const INPUT_VAT_REVIEWS = { PENDING: "공제 여부 확인 필요", DEDUCTIBLE: "공제 가능 확인", NONDEDUCTIBLE: "불공제 확인" } as const;
export function tradeRemaining(gross: string, settled: string) { return BigInt(gross) - BigInt(settled); }

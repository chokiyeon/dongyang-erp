export type TradeBatchResult={id:string;reference:string;href:string;sheet:string;row:number;status:'IMPORTED'|'REPLAYED'|'EXISTING'|'HOLD';message:string};

export const TRADE_BATCH_LABELS={IMPORTED:'신규 등록',REPLAYED:'기존 요청 결과',EXISTING:'기존 자료 유지',HOLD:'대조 보류'} as const;

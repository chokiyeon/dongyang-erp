export type TradeSourceDetail={sheet:string;row:number;cells:string[]};
export function tradeSourceDetails(value:unknown):TradeSourceDetail[]{
 if(!Array.isArray(value))return [];
 return value.filter((row):row is TradeSourceDetail=>Boolean(row&&typeof row==='object'&&typeof row.sheet==='string'&&Number.isSafeInteger(row.row)&&row.row>0&&Array.isArray(row.cells)&&row.cells.every((cell:unknown)=>typeof cell==='string')));
}

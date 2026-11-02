import {normalizeBusinessNumber} from "./business-number";
import type {TradeWorkbookRow} from './trade-workbook-review';
export type ExistingTrade={href?:string;recordType?:"CANCELLATION";id:string;reference:string;approval:string;kind:'SALE'|'PURCHASE';date:string;partner:string;businessNumber?:string|null;supply:string;tax:string;gross:string;voided:boolean};
export type TradeWorkbookMatch={status:'NO_APPROVAL'|'UNREGISTERED'|'MATCH'|'CONFLICT'|'VOID_ONLY';differences:string[];documents:ExistingTrade[]};
const name=(v:string)=>v.normalize('NFKC').replace(/\s/g,'');
export function matchTradeWorkbookRow(row:TradeWorkbookRow,documents:ExistingTrade[]):TradeWorkbookMatch{
 if(!row.approval)return {status:'NO_APPROVAL',differences:[],documents:[]};
 const found=documents.filter(d=>d.approval===row.approval),active=found.filter(d=>!d.voided);
 if(!active.length)return {status:found.length?'VOID_ONLY':'UNREGISTERED',differences:[],documents:found};
 const differences=new Set<string>();if(active.length!==1)differences.add('활성 문서 여러 건');
 for(const d of active){const rawBusiness=row.raw[row.kind==='SALE'?9:4];if(rawBusiness){try{const business=normalizeBusinessNumber(rawBusiness);if(business&&business!==d.businessNumber)differences.add(d.businessNumber?'거래처 사업자번호':'거래처 사업자번호 미등록');}catch{differences.add('원본 사업자번호 형식');}}if(d.kind!==row.kind)differences.add('매입·매출 구분');if(d.date!==row.date)differences.add('증빙일');if(name(d.partner)!==name(row.partner))differences.add('거래처 상호');for(const [key,label]of [['gross','합계금액'],['supply','공급가액'],['tax','세액']] as const){try{if(!row[key]||BigInt(d[key])!==BigInt(row[key]))differences.add(label);}catch{differences.add(label);}}}
 return {status:differences.size?'CONFLICT':'MATCH',differences:[...differences],documents:found};
}
export const TRADE_MATCH_LABELS={NO_APPROVAL:'승인번호 없음',UNREGISTERED:'동일 승인번호 미등록',MATCH:'활성 문서 주요항목 일치',CONFLICT:'활성 문서 내용 차이',VOID_ONLY:'취소 이력만 있음'} as const;

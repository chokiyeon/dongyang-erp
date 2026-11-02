import type {TradeWorkbookRow} from './trade-workbook-review';
export function cancellationCandidate(row:TradeWorkbookRow){
 if(!row.approval||row.duplicateOf||!row.date||!row.gross||!row.supply||!row.tax)return false;
 try{if(BigInt(row.gross)>=0n||BigInt(row.supply)>=0n||BigInt(row.tax)>0n||BigInt(row.gross)!==BigInt(row.supply)+BigInt(row.tax))return false;}catch{return false;}
 return row.reasons.every(reason=>reason.startsWith('음수 금액:')||reason.startsWith('수정·취소 세금계산서:'));
}

export function reissueCandidate(row:TradeWorkbookRow){
 if(!row.approval||row.duplicateOf||!row.date||!row.gross||!row.supply||!row.tax||!row.reasons.length)return false;
 try{if(BigInt(row.gross)<=0n||BigInt(row.supply)<=0n||BigInt(row.tax)<0n||BigInt(row.gross)!==BigInt(row.supply)+BigInt(row.tax))return false;}catch{return false;}
 return row.reasons.some(reason=>reason.startsWith('수정·취소 세금계산서:'))&&row.reasons.every(reason=>reason.startsWith('수정·취소 세금계산서:')||reason.startsWith('같은 승인번호의 거래 구분·'));
}
export function selectableSourceConflict(row:TradeWorkbookRow){
 if(!row.approval||row.duplicateOf||!row.date||!row.gross||!row.supply||!row.tax||!row.reasons.some(r=>r.startsWith('같은 승인번호의 거래 구분·')))return false;
 try{if(BigInt(row.gross)<=0n||BigInt(row.supply)<0n||BigInt(row.tax)<0n||BigInt(row.gross)!==BigInt(row.supply)+BigInt(row.tax))return false;}catch{return false;}
 return row.reasons.every(r=>r.startsWith('같은 승인번호의 거래 구분·')||r.startsWith('수정·취소 세금계산서:'));
}

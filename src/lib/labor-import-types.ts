export type LaborSourceDay={date:string;units:string};
export type LaborSourceQuote={rate:string;units:string;gross:string;deductions:Record<string,string>;deductionTotal:string;sourceDeductionTotal:string;sourceNet:string;calculatedNet:string;issues:string[]};
export type LaborSourceRow={sheet:string;row:number;name:string;period:string;project:string;days:LaborSourceDay[];issues:string[];quote:LaborSourceQuote;identity:string};
export type LaborSourceReview={kind:'EXCEL'|'DOCUMENT';fileName:string;checksum:string;rows:LaborSourceRow[];unrecognized:string[];warnings:string[]};
export type LaborSourceDraft={basis:string;groups:{key:string;role:string;units:string;grossRate:string}[];deductions:Record<string,string>;gross:string;net:string;sourceNet:string;issues:string[];blocked:string[];sourceIds:string[];sources:{id:string;fileId:string;fileName:string;sheet:string;row:number}[]};

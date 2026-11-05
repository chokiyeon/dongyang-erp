import {InputError} from './validation';
export function stockAdjustmentIds(data:FormData){
 const raw=data.get('stockReturnIds');if(!raw)return [] as string[];
 let ids:unknown;try{ids=JSON.parse(String(raw));}catch{throw new InputError('반품·단가 감액 대상을 다시 선택하세요.');}
 if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!id||id.length>50)||new Set(ids).size!==ids.length)throw new InputError('중복 없이 반품·단가 감액 대상을 선택하세요.');
 return [...ids].sort() as string[];
}

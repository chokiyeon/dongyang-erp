import {InputError} from './validation';
/** Format normalization only; it does not verify registration or tax authority status. */
export function normalizeBusinessNumber(value:string):string|null{
 const normalized=value.normalize('NFKC').replace(/[\s-]/g,'');if(!normalized)return null;if(!/^\d{10}$/.test(normalized))throw new InputError('사업자등록번호는 숫자 10자리로 입력하세요.');return normalized;
}
export function formatBusinessNumber(value:string|null|undefined){return value?`${value.slice(0,3)}-${value.slice(3,5)}-${value.slice(5)}`:'';}

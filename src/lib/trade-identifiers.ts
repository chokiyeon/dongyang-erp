import {InputError} from "./validation";
/** This canonical identifier supports duplicate checks; it does not verify tax authority approval. */
export function normalizeTaxApproval(value:string):string|null{
 const normalized=value.normalize("NFKC").replace(/[\s-]/g,"").toUpperCase();if(!normalized)return null;
 if(!/^[A-Z0-9]{1,60}$/.test(normalized))throw new InputError("전자세금계산서 승인번호는 영문·숫자·하이픈으로 입력하세요.");return normalized;
}

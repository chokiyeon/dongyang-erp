import type {Company} from '@/generated/prisma/client';
import {normalizeBusinessNumber} from './business-number';
import {text,date,InputError} from './validation';
export const COMPANY_PROFILE_FIELDS=[
 ['taxpayerType','사업자 구분',100],['businessAddress','사업장 소재지',500],['headOfficeAddress','본점 소재지',500],['businessType','업태',300],['businessItems','종목',500],['taxOffice','관할 세무서',100],['phone','회사 전화번호',50],['fax','팩스번호',50],['email','회사 이메일',200],
] as const;
export function companyProfile(data:FormData,current:Company|null){
 const businessNumber=data.has('businessNumber')?normalizeBusinessNumber(text(data,'businessNumber','사업자등록번호',false,30)):current?.businessNumber??null;
 function digits(key:'corporateNumber'|'registrationUnitNumber',label:string,length:number){if(!data.has(key))return current?.[key]??null;const raw=text(data,key,label,false,40).normalize('NFKC').replace(/[-\s]/g,'');if(raw&&!new RegExp(`^\\d{${length}}$`).test(raw))throw new InputError(`${label}는 숫자 ${length}자리로 입력하세요.`);return raw||null;}
 const values={businessNumber,corporateNumber:digits('corporateNumber','법인등록번호',13),registrationUnitNumber:digits('registrationUnitNumber','종사업장번호',4),businessStartDate:data.has('businessStartDate')?date(text(data,'businessStartDate','개업연월일'),'개업연월일'):current?.businessStartDate??null,registrationDate:data.has('registrationDate')?date(text(data,'registrationDate','사업자등록증 발급일'),'사업자등록증 발급일'):current?.registrationDate??null};
 const strings=Object.fromEntries(COMPANY_PROFILE_FIELDS.map(([key,label,max])=>[key,data.has(key)?text(data,key,label,false,max)||null:current?.[key]??null])) as Record<typeof COMPANY_PROFILE_FIELDS[number][0],string|null>;
 if(strings.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strings.email))throw new InputError('회사 이메일 형식을 확인하세요.');return{...values,...strings};
}

import {payrollSlipFilename} from "./payroll-slip-image";
/** Windows treats names case-insensitively; never overwrite a same-name employee. */
export function uniquePayrollSlipFilename(name:string,period:string,used:Set<string>){
 const base=payrollSlipFilename(name,period);let result=base;let suffix=2;
 while(used.has(result.toLocaleLowerCase("ko-KR")))result=base.replace(/\.jpg$/,`_${suffix++}.jpg`);
 used.add(result.toLocaleLowerCase("ko-KR"));return result;
}
export const PAYROLL_SLIP_BATCH_LIMIT=30;

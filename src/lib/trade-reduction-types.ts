type Money={toFixed(n:number):string};
/** A later credit only creates a claim for the increase in the original overpayment. */
export function paidReductionRefundAmount(r:{paidAmount:Money|null;beforeGross:Money;afterGross:Money}){
 if(!r.paidAmount)return 0n;
 const paid=BigInt(r.paidAmount.toFixed(0)),before=BigInt(r.beforeGross.toFixed(0)),after=BigInt(r.afterGross.toFixed(0));
 const oldExcess=paid>before?paid-before:0n,newExcess=paid>after?paid-after:0n;
 return newExcess>oldExcess?newExcess-oldExcess:0n;
}

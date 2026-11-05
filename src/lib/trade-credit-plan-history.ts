type CreditPlan={cashPlanTracked:boolean;cashPlanBeforeId:string|null;paymentBasis:string|null};
/** Registration history is ordered oldest first, including corrections to later-period credits. */
export function historicalTradePlan(current:string|null,history:CreditPlan[]){
 const first=history[0];if(!first)return current;
 if(first.cashPlanTracked)return first.cashPlanBeforeId;
 return first.paymentBasis?current:null;
}

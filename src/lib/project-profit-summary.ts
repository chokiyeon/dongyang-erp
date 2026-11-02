import { createHash } from "node:crypto";
import { PROJECT_COST_CATEGORIES, REMAINING_COST_FIELDS, type ProjectCostCategoryKey } from "./project-profit-types";
type Money = { toFixed(n: number): string };
export type ProfitDocument = { id: string; reference: string; supplyAmount: Money; taxAmount: Money; inputVatReview: string; proofConfirmed: boolean; profitCategory: ProjectCostCategoryKey | null; settledAmount: Money; grossAmount: Money };
export type ProfitManualCost = { id: string; reference: string; title: string; category: ProjectCostCategoryKey; amount: Money; incurredDate: Date; sourceConfirmed?: boolean; unpaidPurchase?:bigint };
export type ProfitProject = { contractAmount: Money | null; remainingMaterial: Money | null; remainingLabor: Money | null; remainingOther: Money | null; remainingOverhead: Money | null; profitBasis: string | null; profitReviewedAt: Date | null };
export function summarizeProjectProfit(project: ProfitProject, documents: ProfitDocument[], entries: ProfitManualCost[]) {
  const costs: Record<ProjectCostCategoryKey,bigint> = { MATERIAL:0n,LABOR:0n,OTHER:0n,OVERHEAD:0n }; const issues: string[] = [];
  for (const d of documents) {
    if (!d.profitCategory) issues.push(`${d.reference}: 원가 구분 미지정`);
    if (!d.proofConfirmed) issues.push(`${d.reference}: 증빙 원본 확인 필요`);
    if (BigInt(d.taxAmount.toFixed(0)) > 0n && d.inputVatReview === "PENDING") issues.push(`${d.reference}: 부가세 공제 여부 확인 필요`);
    if (d.profitCategory) costs[d.profitCategory] += BigInt(d.supplyAmount.toFixed(0)) + (d.inputVatReview === "NONDEDUCTIBLE" ? BigInt(d.taxAmount.toFixed(0)) : 0n);
  }
  for (const c of entries) { costs[c.category] += BigInt(c.amount.toFixed(0)); if(c.sourceConfirmed===false)issues.push(`${c.reference}: 원본 원가 재검토 필요`); }
  const basis = createHash("sha256").update(JSON.stringify({ contract:project.contractAmount?.toFixed(0) ?? null, documents:documents.map((d)=>({id:d.id,supply:d.supplyAmount.toFixed(0),tax:d.taxAmount.toFixed(0),review:d.inputVatReview,proof:d.proofConfirmed,category:d.profitCategory})).sort((a,b)=>a.id.localeCompare(b.id)),entries:entries.map((c)=>({id:c.id,...(c.sourceConfirmed===false?{sourceConfirmed:false}:{}),category:c.category,amount:c.amount.toFixed(0),date:c.incurredDate.toISOString()})).sort((a,b)=>a.id.localeCompare(b.id)) })).digest("hex");
  const fields = Object.keys(REMAINING_COST_FIELDS) as (keyof typeof REMAINING_COST_FIELDS)[];
  const missing = fields.filter((f)=>project[f] === null);
  const incurred = Object.values(costs).reduce((sum,n)=>sum+n,0n);
  const remaining = missing.length ? null : fields.reduce((sum,f)=>sum+BigInt(project[f]!.toFixed(0)),0n);
  const reviewed = project.profitBasis === basis && project.profitReviewedAt !== null;
  const ready = reviewed && issues.length === 0 && project.contractAmount !== null && remaining !== null;
  const expectedCost = remaining === null ? null : incurred+remaining;
  const expectedProfit = ready ? BigInt(project.contractAmount!.toFixed(0))-expectedCost! : null;
  const revenue = project.contractAmount ? BigInt(project.contractAmount.toFixed(0)) : null;
  const margin = expectedProfit !== null && revenue !== null && revenue > 0n ? `${expectedProfit < 0n ? "-" : ""}${((expectedProfit < 0n ? -expectedProfit : expectedProfit)*1000n/revenue)/10n}.${((expectedProfit < 0n ? -expectedProfit : expectedProfit)*1000n/revenue)%10n}%` : null;
  return { basis,costs,issues,missing,incurred,remaining,reviewed,ready,expectedCost,expectedProfit,margin,unpaid:documents.reduce((sum,d)=>sum+BigInt(d.grossAmount.toFixed(0))-BigInt(d.settledAmount.toFixed(0)),0n)+entries.reduce((sum,e)=>sum+(e.unpaidPurchase??0n),0n), categories:PROJECT_COST_CATEGORIES };
}

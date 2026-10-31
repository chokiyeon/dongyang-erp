import { date, InputError } from "./validation";
export function taxPeriod(month: string, mode: string) {
  if (!/^\d{4}-\d{2}$/.test(month) || !["MONTH", "QUARTER"].includes(mode)) throw new InputError("조회 월과 기간 구분을 확인해 주세요.");
  const from = date(`${month}-01`, "조회 월")!;
  const year = from.getUTCFullYear(); const index = from.getUTCMonth(); const start = mode === "QUARTER" ? Math.floor(index/3)*3 : index;
  const end = new Date(Date.UTC(year, start + (mode === "QUARTER" ? 3 : 1), 1));
  const begin = new Date(Date.UTC(year,start,1));
  return { from: begin, to: end, label: mode === "QUARTER" ? `${year}년 ${Math.floor(start/3)+1}분기` : `${year}년 ${index+1}월` };
}
export type TaxSummaryGroup = { kind: "SALE" | "PURCHASE"; evidence: string; proofConfirmed: boolean; inputVatReview: string; taxKind: string; supply: string; tax: string };
export function summarizeVat(groups: TaxSummaryGroup[]) {
  let output = 0n, deductible = 0n, pendingSale = 0n, pendingPurchase = 0n, nondeductible = 0n, zeroSupply = 0n, exemptSupply = 0n;
  for (const g of groups) {
    const tax = BigInt(g.tax); const confirmed = g.evidence === "TAX_INVOICE" && g.proofConfirmed;
    if (g.kind === "SALE") {
      if (g.taxKind === "TAXABLE") { if (confirmed) output += tax; else pendingSale += tax; }
      if (confirmed && g.taxKind === "ZERO") zeroSupply += BigInt(g.supply);
      // Exempt sales may have a statement rather than a tax invoice; keep them separately.
      if (g.proofConfirmed && g.taxKind === "EXEMPT") exemptSupply += BigInt(g.supply);
    } else if (g.taxKind === "TAXABLE") {
      if (g.inputVatReview === "NONDEDUCTIBLE") nondeductible += tax;
      else if (confirmed && g.inputVatReview === "DEDUCTIBLE") deductible += tax;
      else pendingPurchase += tax;
    }
  }
  return { output, deductible, estimate: output-deductible, pendingSale, pendingPurchase, nondeductible, zeroSupply, exemptSupply };
}

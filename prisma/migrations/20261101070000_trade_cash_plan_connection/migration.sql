-- Add an optional one-to-one source link without rewriting existing documents.
ALTER TABLE "TradeDocument" ADD COLUMN "cashPlanId" TEXT;
CREATE UNIQUE INDEX "TradeDocument_cashPlanId_key" ON "TradeDocument"("cashPlanId");
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_cashPlanId_fkey" FOREIGN KEY ("cashPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

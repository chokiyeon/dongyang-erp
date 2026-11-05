ALTER TABLE "TradeReduction" ADD COLUMN "cashPlanTracked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cashPlanBeforeId" TEXT;
CREATE INDEX "TradeReduction_cashPlanBeforeId_idx" ON "TradeReduction"("cashPlanBeforeId");
ALTER TABLE "TradeReduction" ADD CONSTRAINT "TradeReduction_cashPlanBeforeId_fkey" FOREIGN KEY ("cashPlanBeforeId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TradeReduction" ADD COLUMN "refundPlanId" TEXT,
ADD COLUMN "paidAmount" DECIMAL(20,0), ADD COLUMN "paymentBasis" TEXT, ADD COLUMN "paidLinkIds" JSONB;
CREATE UNIQUE INDEX "TradeReduction_refundPlanId_key" ON "TradeReduction"("refundPlanId");
ALTER TABLE "TradeReduction" ADD CONSTRAINT "TradeReduction_refundPlanId_fkey" FOREIGN KEY ("refundPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

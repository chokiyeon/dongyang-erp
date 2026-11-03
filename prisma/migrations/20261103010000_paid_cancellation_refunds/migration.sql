ALTER TABLE "TradeCancellation" ADD COLUMN "refundPlanId" TEXT, ADD COLUMN "paymentBasis" TEXT;
CREATE UNIQUE INDEX "TradeCancellation_refundPlanId_key" ON "TradeCancellation"("refundPlanId");
ALTER TABLE "TradeCancellation" ADD CONSTRAINT "TradeCancellation_refundPlanId_fkey" FOREIGN KEY ("refundPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeCancellation" ADD CONSTRAINT "TradeCancellation_refund_basis_check" CHECK (("refundPlanId" IS NULL AND "paymentBasis" IS NULL) OR ("refundPlanId" IS NOT NULL AND "paymentBasis" IS NOT NULL));

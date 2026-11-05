ALTER TABLE "TradeCancellation" ADD COLUMN "unpaidPlanBasis" TEXT;
ALTER TABLE "TradeCancellation" ADD CONSTRAINT "TradeCancellation_unpaid_plan_basis_check"
CHECK ("unpaidPlanBasis" IS NULL OR ("refundPlanId" IS NULL AND "paymentBasis" IS NULL));

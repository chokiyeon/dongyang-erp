ALTER TABLE "CashPlan" ADD COLUMN "replacedById" TEXT;
ALTER TABLE "CashSettlement" ADD COLUMN "originPlanId" TEXT;
ALTER TABLE "CashPlan" ADD CONSTRAINT "CashPlan_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashSettlement" ADD CONSTRAINT "CashSettlement_originPlanId_fkey" FOREIGN KEY ("originPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

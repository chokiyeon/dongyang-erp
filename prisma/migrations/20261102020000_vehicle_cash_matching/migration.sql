ALTER TABLE "VehicleExpense" ADD COLUMN "cashPlanId" TEXT;
CREATE UNIQUE INDEX "VehicleExpense_cashPlanId_key" ON "VehicleExpense"("cashPlanId");
ALTER TABLE "VehicleExpense" ADD CONSTRAINT "VehicleExpense_cashPlanId_fkey" FOREIGN KEY ("cashPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

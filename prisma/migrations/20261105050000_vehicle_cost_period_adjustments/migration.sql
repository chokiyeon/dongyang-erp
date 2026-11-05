CREATE TABLE "VehicleCostAdjustment" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "expenseId" TEXT NOT NULL REFERENCES "VehicleExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "documentId" TEXT NOT NULL REFERENCES "TradeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reductionId" TEXT REFERENCES "TradeReduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "cancellationId" TEXT REFERENCES "TradeCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "effectiveDate" DATE NOT NULL,
 "beforeAmount" DECIMAL(20,0) NOT NULL,
 "afterAmount" DECIMAL(20,0) NOT NULL,
 "baseBasis" TEXT NOT NULL,
 "basisBefore" TEXT NOT NULL,
 "baseSnapshot" JSONB NOT NULL,
 "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "VehicleCostAdjustment_source_check" CHECK (("reductionId" IS NULL) <> ("cancellationId" IS NULL)),
 CONSTRAINT "VehicleCostAdjustment_amount_check" CHECK ("beforeAmount">0 AND "afterAmount">=0 AND "afterAmount"<"beforeAmount")
);
CREATE UNIQUE INDEX "VehicleCostAdjustment_reductionId_key" ON "VehicleCostAdjustment"("reductionId");
CREATE UNIQUE INDEX "VehicleCostAdjustment_cancellationId_key" ON "VehicleCostAdjustment"("cancellationId");
CREATE INDEX "VehicleCostAdjustment_companyId_effectiveDate_idx" ON "VehicleCostAdjustment"("companyId","effectiveDate");
CREATE INDEX "VehicleCostAdjustment_expenseId_effectiveDate_idx" ON "VehicleCostAdjustment"("expenseId","effectiveDate");
CREATE INDEX "VehicleCostAdjustment_documentId_effectiveDate_idx" ON "VehicleCostAdjustment"("documentId","effectiveDate");

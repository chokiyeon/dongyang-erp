CREATE TABLE "TradeCostAdjustment" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reviewId" TEXT NOT NULL REFERENCES "SourceCostReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "documentId" TEXT NOT NULL REFERENCES "TradeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reductionId" TEXT REFERENCES "TradeReduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "cancellationId" TEXT REFERENCES "TradeCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "effectiveDate" DATE NOT NULL,
 "beforeTotal" DECIMAL(20,0) NOT NULL,
 "afterTotal" DECIMAL(20,0) NOT NULL,
 "beforeCommon" DECIMAL(20,0) NOT NULL,
 "afterCommon" DECIMAL(20,0) NOT NULL,
 "beforeEntries" JSONB NOT NULL,
 "afterEntries" JSONB NOT NULL,
 "basisBefore" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "TradeCostAdjustment_source_check" CHECK (("reductionId" IS NULL) <> ("cancellationId" IS NULL)),
 CONSTRAINT "TradeCostAdjustment_amount_check" CHECK ("beforeTotal">0 AND "afterTotal">=0 AND "afterTotal"<"beforeTotal" AND "beforeCommon">=0 AND "beforeCommon"<="beforeTotal" AND "afterCommon">=0 AND "afterCommon"<="afterTotal")
);
CREATE UNIQUE INDEX "TradeCostAdjustment_reductionId_key" ON "TradeCostAdjustment"("reductionId");
CREATE UNIQUE INDEX "TradeCostAdjustment_cancellationId_key" ON "TradeCostAdjustment"("cancellationId");
CREATE INDEX "TradeCostAdjustment_companyId_effectiveDate_idx" ON "TradeCostAdjustment"("companyId","effectiveDate");
CREATE INDEX "TradeCostAdjustment_reviewId_effectiveDate_idx" ON "TradeCostAdjustment"("reviewId","effectiveDate");
CREATE INDEX "TradeCostAdjustment_documentId_effectiveDate_idx" ON "TradeCostAdjustment"("documentId","effectiveDate");
CREATE TABLE "TradeCostAdjustmentEntry" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "adjustmentId" TEXT NOT NULL REFERENCES "TradeCostAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "amount" DECIMAL(20,0) NOT NULL,
 CONSTRAINT "TradeCostAdjustmentEntry_amount_check" CHECK ("amount"<>0)
);
CREATE UNIQUE INDEX "TradeCostAdjustmentEntry_adjustmentId_projectId_key" ON "TradeCostAdjustmentEntry"("adjustmentId","projectId");
CREATE INDEX "TradeCostAdjustmentEntry_projectId_adjustmentId_idx" ON "TradeCostAdjustmentEntry"("projectId","adjustmentId");

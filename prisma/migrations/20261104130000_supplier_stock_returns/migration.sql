ALTER TABLE "StockMovement" ADD COLUMN "returnOfId" TEXT, ADD COLUMN "reductionId" TEXT;
CREATE INDEX "StockMovement_returnOfId_idx" ON "StockMovement"("returnOfId");
CREATE INDEX "StockMovement_reductionId_idx" ON "StockMovement"("reductionId");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_returnOfId_fkey" FOREIGN KEY ("returnOfId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_reductionId_fkey" FOREIGN KEY ("reductionId") REFERENCES "TradeReduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD COLUMN "cancellationId" TEXT;
CREATE INDEX "StockMovement_cancellationId_idx" ON "StockMovement"("cancellationId");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "TradeCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

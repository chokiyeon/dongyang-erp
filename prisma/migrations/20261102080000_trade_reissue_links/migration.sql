ALTER TABLE "TradeWorkbookSource" ADD COLUMN "replacesCancellationId" TEXT;
CREATE INDEX "TradeWorkbookSource_replacesCancellationId_idx" ON "TradeWorkbookSource"("replacesCancellationId");
ALTER TABLE "TradeWorkbookSource" ADD CONSTRAINT "TradeWorkbookSource_replacesCancellationId_fkey" FOREIGN KEY ("replacesCancellationId") REFERENCES "TradeCancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

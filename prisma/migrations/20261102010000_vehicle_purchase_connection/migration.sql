-- Preserve existing vehicle expenses and financial amounts. Connections are opt-in.
ALTER TABLE "VehicleExpense" ADD COLUMN "documentId" TEXT;
CREATE UNIQUE INDEX "VehicleExpense_documentId_key" ON "VehicleExpense"("documentId");
ALTER TABLE "VehicleExpense" ADD CONSTRAINT "VehicleExpense_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TradeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

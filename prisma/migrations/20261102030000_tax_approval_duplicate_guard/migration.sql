-- Existing documents stay unchanged; paper invoices can keep a NULL approval number.
ALTER TABLE "TradeDocument" ADD COLUMN "taxApprovalNumber" TEXT;
CREATE UNIQUE INDEX "TradeDocument_active_tax_approval_key" ON "TradeDocument"("companyId", "taxApprovalNumber") WHERE "taxApprovalNumber" IS NOT NULL AND "voidedAt" IS NULL;

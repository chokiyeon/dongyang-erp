ALTER TABLE "CashSettlement" ADD COLUMN "tradeBankLinkId" TEXT;
CREATE UNIQUE INDEX "CashSettlement_tradeBankLinkId_key" ON "CashSettlement"("tradeBankLinkId");
ALTER TABLE "CashSettlement" ADD CONSTRAINT "CashSettlement_tradeBankLinkId_fkey" FOREIGN KEY ("tradeBankLinkId") REFERENCES "TradeBankLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

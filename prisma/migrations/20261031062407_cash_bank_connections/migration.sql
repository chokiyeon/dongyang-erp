-- AlterTable
ALTER TABLE "CashSettlement" ADD COLUMN     "bankTransactionId" TEXT,
ADD COLUMN     "voidReason" TEXT,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "CashSettlement" ADD CONSTRAINT "CashSettlement_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

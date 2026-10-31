-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "legacyBankLabel" TEXT,
ADD COLUMN     "legacyCategory" TEXT,
ADD COLUMN     "legacyIncomingType" TEXT,
ADD COLUMN     "legacyLedgerBalance" DECIMAL(20,0),
ADD COLUMN     "legacyRow" INTEGER,
ADD COLUMN     "legacySheet" TEXT;

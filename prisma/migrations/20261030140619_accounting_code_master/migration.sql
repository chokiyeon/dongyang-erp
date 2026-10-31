-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "accountingCodeId" TEXT;

-- CreateTable
CREATE TABLE "AccountingCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingCode_code_key" ON "AccountingCode"("code");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountingCodeId_fkey" FOREIGN KEY ("accountingCodeId") REFERENCES "AccountingCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

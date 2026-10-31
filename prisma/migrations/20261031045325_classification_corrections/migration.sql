-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "classificationVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BankClassificationChange" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "previousCodeId" TEXT,
    "newCodeId" TEXT,
    "previousBusinessType" TEXT,
    "newBusinessType" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankClassificationChange_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BankClassificationChange" ADD CONSTRAINT "BankClassificationChange_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

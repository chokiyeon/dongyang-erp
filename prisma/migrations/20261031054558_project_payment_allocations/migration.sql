-- CreateEnum
CREATE TYPE "PaymentCategory" AS ENUM ('MATERIAL', 'LABOR', 'OTHER', 'COMPANY');

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "allocationVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "projectId" TEXT,
    "category" "PaymentCategory" NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocationChange" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocationChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentAllocation_transactionId_idx" ON "PaymentAllocation"("transactionId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_projectId_category_idx" ON "PaymentAllocation"("projectId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocationChange_requestId_key" ON "PaymentAllocationChange"("requestId");

-- CreateIndex
CREATE INDEX "PaymentAllocationChange_transactionId_createdAt_idx" ON "PaymentAllocationChange"("transactionId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocationChange" ADD CONSTRAINT "PaymentAllocationChange_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

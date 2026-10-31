-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "CashCertainty" AS ENUM ('CONFIRMED', 'ESTIMATED');

-- CreateTable
CREATE TABLE "CashPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "certainty" "CashCertainty" NOT NULL DEFAULT 'ESTIMATED',
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "plannedDate" DATE NOT NULL,
    "plannedAmount" DECIMAL(20,0) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSettlement" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "processedDate" DATE NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "note" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashPlan_companyId_plannedDate_idx" ON "CashPlan"("companyId", "plannedDate");

-- CreateIndex
CREATE UNIQUE INDEX "CashSettlement_requestId_key" ON "CashSettlement"("requestId");

-- AddForeignKey
ALTER TABLE "CashPlan" ADD CONSTRAINT "CashPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSettlement" ADD CONSTRAINT "CashSettlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

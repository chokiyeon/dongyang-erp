-- AlterTable
ALTER TABLE "CashPlan" ADD COLUMN     "requestId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "CashSettlement" ADD COLUMN     "finalized" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "CashPlan_requestId_key" ON "CashPlan"("requestId");

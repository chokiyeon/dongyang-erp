-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "budgetVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "laborBudget" DECIMAL(20,0),
ADD COLUMN     "materialBudget" DECIMAL(20,0),
ADD COLUMN     "otherBudget" DECIMAL(20,0);

-- CreateTable
CREATE TABLE "ProjectBudgetChange" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBudgetChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBudgetChange_requestId_key" ON "ProjectBudgetChange"("requestId");

-- CreateIndex
CREATE INDEX "ProjectBudgetChange_projectId_createdAt_idx" ON "ProjectBudgetChange"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectBudgetChange" ADD CONSTRAINT "ProjectBudgetChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

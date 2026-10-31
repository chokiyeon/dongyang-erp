-- CreateEnum
CREATE TYPE "ProjectCostCategory" AS ENUM ('MATERIAL', 'LABOR', 'OTHER', 'OVERHEAD');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "profitBasis" TEXT,
ADD COLUMN     "profitReviewedAt" TIMESTAMP(3),
ADD COLUMN     "profitVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remainingLabor" DECIMAL(20,0),
ADD COLUMN     "remainingMaterial" DECIMAL(20,0),
ADD COLUMN     "remainingOther" DECIMAL(20,0),
ADD COLUMN     "remainingOverhead" DECIMAL(20,0),
ADD COLUMN     "unapprovedAdditional" DECIMAL(20,0);

-- AlterTable
ALTER TABLE "TradeDocument" ADD COLUMN     "profitCategory" "ProjectCostCategory";

-- CreateTable
CREATE TABLE "ProjectCostEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "ProjectCostCategory" NOT NULL,
    "incurredDate" DATE NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProfitChange" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectProfitChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCostEntry_projectId_reference_key" ON "ProjectCostEntry"("projectId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectProfitChange_requestId_key" ON "ProjectProfitChange"("requestId");

-- CreateIndex
CREATE INDEX "ProjectProfitChange_projectId_createdAt_idx" ON "ProjectProfitChange"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectCostEntry" ADD CONSTRAINT "ProjectCostEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProfitChange" ADD CONSTRAINT "ProjectProfitChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

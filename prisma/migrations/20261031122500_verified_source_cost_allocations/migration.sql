BEGIN;
-- AlterTable
ALTER TABLE "ProjectCostEntry" ADD COLUMN     "sourceConfirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourceReviewId" TEXT;

-- CreateTable
CREATE TABLE "SourceCostReview" (
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "totalAmount" DECIMAL(20,0) NOT NULL,
    "commonAmount" DECIMAL(20,0) NOT NULL,
    "basis" TEXT NOT NULL,
    "incurredDate" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceCostReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCostChange" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceCostChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceCostReview_companyId_sourceType_sourceId_key" ON "SourceCostReview"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCostChange_requestId_key" ON "SourceCostChange"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCostEntry_sourceReviewId_projectId_key" ON "ProjectCostEntry"("sourceReviewId", "projectId");

-- AddForeignKey
ALTER TABLE "ProjectCostEntry" ADD CONSTRAINT "ProjectCostEntry_sourceReviewId_fkey" FOREIGN KEY ("sourceReviewId") REFERENCES "SourceCostReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCostReview" ADD CONSTRAINT "SourceCostReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCostChange" ADD CONSTRAINT "SourceCostChange_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "SourceCostReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;

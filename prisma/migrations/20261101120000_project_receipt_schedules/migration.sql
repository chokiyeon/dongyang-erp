ALTER TABLE "CashPlan" ADD COLUMN "projectId" TEXT;
ALTER TABLE "CashPlan" ADD COLUMN "milestone" TEXT;
CREATE INDEX "CashPlan_projectId_plannedDate_idx" ON "CashPlan"("projectId","plannedDate");
ALTER TABLE "CashPlan" ADD CONSTRAINT "CashPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

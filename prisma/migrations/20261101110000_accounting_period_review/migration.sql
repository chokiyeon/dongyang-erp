CREATE TABLE "AccountingPeriodLock" (
 "id" TEXT NOT NULL,
 "companyId" TEXT NOT NULL,
 "period" TEXT NOT NULL,
 "locked" BOOLEAN NOT NULL DEFAULT true,
 "packageId" TEXT NOT NULL,
 "digest" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 0,
 "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AccountingPeriodLock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountingPeriodLock_companyId_period_key" ON "AccountingPeriodLock"("companyId","period");
ALTER TABLE "AccountingPeriodLock" ADD CONSTRAINT "AccountingPeriodLock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

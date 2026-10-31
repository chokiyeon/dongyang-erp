-- CreateTable
CREATE TABLE "CorporateTaxEstimate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateTaxEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPackage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "digest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorporateTaxEstimate_companyId_period_key" ON "CorporateTaxEstimate"("companyId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPackage_companyId_period_revision_key" ON "AccountingPackage"("companyId", "period", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceChange_requestId_key" ON "FinanceChange"("requestId");

-- AddForeignKey
ALTER TABLE "CorporateTaxEstimate" ADD CONSTRAINT "CorporateTaxEstimate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPackage" ADD CONSTRAINT "AccountingPackage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceChange" ADD CONSTRAINT "FinanceChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

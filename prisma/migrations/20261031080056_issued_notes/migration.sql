-- CreateEnum
CREATE TYPE "IssuedNoteStatus" AS ENUM ('OPEN', 'SETTLED', 'VOID');

-- CreateTable
CREATE TABLE "IssuedNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "projectId" TEXT,
    "accountId" TEXT NOT NULL,
    "issuedDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "cashPlanId" TEXT NOT NULL,
    "status" "IssuedNoteStatus" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "settledDate" DATE,
    "voidReason" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuedNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedNoteChange" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssuedNoteChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssuedNote_cashPlanId_key" ON "IssuedNote"("cashPlanId");

-- CreateIndex
CREATE INDEX "IssuedNote_companyId_status_dueDate_idx" ON "IssuedNote"("companyId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedNote_companyId_reference_key" ON "IssuedNote"("companyId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedNoteChange_requestId_key" ON "IssuedNoteChange"("requestId");

-- CreateIndex
CREATE INDEX "IssuedNoteChange_noteId_createdAt_idx" ON "IssuedNoteChange"("noteId", "createdAt");

-- AddForeignKey
ALTER TABLE "IssuedNote" ADD CONSTRAINT "IssuedNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedNote" ADD CONSTRAINT "IssuedNote_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedNote" ADD CONSTRAINT "IssuedNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedNote" ADD CONSTRAINT "IssuedNote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedNote" ADD CONSTRAINT "IssuedNote_cashPlanId_fkey" FOREIGN KEY ("cashPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuedNoteChange" ADD CONSTRAINT "IssuedNoteChange_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "IssuedNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

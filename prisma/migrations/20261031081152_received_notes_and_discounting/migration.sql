-- CreateEnum
CREATE TYPE "ReceivedNoteStatus" AS ENUM ('HELD', 'COLLECTED', 'DISCOUNTED', 'MATURED', 'VOID');

-- CreateTable
CREATE TABLE "ReceivedNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "projectId" TEXT,
    "receivedDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "cashPlanId" TEXT NOT NULL,
    "status" "ReceivedNoteStatus" NOT NULL DEFAULT 'HELD',
    "version" INTEGER NOT NULL DEFAULT 0,
    "realizedDate" DATE,
    "discountFee" DECIMAL(20,0),
    "netProceeds" DECIMAL(20,0),
    "maturityConfirmedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceivedNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivedNoteChange" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceivedNoteChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReceivedNote_cashPlanId_key" ON "ReceivedNote"("cashPlanId");

-- CreateIndex
CREATE INDEX "ReceivedNote_companyId_status_dueDate_idx" ON "ReceivedNote"("companyId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivedNote_companyId_reference_key" ON "ReceivedNote"("companyId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivedNoteChange_requestId_key" ON "ReceivedNoteChange"("requestId");

-- CreateIndex
CREATE INDEX "ReceivedNoteChange_noteId_createdAt_idx" ON "ReceivedNoteChange"("noteId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReceivedNote" ADD CONSTRAINT "ReceivedNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedNote" ADD CONSTRAINT "ReceivedNote_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedNote" ADD CONSTRAINT "ReceivedNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedNote" ADD CONSTRAINT "ReceivedNote_cashPlanId_fkey" FOREIGN KEY ("cashPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivedNoteChange" ADD CONSTRAINT "ReceivedNoteChange_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ReceivedNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

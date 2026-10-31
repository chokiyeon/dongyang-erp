BEGIN;
-- CreateTable
CREATE TABLE "BankTransferPair" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "outgoingId" TEXT NOT NULL,
    "incomingId" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "outgoingVersion" INTEGER NOT NULL,
    "incomingVersion" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransferPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransferMember" (
    "transactionId" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "side" TEXT NOT NULL,

    CONSTRAINT "BankTransferMember_pkey" PRIMARY KEY ("transactionId")
);

-- CreateTable
CREATE TABLE "BankTransferChange" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransferChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferApproval" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "untilDate" DATE NOT NULL,
    "rows" JSONB NOT NULL,
    "basis" TEXT NOT NULL,
    "totalAmount" DECIMAL(20,0) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvalDate" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferApprovalChange" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferApprovalChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankTransferPair_companyId_createdAt_idx" ON "BankTransferPair"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransferMember_pairId_side_key" ON "BankTransferMember"("pairId", "side");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransferChange_requestId_key" ON "BankTransferChange"("requestId");

-- CreateIndex
CREATE INDEX "TransferApproval_companyId_createdAt_idx" ON "TransferApproval"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransferApprovalChange_requestId_key" ON "TransferApprovalChange"("requestId");

-- AddForeignKey
ALTER TABLE "BankTransferPair" ADD CONSTRAINT "BankTransferPair_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransferPair" ADD CONSTRAINT "BankTransferPair_outgoingId_fkey" FOREIGN KEY ("outgoingId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransferPair" ADD CONSTRAINT "BankTransferPair_incomingId_fkey" FOREIGN KEY ("incomingId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransferMember" ADD CONSTRAINT "BankTransferMember_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransferMember" ADD CONSTRAINT "BankTransferMember_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "BankTransferPair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransferChange" ADD CONSTRAINT "BankTransferChange_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "BankTransferPair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferApproval" ADD CONSTRAINT "TransferApproval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferApprovalChange" ADD CONSTRAINT "TransferApprovalChange_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "TransferApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;

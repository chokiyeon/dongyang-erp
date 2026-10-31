-- CreateTable
CREATE TABLE "ClassificationBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "targetCodeId" TEXT,
    "targetBusinessType" TEXT,
    "targetLabel" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "undoReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "previousCodeId" TEXT,
    "newCodeId" TEXT,
    "previousBusinessType" TEXT,
    "newBusinessType" TEXT,
    "previousInternalTransfer" BOOLEAN NOT NULL,
    "newInternalTransfer" BOOLEAN NOT NULL,
    "appliedVersion" INTEGER NOT NULL,

    CONSTRAINT "ClassificationBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClassificationBatch_requestId_key" ON "ClassificationBatch"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassificationBatchItem_batchId_transactionId_key" ON "ClassificationBatchItem"("batchId", "transactionId");

-- AddForeignKey
ALTER TABLE "ClassificationBatch" ADD CONSTRAINT "ClassificationBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationBatchItem" ADD CONSTRAINT "ClassificationBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ClassificationBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationBatchItem" ADD CONSTRAINT "ClassificationBatchItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

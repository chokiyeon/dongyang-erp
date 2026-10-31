-- CreateEnum
CREATE TYPE "TradeKind" AS ENUM ('SALE', 'PURCHASE');

-- CreateEnum
CREATE TYPE "TradeTaxKind" AS ENUM ('TAXABLE', 'ZERO', 'EXEMPT');

-- CreateEnum
CREATE TYPE "TradeEvidence" AS ENUM ('TAX_INVOICE', 'STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "InputVatReview" AS ENUM ('PENDING', 'DEDUCTIBLE', 'NONDEDUCTIBLE');

-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN     "settlementVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TradeDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "TradeKind" NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "projectId" TEXT,
    "issuedDate" DATE NOT NULL,
    "dueDate" DATE,
    "supplyAmount" DECIMAL(20,0) NOT NULL,
    "taxAmount" DECIMAL(20,0) NOT NULL,
    "grossAmount" DECIMAL(20,0) NOT NULL,
    "settledAmount" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "taxKind" "TradeTaxKind" NOT NULL,
    "evidence" "TradeEvidence" NOT NULL,
    "proofConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "inputVatReview" "InputVatReview" NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeDocumentChange" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeDocumentChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeBankLink" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeBankLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeDocument_companyId_issuedDate_idx" ON "TradeDocument"("companyId", "issuedDate");

-- CreateIndex
CREATE INDEX "TradeDocument_projectId_kind_idx" ON "TradeDocument"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDocument_companyId_kind_reference_key" ON "TradeDocument"("companyId", "kind", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDocumentChange_requestId_key" ON "TradeDocumentChange"("requestId");

-- CreateIndex
CREATE INDEX "TradeDocumentChange_documentId_createdAt_idx" ON "TradeDocumentChange"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeBankLink_requestId_key" ON "TradeBankLink"("requestId");

-- CreateIndex
CREATE INDEX "TradeBankLink_documentId_voidedAt_idx" ON "TradeBankLink"("documentId", "voidedAt");

-- CreateIndex
CREATE INDEX "TradeBankLink_transactionId_voidedAt_idx" ON "TradeBankLink"("transactionId", "voidedAt");

-- AddForeignKey
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDocumentChange" ADD CONSTRAINT "TradeDocumentChange_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TradeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBankLink" ADD CONSTRAINT "TradeBankLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TradeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeBankLink" ADD CONSTRAINT "TradeBankLink_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

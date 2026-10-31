-- CreateEnum
CREATE TYPE "PaymentTerm" AS ENUM ('MANUAL', 'IMMEDIATE', 'NEXT_MONTH_END');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('UNCONFIRMED', 'BANK_TRANSFER', 'ISSUED_NOTE', 'OTHER');

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "payeeAccount" TEXT,
ADD COLUMN     "payeeBank" TEXT,
ADD COLUMN     "payeeHolder" TEXT,
ADD COLUMN     "payeeVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'UNCONFIRMED',
ADD COLUMN     "paymentTerm" "PaymentTerm" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "TradeDocument" ADD COLUMN     "companyExpense" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'UNCONFIRMED';

-- CreateTable
CREATE TABLE "PartnerPaymentChange" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPaymentChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringPaymentTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "projectId" TEXT,
    "companyExpense" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "defaultAmount" DECIMAL(20,0),
    "dueDay" INTEGER NOT NULL DEFAULT 0,
    "startMonth" TEXT NOT NULL,
    "endMonth" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringPaymentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyPayment" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "projectId" TEXT,
    "companyExpense" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(20,0),
    "version" INTEGER NOT NULL DEFAULT 0,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "voidedAt" TIMESTAMP(3),
    "cashPlanId" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringPaymentChange" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "monthlyPaymentId" TEXT,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringPaymentChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringGeneration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerPaymentChange_partnerId_createdAt_idx" ON "PartnerPaymentChange"("partnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringPaymentTemplate_companyId_reference_key" ON "RecurringPaymentTemplate"("companyId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPayment_cashPlanId_key" ON "MonthlyPayment"("cashPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPayment_documentId_key" ON "MonthlyPayment"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyPayment_templateId_period_key" ON "MonthlyPayment"("templateId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringPaymentChange_requestId_key" ON "RecurringPaymentChange"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringGeneration_requestId_key" ON "RecurringGeneration"("requestId");

-- AddForeignKey
ALTER TABLE "PartnerPaymentChange" ADD CONSTRAINT "PartnerPaymentChange_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPaymentTemplate" ADD CONSTRAINT "RecurringPaymentTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPaymentTemplate" ADD CONSTRAINT "RecurringPaymentTemplate_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPaymentTemplate" ADD CONSTRAINT "RecurringPaymentTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPayment" ADD CONSTRAINT "MonthlyPayment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringPaymentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPayment" ADD CONSTRAINT "MonthlyPayment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPayment" ADD CONSTRAINT "MonthlyPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPayment" ADD CONSTRAINT "MonthlyPayment_cashPlanId_fkey" FOREIGN KEY ("cashPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyPayment" ADD CONSTRAINT "MonthlyPayment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TradeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPaymentChange" ADD CONSTRAINT "RecurringPaymentChange_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringPaymentTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPaymentChange" ADD CONSTRAINT "RecurringPaymentChange_monthlyPaymentId_fkey" FOREIGN KEY ("monthlyPaymentId") REFERENCES "MonthlyPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringGeneration" ADD CONSTRAINT "RecurringGeneration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

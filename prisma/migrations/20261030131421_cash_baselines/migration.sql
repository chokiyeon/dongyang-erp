-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "baselineVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CashBaseline" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "baseDate" DATE NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashBaseline_companyId_revision_key" ON "CashBaseline"("companyId", "revision");

-- AddForeignKey
ALTER TABLE "CashBaseline" ADD CONSTRAINT "CashBaseline_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

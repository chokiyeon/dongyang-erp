-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "payeeAccount" TEXT,
ADD COLUMN     "payeeBank" TEXT,
ADD COLUMN     "payeeHolder" TEXT,
ADD COLUMN     "payeeVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PayrollPayment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "netAmount" DECIMAL(20,0) NOT NULL,
    "dueDate" DATE NOT NULL,
    "basis" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "adjustmentReason" TEXT,
    "cashPlanId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_cashPlanId_key" ON "PayrollPayment"("cashPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayment_employeeId_period_key" ON "PayrollPayment"("employeeId", "period");

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayment" ADD CONSTRAINT "PayrollPayment_cashPlanId_fkey" FOREIGN KEY ("cashPlanId") REFERENCES "CashPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

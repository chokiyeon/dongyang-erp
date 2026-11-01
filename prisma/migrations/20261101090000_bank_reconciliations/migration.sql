CREATE TABLE "BankReconciliation" (
 "id" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,
 "period" TEXT NOT NULL,
 "openingBalance" DECIMAL(20,0) NOT NULL,
 "closingBalance" DECIMAL(20,0) NOT NULL,
 "basis" TEXT NOT NULL,
 "confirmed" BOOLEAN NOT NULL DEFAULT false,
 "sourceReference" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 0,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankReconciliation_accountId_period_key" ON "BankReconciliation"("accountId","period");
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tradedDate" DATE NOT NULL,
    "tradedTime" TEXT,
    "description" TEXT NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "amount" DECIMAL(20,0) NOT NULL,
    "bankBalance" DECIMAL(20,0),
    "internalTransfer" BOOLEAN NOT NULL DEFAULT false,
    "requestId" TEXT NOT NULL,
    "importKey" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_requestId_key" ON "BankTransaction"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_importKey_key" ON "BankTransaction"("importKey");

-- CreateIndex
CREATE INDEX "BankTransaction_accountId_tradedDate_idx" ON "BankTransaction"("accountId", "tradedDate");

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

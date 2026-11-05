CREATE TABLE "PettyCashEntry" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "entryDate" DATE NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('OPENING','FUNDING','RETURN','RECEIPT','EXPENSE')),
 "amount" DECIMAL(20,0) NOT NULL CHECK ("amount" > 0),
 "title" TEXT NOT NULL,
 "projectCode" TEXT, "projectName" TEXT, "projectId" TEXT,
 "evidence" TEXT NOT NULL, "reason" TEXT NOT NULL,
 "requestId" TEXT NOT NULL UNIQUE, "fingerprint" TEXT NOT NULL,
 "voidedAt" TIMESTAMP(3), "voidReason" TEXT, "voidRequestId" TEXT UNIQUE, "voidFingerprint" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PettyCashEntry_void_complete" CHECK (("voidedAt" IS NULL AND "voidReason" IS NULL AND "voidRequestId" IS NULL AND "voidFingerprint" IS NULL) OR ("voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL AND "voidRequestId" IS NOT NULL AND "voidFingerprint" IS NOT NULL))
);
CREATE INDEX "PettyCashEntry_companyId_entryDate_createdAt_id_idx" ON "PettyCashEntry"("companyId","entryDate","createdAt","id");
CREATE UNIQUE INDEX "PettyCashEntry_active_opening" ON "PettyCashEntry"("companyId") WHERE "kind"='OPENING' AND "voidedAt" IS NULL;

ALTER TABLE "Partner" ADD COLUMN "businessNumber" TEXT;
CREATE INDEX "Partner_companyId_businessNumber_idx" ON "Partner"("companyId","businessNumber");
CREATE TABLE "PartnerIdentityChange" ("id" TEXT NOT NULL, "partnerId" TEXT NOT NULL, "previous" TEXT, "next" TEXT, "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PartnerIdentityChange_pkey" PRIMARY KEY ("id"));
ALTER TABLE "PartnerIdentityChange" ADD CONSTRAINT "PartnerIdentityChange_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReceivedNote" ADD COLUMN "ledgerBank" TEXT, ADD COLUMN "sourceIssuedDate" DATE, ADD COLUMN "issuingBank" TEXT, ADD COLUMN "sourceNoteKind" TEXT;
CREATE INDEX "ReceivedNote_companyId_ledgerBank_dueDate_idx" ON "ReceivedNote"("companyId", "ledgerBank", "dueDate");

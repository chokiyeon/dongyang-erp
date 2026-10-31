BEGIN;
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "attachmentVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DocumentAttachment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "period" TEXT,
    "note" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttachmentChange" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "next" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentAttachment_companyId_sourceType_sourceId_archivedAt_idx" ON "DocumentAttachment"("companyId", "sourceType", "sourceId", "archivedAt");

-- CreateIndex
CREATE INDEX "DocumentAttachment_companyId_period_idx" ON "DocumentAttachment"("companyId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "AttachmentChange_requestId_key" ON "AttachmentChange"("requestId");

-- AddForeignKey
ALTER TABLE "DocumentAttachment" ADD CONSTRAINT "DocumentAttachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttachmentChange" ADD CONSTRAINT "AttachmentChange_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "DocumentAttachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;

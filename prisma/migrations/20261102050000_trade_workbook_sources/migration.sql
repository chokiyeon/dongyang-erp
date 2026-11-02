CREATE TABLE "TradeWorkbookFile" ("id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "checksum" TEXT NOT NULL, "fileName" TEXT NOT NULL, "content" BYTEA NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TradeWorkbookFile_pkey" PRIMARY KEY ("id"));
CREATE TABLE "TradeWorkbookSource" ("id" TEXT NOT NULL, "fileId" TEXT NOT NULL, "documentId" TEXT NOT NULL, "sheet" TEXT NOT NULL, "sourceRow" INTEGER NOT NULL, "headers" JSONB NOT NULL, "cells" JSONB NOT NULL, "requestId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TradeWorkbookSource_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "TradeWorkbookFile_companyId_checksum_key" ON "TradeWorkbookFile"("companyId","checksum");
CREATE UNIQUE INDEX "TradeWorkbookSource_documentId_key" ON "TradeWorkbookSource"("documentId");
CREATE UNIQUE INDEX "TradeWorkbookSource_requestId_key" ON "TradeWorkbookSource"("requestId");
CREATE UNIQUE INDEX "TradeWorkbookSource_fileId_sheet_sourceRow_key" ON "TradeWorkbookSource"("fileId","sheet","sourceRow");
ALTER TABLE "TradeWorkbookFile" ADD CONSTRAINT "TradeWorkbookFile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeWorkbookSource" ADD CONSTRAINT "TradeWorkbookSource_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "TradeWorkbookFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeWorkbookSource" ADD CONSTRAINT "TradeWorkbookSource_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TradeDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

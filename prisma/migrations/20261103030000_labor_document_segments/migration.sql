DROP INDEX "LaborImportRow_fileId_sheet_sourceRow_key";
CREATE UNIQUE INDEX "LaborImportRow_fileId_sheet_sourceRow_projectId_role_key" ON "LaborImportRow"("fileId","sheet","sourceRow","projectId","role");
CREATE INDEX "LaborImportRow_fileId_sheet_sourceRow_idx" ON "LaborImportRow"("fileId","sheet","sourceRow");

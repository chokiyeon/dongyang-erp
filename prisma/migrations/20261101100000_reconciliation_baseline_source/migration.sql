ALTER TABLE "CashBaseline" ADD COLUMN "reconciliationPeriod" TEXT;
ALTER TABLE "CashBaseline" ADD COLUMN "reconciliationBasis" TEXT;
-- Account revision serializes reconciliation against imported bank rows.
CREATE FUNCTION erp_bank_account_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND ROW(OLD."accountId",OLD."tradedDate",OLD."direction",OLD."amount",OLD."bankBalance") IS NOT DISTINCT FROM ROW(NEW."accountId",NEW."tradedDate",NEW."direction",NEW."amount",NEW."bankBalance") THEN RETURN NEW; END IF;
 IF TG_OP IN ('UPDATE','DELETE') THEN UPDATE "BankAccount" SET "version"="version"+1 WHERE "id"=OLD."accountId"; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD."accountId" IS DISTINCT FROM NEW."accountId") THEN UPDATE "BankAccount" SET "version"="version"+1 WHERE "id"=NEW."accountId"; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER erp_bank_account_revision_trigger AFTER INSERT OR UPDATE OR DELETE ON "BankTransaction" FOR EACH ROW EXECUTE FUNCTION erp_bank_account_revision();

import test from "node:test";
import assert from "node:assert/strict";
import {canPrepareOfficeDatabase} from "../scripts/office-database-safety.mjs";

test("office setup accepts an empty DB or completed known ERP migrations only", () => {
  const tables = ["_prisma_migrations", "Company", "BankAccount"];
  const complete = {migration_name:"erp_initial", finished_at:new Date(), rolled_back_at:null};
  assert.equal(canPrepareOfficeDatabase([], [], ["erp_initial"]), true);
  assert.equal(canPrepareOfficeDatabase(["OtherAccounting"], [], ["erp_initial"]), false);
  assert.equal(canPrepareOfficeDatabase(tables, [], ["erp_initial"]), false);
  assert.equal(canPrepareOfficeDatabase(tables, [complete], ["erp_initial"]), true);
  assert.equal(canPrepareOfficeDatabase(tables, [complete, {...complete,migration_name:"foreign_app"}], ["erp_initial"]), false);
  assert.equal(canPrepareOfficeDatabase(tables, [{...complete,finished_at:null}], ["erp_initial"]), false);
  assert.equal(canPrepareOfficeDatabase(tables, [{...complete,rolled_back_at:new Date()}], ["erp_initial"]), false);
});

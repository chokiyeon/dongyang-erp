// Only a dedicated empty database or a recognizable, successfully migrated ERP is eligible.
export function canPrepareOfficeDatabase(tables, migrations, knownNames) {
  if (tables.length === 0) return true;
  if (!["_prisma_migrations", "Company", "BankAccount"].every(name => tables.includes(name))) return false;
  if (migrations.length === 0) return false;
  const known = new Set(knownNames);
  return migrations.every(row => known.has(row.migration_name) && row.finished_at && !row.rolled_back_at);
}

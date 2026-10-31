import { redirect } from "next/navigation";
import { getDb } from "./db";

import { COMPANY_ID } from "./constants";
export { COMPANY_ID } from "./constants";
export function getCompany() { return getDb().company.findUnique({ where: { id: COMPANY_ID } }); }
export async function requireCompany() {
  const company = await getCompany();
  if (!company) redirect("/settings");
  return company;
}

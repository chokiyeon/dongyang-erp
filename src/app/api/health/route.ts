import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { authConfigured } from "@/lib/auth";
export async function GET() {
  await connection();
  try {
    if (!authConfigured()) throw new Error("unavailable");
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", service:"dongyang-erp" }, { headers: { "Cache-Control": "no-store", "X-Dongyang-ERP":"1" } });
  } catch {
    return Response.json({ status: "unavailable", service:"dongyang-erp" }, { status: 503, headers: { "Cache-Control": "no-store", "X-Dongyang-ERP":"1" } });
  }
}

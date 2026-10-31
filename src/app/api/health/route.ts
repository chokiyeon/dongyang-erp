import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { authConfigured } from "@/lib/auth";
export async function GET() {
  await connection();
  try {
    if (!authConfigured()) throw new Error("unavailable");
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { authConfigured, createSession, destroySession, passwordMatches } from "@/lib/auth";

// 단일 인스턴스 개발용 방어. 외부 공개 시 공유 저장소 기반 제한으로 확장합니다.
const attempts = new Map<string, { count: number; expires: number }>();
export async function login(_previous: { error: string }, data: FormData) {
  if (!authConfigured()) return { error: "관리자 비밀번호와 세션 키 설정이 필요합니다." };
  const agent = (await headers()).get("user-agent")?.slice(0, 300) ?? "unknown";
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.expires <= now) attempts.delete(key);
  const entry = attempts.get(agent) ?? { count: 0, expires: now + 60_000 };
  if (entry.count >= 10) return { error: "시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요." };
  const password = data.get("password");
  if (typeof password !== "string" || !passwordMatches(password)) {
    if (attempts.size >= 1000) return { error: "잠시 후 다시 시도해 주세요." };
    attempts.set(agent, { ...entry, count: entry.count + 1 });
    return { error: "비밀번호를 확인해 주세요." };
  }
  attempts.delete(agent);
  await createSession();
  redirect("/");
}
export async function logout() { await destroySession(); redirect("/login"); }

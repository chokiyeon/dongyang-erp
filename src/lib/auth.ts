import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "dongyang_session";
const MAX_AGE = 60 * 60 * 8;

function config() {
  const password = process.env.ERP_ADMIN_PASSWORD;
  const secret = process.env.ERP_SESSION_SECRET;
  if (!password || password.length < 12 || !secret || secret.length < 32) return null;
  return { password, secret };
}

function signature(value: string) {
  const settings = config();
  if (!settings) return null;
  // 비밀번호 변경 시 기존 세션도 무효화합니다.
  return createHmac("sha256", settings.secret).update(`${settings.password}\0${value}`).digest("base64url");
}

export function authConfigured() { return config() !== null; }

export function passwordMatches(password: string): boolean {
  const settings = config();
  if (!settings || password.length > 1024) return false;
  const supplied = createHmac("sha256", settings.secret).update(password).digest();
  const expected = createHmac("sha256", settings.secret).update(settings.password).digest();
  return timingSafeEqual(supplied, expected);
}

export async function createSession() {
  if (!config()) throw new Error("관리자 접근 설정이 필요합니다.");
  const payload = `${Date.now()}.${randomBytes(24).toString("base64url")}`;
  (await cookies()).set(COOKIE, `${payload}.${signature(payload)}`, {
    httpOnly: true, sameSite: "strict", path: "/", maxAge: MAX_AGE,
    // 로컬 HTTP 개발과 HTTPS 운영의 쿠키 정책을 구분합니다.
    secure: process.env.ERP_COOKIE_SECURE !== "false",
  });
}

export async function isAuthenticated() {
  await connection();
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value || value.length > 256 || !config()) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || !/^\d{13}$/.test(parts[0])) return false;
  const issued = Number(parts[0]);
  const age = Date.now() - issued;
  if (age < 0 || age >= MAX_AGE * 1000) return false;
  const expected = signature(`${parts[0]}.${parts[1]}`);
  if (!expected) return false;
  const actualBytes = Buffer.from(parts[2]);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function requireAdmin() {
  if (!(await isAuthenticated())) redirect("/login");
}

export async function destroySession() { (await cookies()).delete(COOKIE); }

import { readFileSync, appendFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
// 개발 환경의 기존 값을 보존하며 비밀값을 로그에 노출하지 않습니다.
const path = new URL("../.env", import.meta.url);
const current = readFileSync(path, "utf8");
let extra = "";
for (const [name, bytes] of [["ERP_ADMIN_PASSWORD", 24], ["ERP_SESSION_SECRET", 48]]) {
  if (!new RegExp(`^${name}=`, "m").test(current) && !process.env[name]) extra += `${name}=${randomBytes(bytes).toString("base64url")}\n`;
}
if (!/^ERP_COOKIE_SECURE=/m.test(current) && !process.env.ERP_COOKIE_SECURE) extra += "ERP_COOKIE_SECURE=false\n";
if (extra) appendFileSync(path, `\n# 로컬 개발 전용 관리자 접근 설정\n${extra}`);
chmodSync(path, 0o600);
console.log("로컬 관리자 접근 설정 확인 완료 (비밀값 비표시, 기존 값 보존)");

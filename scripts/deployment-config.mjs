export function validateDeployment(env) {
  const errors = [];
  const password = env.ERP_ADMIN_PASSWORD ?? "";
  if (password.length < 16 || password.length > 1024 || /^(local-development-only|password|12345678)/i.test(password)) errors.push("운영 관리자 비밀번호를 16~1024자로 별도 설정해 주세요.");
  if ((env.ERP_SESSION_SECRET ?? "").length < 32) errors.push("운영 세션 키를 32자 이상의 별도 무작위 값으로 설정해 주세요.");
  if (env.ERP_SESSION_SECRET === password) errors.push("비밀번호와 세션 키는 서로 달라야 합니다.");
  if (env.ERP_COOKIE_SECURE !== "true") errors.push("운영 HTTPS 쿠키 설정 ERP_COOKIE_SECURE=true가 필요합니다.");
  try {
    const url = new URL(env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || !url.username || !url.password) throw new Error();
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) errors.push("운영 전용 데이터베이스 주소를 설정해 주세요.");
    if (decodeURIComponent(url.password) === "local-development-only") errors.push("개발용 DB 비밀번호를 운영에 사용할 수 없습니다.");
  } catch { errors.push("운영 DATABASE_URL을 확인해 주세요."); }
  if (env.RENDER_EXTERNAL_URL) { try { if (new URL(env.RENDER_EXTERNAL_URL).protocol !== "https:") throw new Error(); } catch { errors.push("운영 접속 주소는 HTTPS여야 합니다."); } }
  return errors;
}

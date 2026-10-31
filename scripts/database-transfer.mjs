import { openSync, closeSync, mkdirSync, chmodSync, existsSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
// No connection strings or tool stderr (which can contain credentials) are logged.
const mode = process.argv[2]; const fileArg = process.argv[3];
if (!["backup", "restore"].includes(mode) || (mode === "restore" && !fileArg)) { console.error("사용법: database-transfer.mjs backup [새 파일 경로] | restore <백업 파일>"); process.exit(1); }
function connection(value) {
  const url = new URL(value ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) };
  if (url.searchParams.has("sslmode")) env.PGSSLMODE = url.searchParams.get("sslmode");
  return { url, env };
}
let file; let fd; let created = false;
try {
  const source = connection(process.env.DATABASE_URL);
  if (mode === "backup") {
    if (!fileArg) mkdirSync("backups", { recursive: true, mode: 0o700 });
    file = resolve(fileArg ?? `backups/dongyang-${new Date().toISOString().replaceAll(":", "-")}.dump`);
    fd = openSync(file, "wx", 0o600); created = true;
    const result = spawnSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges"], { env: source.env, stdio: ["ignore", fd, "pipe"] });
    closeSync(fd); fd = undefined;
    if (result.status !== 0 || !statSync(file).size) throw new Error();
    chmodSync(file, 0o600); console.log(`백업 완료: ${file}`);
  } else {
    if (!existsSync(fileArg)) throw new Error();
    const target = connection(process.env.ERP_RESTORE_DATABASE_URL);
    if (source.url.hostname === target.url.hostname && (source.url.port || "5432") === (target.url.port || "5432") && source.url.pathname === target.url.pathname) { console.error("현재 사용 DB에는 복원할 수 없습니다. 별도의 빈 복구 DB를 지정하세요."); process.exit(1); }
    const client = new pg.Client({ connectionString: process.env.ERP_RESTORE_DATABASE_URL });
    try {
      await client.connect();
      const count = await client.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')");
      if (count.rows[0].n !== 0) { console.error("복구 대상에 기존 자료가 있습니다. 새 빈 DB만 사용할 수 있습니다."); process.exitCode = 1; }
      else {
        const result = spawnSync("pg_restore", ["--dbname", target.env.PGDATABASE, "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", resolve(fileArg)], { env: target.env, stdio: ["ignore", "ignore", "pipe"] });
        if (result.status !== 0) throw new Error();
        console.log("별도 DB 복원 완료. 자료와 로그인 확인 후 운영 연결을 전환하세요.");
      }
    } finally { await client.end(); }
  }
} catch {
  if (fd !== undefined) closeSync(fd);
  if (mode === "backup" && created && file && existsSync(file)) unlinkSync(file);
  console.error("DB 작업 실패. PostgreSQL 17 클라이언트 설치, 접속 설정, 파일 경로 및 대상 DB를 확인하세요. 비밀값은 표시하지 않았습니다."); process.exitCode = 1;
}

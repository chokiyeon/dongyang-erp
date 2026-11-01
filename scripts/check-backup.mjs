import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
const tag = randomUUID().replaceAll("-", "");
const sourceName = `verify_backup_${tag}`; const targetName = `verify_restore_${tag}`;
const sourceUrl = new URL(process.env.DATABASE_URL); sourceUrl.pathname = `/${sourceName}`; sourceUrl.search = "";
const targetUrl = new URL(sourceUrl); targetUrl.pathname = `/${targetName}`;
const directory = mkdtempSync(join(tmpdir(), "dongyang-backup-")); const file = join(directory, "fixture.dump");
let stage = "연결";
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL }); const created = [];
try {
  await admin.connect();
  stage = "검증 DB 생성";
  for (const name of [sourceName,targetName]) { await admin.query(`CREATE DATABASE "${name}"`); created.push(name); }
  stage = "최신 ERP 스키마 구성";
  const deploy = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {env:{...process.env,DATABASE_URL:sourceUrl.toString()},encoding:"utf8"});
  assert.equal(deploy.status,0,"격리된 검증 DB 스키마 구성 실패");
  let sourceTables; let sourceMigrations;
  stage = "합성 자료 생성";
  const source = new pg.Client({ connectionString: sourceUrl.toString() });
  try { await source.connect();
    sourceMigrations=(await source.query('SELECT migration_name, checksum FROM "_prisma_migrations" ORDER BY migration_name')).rows;
    await source.query("CREATE TABLE backup_fixture (id integer PRIMARY KEY, amount numeric(20,0), label text, content bytea)"); await source.query("INSERT INTO backup_fixture VALUES (1, 99999999999999999999, '합성 검증 자료', $1)", [Buffer.from([0,255,37,80,68,70,10,13,128])]); sourceTables=(await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  } finally { await source.end(); }
  const env = { ...process.env, DATABASE_URL: sourceUrl.toString(), ERP_RESTORE_DATABASE_URL: targetUrl.toString() };
  const run = (mode) => spawnSync(process.execPath, ["scripts/database-transfer.mjs",mode,file], { env, encoding:"utf8" });
  stage = "백업 실행";
  assert.equal(run("backup").status,0,"격리된 검증 DB 백업 실패"); assert.equal(statSync(file).mode & 0o777,0o600);
  assert.notEqual(run("backup").status,0,"기존 백업을 덮어쓰면 안 됩니다.");
  stage = "빈 DB 복구";
  assert.equal(run("restore").status,0,"별도 빈 DB 복구 실패");
  stage = "기존 DB 보호";
  assert.notEqual(run("restore").status,0,"자료가 있는 DB에 다시 복원하면 안 됩니다.");
  stage = "원본 DB 보호";
  const current = spawnSync(process.execPath,["scripts/database-transfer.mjs","restore",file],{env:{...env,ERP_RESTORE_DATABASE_URL:sourceUrl.toString()},encoding:"utf8"});assert.notEqual(current.status,0,"원본 DB에 복원하면 안 됩니다.");
  stage = "복구 자료 확인";
  const target = new pg.Client({connectionString:targetUrl.toString()});
  try { await target.connect();
    assert.deepEqual((await target.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows,sourceTables);
    assert.deepEqual((await target.query('SELECT migration_name, checksum FROM "_prisma_migrations" ORDER BY migration_name')).rows,sourceMigrations);
    const result=await target.query("SELECT amount::text,label,content FROM backup_fixture WHERE id=1");assert.deepEqual(result.rows,[{amount:"99999999999999999999",label:"합성 검증 자료",content:Buffer.from([0,255,37,80,68,70,10,13,128])}]); } finally { await target.end(); }
  console.log("최신 ERP 스키마·마이그레이션 체크섬·별도 검증 DB 백업·복구·원본 첨부 바이트·20자리 금액 보존·원본/기존 DB 및 백업 덮어쓰기 차단 통과");
} catch { console.error(`실패 단계: ${stage}`); console.error("백업·복구 검증 실패. PostgreSQL 17 클라이언트와 검증 DB 생성 권한을 확인하세요. 접속 정보는 표시하지 않았습니다."); process.exitCode=1; }
finally { for(const name of created.reverse()) await admin.query(`DROP DATABASE "${name}"`);await admin.end();rmSync(directory,{recursive:true,force:true}); }

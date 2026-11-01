import {spawnSync} from "node:child_process";
import {readdirSync} from "node:fs";
import pg from "pg";
import {canPrepareOfficeDatabase} from "./office-database-safety.mjs";
import {validateOfficeServer} from "./office-server-config.mjs";
const errors=validateOfficeServer(process.env);if(errors.length){errors.forEach(e=>console.error(e));process.exit(1);}
if(Number(process.versions.node.split(".")[0])!==24){console.error("설치 안내의 Node.js 24 실행 환경을 확인하세요.");process.exit(1);}
const database=new URL(process.env.DATABASE_URL);if(["postgres","template0","template1"].includes(decodeURIComponent(database.pathname.slice(1)).toLowerCase())){console.error("기본 관리 DB가 아닌 ERP 전용 DB를 지정하세요.");process.exit(1);}
let ready=false;const client=new pg.Client({connectionString:process.env.DATABASE_URL});
try{await client.connect();const tables=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");const names=tables.rows.map(row=>row.tablename);const known=readdirSync("prisma/migrations",{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name);const migrations=names.includes("_prisma_migrations")?await client.query("SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations"): {rows:[]};ready=canPrepareOfficeDatabase(names,migrations.rows,known);if(!ready)console.error("기존 다른 프로그램 자료가 있는 DB에는 설치하지 않습니다. 빈 ERP 전용 DB 또는 이 ERP의 기존 DB인지 확인하세요.");}catch{console.error("ERP 전용 DB 접속을 확인하지 못했습니다. 설치 계정·DB 이름·접속 설정을 확인하세요. 비밀번호는 표시하지 않았습니다.");}finally{await client.end();}
if(!ready)process.exit(1);
for(const command of["generate","deploy"]){const args=command==="generate"?["generate"]:["migrate","deploy"];const result=spawnSync(process.execPath,["node_modules/prisma/build/index.js",...args],{stdio:"inherit",env:process.env});if(result.status!==0)process.exit(result.status??1);}
console.log("ERP 실행 파일 생성 준비와 추가 마이그레이션 확인을 완료했습니다. 기존 DB를 초기화하지 않았습니다.");

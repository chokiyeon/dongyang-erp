import {existsSync,accessSync,constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateOfficeServer} from './office-server-config.mjs';
process.chdir(join(dirname(fileURLToPath(import.meta.url)),'..'));
let pending=0;
const ok=message=>console.log(`[OK] ${message}`),todo=message=>{pending++;console.log(`[TODO] ${message}`);};
console.log('동양 ERP · 회사 PC 설치 전 점검 (설정·DB·NAS 자료를 변경하지 않습니다.)');
if(process.platform!=='win32'){console.log('회사 Windows PC에서 ERP-check.cmd를 실행하세요. 이 개발 환경은 회사 PC 점검 결과가 아닙니다.');process.exitCode=1;}else{
 if(Number(process.versions.node.split('.')[0])===24)ok('Node.js 24 준비됨');else todo('Node.js 24를 설치한 뒤 다시 확인하세요.');
 if(process.arch==='x64')ok('64비트 Node.js 실행 중');else todo('64비트 Windows/Node.js 환경을 확인하세요.');
 let loaded=false;
 if(existsSync('.env.office')){try{process.loadEnvFile('.env.office');loaded=true;const errors=validateOfficeServer(process.env);if(errors.length)errors.forEach(todo);else ok('회사 전용 설정의 기본 형식 확인');}catch{todo('.env.office 설정 파일 형식을 확인하세요. 비밀번호는 표시하지 않습니다.');}}else todo('.env.office.example을 복사해 .env.office를 준비하세요.');
 const candidates=[process.env.ERP_PG_BIN_DIR,join(process.env.ProgramFiles||'C:\\Program Files','PostgreSQL','17','bin')].filter(Boolean);
 let pgReady=true;for(const tool of ['psql','pg_dump','pg_restore']){const binary=candidates.map(folder=>join(folder,`${tool}.exe`)).find(existsSync)||`${tool}.exe`;const result=spawnSync(binary,['--version'],{encoding:'utf8',windowsHide:true,timeout:5000});if(result.status===0&&/\b17\./.test(result.stdout||''))ok(`PostgreSQL 17 ${tool} 준비됨`);else{todo(`PostgreSQL 17의 ${tool} 도구를 확인하세요. 설치 경로는 ERP_PG_BIN_DIR로 지정할 수 있습니다.`);pgReady=false;}}
 if(!pgReady)console.log('설치 안내: docs/OFFICE-PC-AND-NAS.md · PostgreSQL 설치 자체는 이 점검이 수행하지 않습니다.');
 if(loaded&&!validateOfficeServer(process.env).length&&existsSync('node_modules/pg/package.json')){const {default:pg}=await import('pg');const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,query_timeout:3000});try{await client.connect();await client.query('SELECT 1');ok('회사 전용 DB 접속 확인 (자료 조회·수정 없음)');}catch{todo('회사 전용 DB 이름·계정·비밀번호와 PostgreSQL 서비스 실행 상태를 확인하세요.');}finally{await client.end();}}
 if(loaded&&!validateOfficeServer(process.env).length&&!existsSync('node_modules/pg/package.json'))todo('프로그램 의존성 설치 전이므로 DB 접속 점검은 생략했습니다. ERP-install.cmd의 npm ci 단계 뒤 재점검하세요.');
 const nas=process.env.ERP_NAS_BACKUP_DIR;if(nas){try{accessSync(nas,constants.R_OK);ok('설정한 NAS 경로 읽기 접근 확인 (쓰기·검증 백업은 별도 시험 필요)');}catch{todo('실행 계정에서 설정한 NAS 경로가 열리는지 확인하세요. 로컬 시험은 NAS 없이 가능합니다.');}}else console.log('[안내] NAS 백업 경로 미설정 · 회사 PC 단독 시험과 로컬 백업부터 가능합니다.');
 console.log(pending?`확인할 항목 ${pending}개입니다. 설치 완료 판정이 아닙니다.`:'사전 점검을 통과했습니다. ERP-install.cmd 실행 후 저장·출력·백업/복원을 따로 검증하세요.');process.exitCode=pending?1:0;
}

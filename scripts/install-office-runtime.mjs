import {existsSync,mkdirSync,openSync,closeSync,unlinkSync,appendFileSync,readdirSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateOfficeServer} from './office-server-config.mjs';
import {canPrepareOfficeDatabase} from './office-database-safety.mjs';
export function installerNpmCli(nodePath,present=existsSync){const path=join(dirname(nodePath),'node_modules/npm/bin/npm-cli.js');if(!present(path))throw Error('Node.js 설치 파일(.msi)의 npm 구성요소를 확인하세요.');return path;}
export function installerRedact(value,env){let text=String(value??'');for(const key of ['DATABASE_URL','ERP_ADMIN_PASSWORD','ERP_SESSION_SECRET'])if(env[key])text=text.split(env[key]).join('[hidden]');return text.replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[DB connection hidden]');}
async function installationSteps({root,env,nodePath=process.execPath,run=spawnSync,loadDatabase,verifyServer}){
 const errors=validateOfficeServer(env);if(errors.length)throw Error(errors.join('\n'));const npm=installerNpmCli(nodePath);const logs=join(root,'logs');mkdirSync(logs,{recursive:true});const log=join(logs,'setup.log'),state=join(logs,'setup-stage.txt');const secrets={...env};
 const stage=message=>{writeFileSync(state,message);appendFileSync(log,`\n[${new Date().toISOString()}] ${message}\n`,{mode:0o600});};
 const execute=(label,args)=>{stage(label);const r=run(nodePath,args,{cwd:root,env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024});appendFileSync(log,installerRedact(`${r.stdout??''}\n${r.stderr??''}`,secrets));if(r.error||r.status!==0)throw Error(`${label} 실패. logs/setup.log를 확인하세요. 기존 DB를 초기화하지 않았습니다.`);};
 stage('설치 전 설정 확인');
 if(!env.ERP_PG_BIN_DIR){const folder=join(env.ProgramW6432??env.ProgramFiles??'C:\\Program Files','PostgreSQL/17/bin');if(existsSync(join(folder,'pg_dump.exe'))){env.ERP_PG_BIN_DIR=folder;const file=join(root,'.env.office');const text=readFileSync(file,'utf8'),setting='ERP_PG_BIN_DIR='+JSON.stringify(folder.replaceAll('\\','/'));writeFileSync(file,/^ERP_PG_BIN_DIR=.*$/m.test(text)?text.replace(/^ERP_PG_BIN_DIR=.*$/m,()=>setting):text+'\n'+setting+'\n');}}
 execute('프로그램 구성요소 설치',[npm,'ci','--include=dev','--prefer-offline']);
 const db=await loadDatabase();let tables,migrations;
 try{await db.connect();tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename);migrations=tables.includes('_prisma_migrations')?(await db.query('SELECT migration_name,finished_at,rolled_back_at FROM _prisma_migrations')).rows:[];}finally{await db.end();}
 const known=readdirSync(join(root,'prisma/migrations'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name);
 if(!canPrepareOfficeDatabase(tables,migrations,known))throw Error('다른 프로그램 또는 확인되지 않은 DB입니다. 자료를 변경하지 않고 설치를 중단했습니다.');
 if(tables.length){const backupDir=join(root,'backups/install');mkdirSync(backupDir,{recursive:true,mode:0o700});const backup=join(backupDir,`before-${new Date().toISOString().replaceAll(':','-')}.dump`);execute('기존 ERP 데이터 백업',['scripts/database-transfer.mjs','backup',backup]);}
 execute('ERP 데이터베이스 준비',['scripts/prepare-office.mjs']);
 execute('ERP 실행 화면 생성',[npm,'run','build:office']);
 stage('ERP 실행 확인');await verifyServer();
 execute('바탕화면 아이콘 설치',['scripts/install-office-shortcuts.mjs']);
 stage('설치 완료');return{log};
}
export async function runOfficeInstallation(options){
 const folder=join(options.root,'logs');mkdirSync(folder,{recursive:true});const file=join(folder,'setup.lock');let fd;
 try{fd=openSync(file,'wx',0o600);}catch(error){if(error.code!=='EEXIST')throw error;let pid;try{pid=JSON.parse(readFileSync(file,'utf8')).pid;}catch{throw Error('이전 설치 기록을 확인해야 합니다. 설치를 중복 실행하지 마세요.');}let stopped=false;try{process.kill(pid,0);}catch(e){stopped=e.code==='ESRCH';}if(!stopped)throw Error('다른 ERP 설치가 진행 중입니다. 완료될 때까지 기다리세요.');unlinkSync(file);fd=openSync(file,'wx',0o600);}
 writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);
 try{return await installationSteps(options);}finally{try{if(JSON.parse(readFileSync(file,'utf8')).pid===process.pid)unlinkSync(file);}catch{/* Do not remove another installation's lock. */}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
 try{process.loadEnvFile('.env.office');if(process.platform!=='win32'||Number(process.versions.node.split('.')[0])!==24)throw Error('메인 PC에 Node.js 24 설치 파일(.msi)로 설치되어 있는지 확인하세요.');await runOfficeInstallation({root,env:process.env,loadDatabase:async()=>{const{default:pg}=await import('pg');return new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:5000});},verifyServer:async()=>{const{ensureOffice}=await import('./office-desktop.mjs');await ensureOffice({root,env:process.env,open:async()=>{}});}});console.log('ERP_SETUP_OK');}catch(error){console.error(installerRedact(error?.message??'ERP 설치를 완료하지 못했습니다.',process.env));process.exitCode=1;}
}

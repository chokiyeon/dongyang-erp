import {validateOfficeSources,validateOfficeBuild} from './office-build-validation.mjs';
import {spawnSync} from 'node:child_process';
// Load values into the child environment without forwarding --env-file through
// Next.js worker execArgv/NODE_OPTIONS (Node rejects that flag in NODE_OPTIONS).
try{process.loadEnvFile('.env.office');}catch{console.error('회사 설정 파일 .env.office를 확인하세요. 설정 내용은 표시하지 않습니다.');process.exit(1);}
try{validateOfficeSources(process.cwd());}catch(error){console.error(error.message);process.exit(1);}
const result=spawnSync(process.execPath,['node_modules/next/dist/bin/next','build','--webpack'],{stdio:'inherit',env:process.env});
if(result.error)console.error('회사 ERP 빌드를 실행하지 못했습니다. Node.js와 구성요소 설치 상태를 확인하세요.');
if(result.status===0){try{validateOfficeBuild(process.cwd());}catch(error){console.error(error.message);process.exit(1);}}
process.exit(result.status??1);

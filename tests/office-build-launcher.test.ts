import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
test('회사 빌드는 env-file을 자식 실행 인자가 아닌 환경으로만 전달하고 실패 상태를 보존한다',()=>{
 const folder=mkdtempSync(join(tmpdir(),'erp-office-worker-')),launcher=resolve('scripts/build-office.mjs');
 try{for(const file of ['src/app/layout.tsx','src/app/login/page.tsx','src/app/api/health/route.ts','src/app/(workspace)/page.tsx']){mkdirSync(join(folder,file,'..'),{recursive:true});writeFileSync(join(folder,file),'synthetic');}mkdirSync(join(folder,'.next/server'),{recursive:true});writeFileSync(join(folder,'.next/server/app-paths-manifest.json'),JSON.stringify(Object.fromEntries(['/login/page','/api/health/route','/(workspace)/page','/(workspace)/settings/page','/(workspace)/work-records/import/page'].map(x=>[x,'synthetic.js']))));mkdirSync(join(folder,'node_modules/next/dist/bin'),{recursive:true});writeFileSync(join(folder,'.env.office'),'ERP_BUILD_TEST_MARKER=synthetic-office\n');writeFileSync(join(folder,'node_modules/next/dist/bin/next'),`const fs=require('node:fs');fs.writeFileSync('result.json',JSON.stringify({args:process.argv.slice(2),execArgs:process.execArgv,marker:process.env.ERP_BUILD_TEST_MARKER}));process.exit(Number(process.env.ERP_BUILD_TEST_EXIT||0));`);
 const env={...process.env};delete env.ERP_BUILD_TEST_MARKER;delete env.NODE_OPTIONS;
 const result=spawnSync(process.execPath,[launcher],{cwd:folder,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);const captured=JSON.parse(readFileSync(join(folder,'result.json'),'utf8'));assert.deepEqual(captured,{args:['build','--webpack'],execArgs:[],marker:'synthetic-office'});assert.equal(result.stdout.includes('synthetic-office'),false);
 assert.equal(spawnSync(process.execPath,[launcher],{cwd:folder,env:{...env,ERP_BUILD_TEST_EXIT:'9'},encoding:'utf8'}).status,9);
 rmSync(join(folder,'.env.office'));const missing=spawnSync(process.execPath,[launcher],{cwd:folder,env,encoding:'utf8'});assert.equal(missing.status,1);assert.match(missing.stderr,/\.env.office/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

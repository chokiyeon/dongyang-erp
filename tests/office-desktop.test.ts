import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {desktopAddress,probeOffice,browserCommand,ensureOffice} from '../scripts/office-desktop.mjs';
const env={ERP_OFFICE_MODE:'true',ERP_OFFICE_BIND:'192.168.0.12',PORT:'3000',ERP_ADMIN_PASSWORD:'Abc!2468',ERP_SESSION_SECRET:'synthetic-long-session-secret-at-least-32',ERP_COOKIE_SECURE:'false',DATABASE_URL:'postgresql://erp:synthetic-secret@127.0.0.1/erp'};
function fixture(){const root=mkdtempSync(join(tmpdir(),'erp-desktop-'));mkdirSync(join(root,'.next'));writeFileSync(join(root,'.next/BUILD_ID'),'synthetic');mkdirSync(join(root,'node_modules/next/dist/bin'),{recursive:true});writeFileSync(join(root,'node_modules/next/dist/bin/next'),'');return root;}
test('윈도우 앱 주소와 전용 창 인자는 사내 주소·포트만 사용한다',()=>{assert.equal(desktopAddress(env),'http://192.168.0.12:3000');assert.throws(()=>desktopAddress({...env,ERP_OFFICE_BIND:'0.0.0.0'}));assert.throws(()=>desktopAddress({...env,PORT:'3000 & calc'}));const edge=browserCommand('http://192.168.0.12:3000/login',{NODE_ENV:'test',ProgramFiles:'C:\\Program Files'},()=>true);assert.deepEqual(edge.args,['--app=http://192.168.0.12:3000/login','--new-window']);assert.equal(browserCommand('http://127.0.0.1:3000/login',{NODE_ENV:'test'},()=>false).exe,'rundll32.exe');});
test('실행 앱 식별은 ERP 응답을 대조하고 다른 프로그램·DB 장애를 구분한다',async()=>{
 const response=(body:unknown,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
 assert.equal(await probeOffice('http://127.0.0.1',async()=>response({status:'ok',service:'dongyang-erp'},200,{'x-dongyang-erp':'1'})),'ready');assert.equal(await probeOffice('http://127.0.0.1',async()=>response({status:'ok'})),'other');assert.equal(await probeOffice('http://127.0.0.1',async()=>response({status:'unavailable',service:'dongyang-erp'},503,{'x-dongyang-erp':'1'})),'unavailable');assert.equal(await probeOffice('http://127.0.0.1',async()=>{throw Object.assign(new Error('closed'),{cause:{code:'ECONNREFUSED'}})}),'closed');
 let calls=0;assert.equal(await probeOffice('http://127.0.0.1',async()=>++calls===1?response({status:'ok'}):new Response('동양계전 ERP 로그인')),'ready');
});
test('기존 ERP 재사용과 신규 서버 준비 대기·중복 클릭은 중복 서버를 만들지 않는다',async()=>{
 const root=fixture();try{let started=0,opened=0;await ensureOffice({root,env,probe:async()=> 'ready',start:async()=>{started++;},open:async()=>{opened++;}});assert.equal(started,0);assert.equal(opened,1);
 let ready=false,release!:()=>void;const gate=new Promise<void>(r=>release=r),start=async()=>{started++;await gate;ready=true;};const probe=async()=>ready?'ready':'closed';
 const first=ensureOffice({root,env,probe,start,open:async()=>{opened++;},wait:async()=>{await gate;},attempts:3});await new Promise(r=>setTimeout(r,10));const second=ensureOffice({root,env,probe,start,open:async()=>{opened++;},wait:async()=>{await gate;},attempts:3});release();await Promise.all([first,second]);assert.equal(started,1);assert.equal(opened,3);assert.equal(existsSync(join(root,'logs/office-start.lock')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('앱 실행 오류는 잠금을 정리하며 다른 앱·미설치·실행 장애는 창을 열지 않는다',async()=>{
 const root=fixture();try{let opened=0;await assert.rejects(ensureOffice({root,env,probe:async()=> 'other',open:async()=>{opened++;}}),/다른 프로그램/);await assert.rejects(ensureOffice({root,env,probe:async()=> 'closed',start:async()=>{throw Error('synthetic failure');},open:async()=>{opened++;}}),/synthetic failure/);assert.equal(existsSync(join(root,'logs/office-start.lock')),false);await assert.rejects(ensureOffice({root,env,probe:async()=> 'closed',start:async()=>1,wait:async()=>{},attempts:1,open:async()=>{opened++;}}),/준비되지/);assert.equal(opened,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('다른 시작 요청의 잠금과 윈도우 스크립트의 텍스트 형식을 보존한다',async()=>{
 const root=fixture();try{mkdirSync(join(root,'logs'));const lock=join(root,'logs/office-start.lock');writeFileSync(lock,JSON.stringify({pid:process.pid}));let started=0;await assert.rejects(ensureOffice({root,env,probe:async()=> 'closed',start:async()=>{started++;},wait:async()=>{},attempts:1}),/준비되지/);assert.equal(started,0);assert.equal(existsSync(lock),true);
 }finally{rmSync(root,{recursive:true,force:true});}
 for(const name of ['ERP-start.cmd','ERP-install.cmd','ERP-check.cmd','ERP-App-install.cmd','ERP-LAN-setup.cmd']){const bytes=readFileSync(name);assert.equal(bytes.some(v=>v>127),false,name);assert.equal(bytes.toString().replaceAll('\r\n','').includes('\n'),false,name);}
 for(const name of ['open-office-app.ps1','install-office-app.ps1','stop-office-app.ps1','configure-office-lan.ps1'])assert.deepEqual([...readFileSync(join('scripts',name)).subarray(0,3)],[239,187,191],name);
});

test('서버의 일반 HTTP 500 응답은 포트 충돌로 판단하지 않는다',async()=>{assert.equal(await probeOffice('http://127.0.0.1',async()=>new Response('Internal Server Error',{status:500})),'error');const root=fixture();try{let started=false;await assert.rejects(ensureOffice({root,env,probe:async()=> 'error',start:async()=>{started=true;}}),/서버 내부 오류/);assert.equal(started,false);}finally{rmSync(root,{recursive:true,force:true});}});

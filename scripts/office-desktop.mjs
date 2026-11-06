import {existsSync,mkdirSync,openSync,closeSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {validateOfficeServer} from './office-server-config.mjs';
export function desktopAddress(env){const errors=validateOfficeServer(env);if(errors.length)throw Error(errors.join('\n'));if(env.ERP_COOKIE_SECURE!=='false')throw Error('회사 앱의 HTTP 접속에는 ERP_COOKIE_SECURE=false 설정을 확인하세요.');return `http://${env.ERP_OFFICE_BIND??'127.0.0.1'}:${env.PORT??'3000'}`;}
export async function probeOffice(base,fetcher=fetch){
 let response;try{response=await fetcher(`${base}/api/health`,{redirect:'manual',signal:AbortSignal.timeout(2000),cache:'no-store'});}catch(error){return error?.cause?.code==='ECONNREFUSED'?'closed':'busy';}
 if(response.status>=500&&response.headers.get('x-dongyang-erp')!=='1')return 'error';
 let data;try{data=await response.json();}catch{return 'other';}
 let identified=response.headers.get('x-dongyang-erp')==='1'&&data?.service==='dongyang-erp';
 // Older installed ERP versions have no identifying header. Check the login
 // document as well before reusing their listener; never open an unknown app.
 if(!identified&&['ok','unavailable'].includes(data?.status)){try{const login=await fetcher(`${base}/login`,{redirect:'manual',signal:AbortSignal.timeout(2000),cache:'no-store'});identified=(await login.text()).includes('동양계전 ERP 로그인');}catch{/* Listener could be another application. */}}
 if(!identified)return 'other';return response.ok&&data.status==='ok'?'ready':'unavailable';
}
export function browserCommand(url,env=process.env,present=existsSync){
 const paths=[join(env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),join(env.ProgramFiles??'C:\\Program Files','Microsoft/Edge/Application/msedge.exe'),join(env.ProgramFiles??'C:\\Program Files','Google/Chrome/Application/chrome.exe'),join(env.LOCALAPPDATA??'','Google/Chrome/Application/chrome.exe')];
 const exe=paths.find(present);return exe?{exe,args:[`--app=${url}`,'--new-window']}:{exe:'rundll32.exe',args:['url.dll,FileProtocolHandler',url]};
}
async function launchWindow(url){const command=browserCommand(url);await new Promise((resolve,reject)=>{const child=spawn(command.exe,command.args,{detached:true,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});}
function startServer(root,env){
 const folder=join(root,'logs');mkdirSync(folder,{recursive:true});const log=join(folder,'office-server.log');const fd=openSync(log,'a',0o600);let child;
 try{child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'start','--hostname',env.ERP_OFFICE_BIND??'127.0.0.1','--port',env.PORT??'3000'],{cwd:root,env,detached:true,windowsHide:true,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
 return new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{child.unref();resolve(child.pid);});});
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function ensureOffice({root,env,probe=probeOffice,start=startServer,open=launchWindow,wait=delay,attempts=60}){
 const base=desktopAddress(env),url=`${base}/login`;const initial=await probe(base);
 if(initial==='ready'){await open(url);return{reused:true,url};}
 if(initial==='error')throw Error('ERP 확인 주소에서 서버 내부 오류(500)가 발생했습니다. 다른 프로그램의 포트 사용으로 확인된 것은 아닙니다. logs/office-server.log를 확인하세요.');
 if(initial==='other')throw Error('설정한 포트에서 다른 프로그램이 실행 중입니다. 기존 프로그램을 종료하지 않았습니다. 포트 설정을 확인하세요.');
 if(initial==='unavailable')throw Error('ERP는 실행 중이지만 DB 또는 로그인 설정 확인이 필요합니다. ERP 점검을 실행하세요.');
 if(!existsSync(join(root,'.next/BUILD_ID'))||!existsSync(join(root,'node_modules/next/dist/bin/next')))throw Error('ERP 설치 또는 빌드를 먼저 완료하세요.');
 const logs=join(root,'logs');mkdirSync(logs,{recursive:true});const lock=join(logs,'office-start.lock');let owner=false;
 function claim(){try{const fd=openSync(lock,'wx',0o600);try{writeFileSync(fd,JSON.stringify({pid:process.pid}));}finally{closeSync(fd);}return true;}catch(e){if(e.code!=='EEXIST')throw e;return false;}}
 owner=claim();if(!owner){try{const prior=readFileSync(lock,'utf8'),pid=JSON.parse(prior).pid;if(!Number.isSafeInteger(pid)||pid<=0)throw Error('bad lock');try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'&&readFileSync(lock,'utf8')===prior){unlinkSync(lock);owner=claim();}}}catch{/* An active launch or unknown lock must not be overwritten. */}}
 try{
  if(owner&&initial==='closed'){const pid=await start(root,env);if(Number.isSafeInteger(pid)&&pid>0)writeFileSync(join(logs,'office-server.json'),JSON.stringify({pid,root,executable:process.execPath,port:env.PORT??'3000',host:env.ERP_OFFICE_BIND??'127.0.0.1'}),{mode:0o600});}
  for(let i=0;i<attempts;i++){const state=await probe(base);if(state==='ready'){await open(url);return{reused:!owner,url};}if(state==='error')throw Error('ERP 서버 내부 오류가 발생했습니다. logs/office-server.log를 확인하세요.');if(state==='other')throw Error('시작 중 해당 포트를 다른 프로그램이 사용했습니다. 포트 설정을 확인하세요.');if(state==='unavailable')throw Error('ERP가 시작됐지만 DB 연결을 확인하지 못했습니다. 잠시 후 다시 실행하거나 ERP 점검을 확인하세요.');await wait(1000);}
  throw Error('ERP가 아직 준비되지 않았습니다. logs 폴더의 office-server.log를 확인하고 다시 실행하세요.');
 }finally{if(owner){try{if(JSON.parse(readFileSync(lock,'utf8')).pid===process.pid)unlinkSync(lock);}catch{/* Never remove another launch lock. */}}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
 try{if(process.platform!=='win32')throw Error('ERP 앱 실행기는 회사 Windows PC에서 사용하세요.');process.loadEnvFile('.env.office');await ensureOffice({root,env:process.env});console.log('ERP 화면을 열었습니다.');}catch(error){console.error(error?.message??'ERP 앱을 열지 못했습니다.');process.exitCode=1;}
}

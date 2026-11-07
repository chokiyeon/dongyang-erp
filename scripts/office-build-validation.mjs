import {existsSync,readFileSync,mkdirSync,renameSync,lstatSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
export const requiredOfficeSourceFiles=['src/app/layout.tsx','src/app/login/page.tsx','src/app/api/health/route.ts','src/app/(workspace)/page.tsx'];
export const requiredOfficeRoutes=['/login/page','/api/health/route','/(workspace)/page','/(workspace)/settings/page','/(workspace)/work-records/import/page'];
export function validateOfficeSources(root){
 for(const file of requiredOfficeSourceFiles){
  if(!existsSync(join(root,file)))throw Error(`ERP 화면 원본이 누락됐습니다: ${file}. 설치파일을 확인하세요.`);
 }
 for(const folder of ['app','pages'])if(existsSync(join(root,folder)))throw Error(`설치 폴더의 ${folder} 폴더가 src/app과 충돌할 수 있습니다. 자료를 삭제하지 않고 중단했습니다.`);
}
export function validateOfficeBuild(root){
 let manifest;try{manifest=JSON.parse(readFileSync(join(root,'.next/server/app-paths-manifest.json'),'utf8'));}catch{throw Error('ERP 화면 빌드가 누락됐습니다. 404 페이지만 생성된 빌드는 설치 완료로 처리하지 않습니다.');}
 const missing=requiredOfficeRoutes.filter(route=>!manifest[route]);
 if(missing.length)throw Error(`ERP 필수 화면 빌드가 누락됐습니다: ${missing.join(', ')}. 서버를 시작하지 않았습니다.`);
}

export function validateInstalledPayload(root){
 const file=join(root,'installer-checksums.json');if(!existsSync(file))return;
 const expected=JSON.parse(readFileSync(file,'utf8'));
 for(const [name,hash] of Object.entries(expected)){if(!existsSync(join(root,name))||createHash('sha256').update(readFileSync(join(root,name))).digest('hex')!==hash)throw Error(`설치 파일 누락 또는 손상: ${name}. DB를 변경하지 않고 중단했습니다.`);}
}

// Next.js chooses <root>/app before <root>/src/app. Preserve stale root
// directories outside its discovery paths; do not delete files or touch the DB.
export function preserveOfficeShadowDirectories(root){
 const manifestFile=join(root,'installer-checksums.json');
 if(!existsSync(manifestFile))throw Error('설치 원본 검증 정보가 없어 폴더를 자동 정리하지 않았습니다.');
 const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
 for(const file of requiredOfficeSourceFiles)if(typeof manifest[file]!=='string')throw Error('ERP 화면 원본 검증 정보가 누락돼 폴더를 변경하지 않았습니다.');
 validateInstalledPayload(root);
 const shadows=['app','pages'].filter(name=>lstatSync(join(root,name),{throwIfNoEntry:false}));
 for(const name of shadows){const info=lstatSync(join(root,name));if(info.isSymbolicLink()||!info.isDirectory())throw Error(`설치 폴더의 ${name} 경로를 자동 정리할 수 없습니다. 자료는 보존했습니다.`);}
 if(!shadows.length)return [];
 const backup=join(root,'backups','source-layout',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
 mkdirSync(backup,{recursive:true});
 const moved=[];
 for(const name of shadows){renameSync(join(root,name),join(backup,name));moved.push({name,backup:join(backup,name)});}
 writeFileSync(join(backup,'restore-info.json'),JSON.stringify({reason:'root directory shadowed verified src/app',moved},null,2),{mode:0o600});
 validateOfficeSources(root);
 return moved;
}

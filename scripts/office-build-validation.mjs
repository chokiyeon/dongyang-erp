import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export const requiredOfficeRoutes=['/login/page','/api/health/route','/(workspace)/page','/(workspace)/settings/page','/(workspace)/work-records/import/page'];
export function validateOfficeSources(root){
 for(const file of ['src/app/layout.tsx','src/app/login/page.tsx','src/app/api/health/route.ts','src/app/(workspace)/page.tsx']){
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

import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateOfficeBuild,validateOfficeSources,validateInstalledPayload,requiredOfficeRoutes} from '../scripts/office-build-validation.mjs';
test('404만 생성된 빌드와 일부 누락된 ERP 화면은 설치 성공으로 처리하지 않는다',()=>{
 const root=mkdtempSync(join(tmpdir(),'erp-build-guard-'));
 try{
  assert.throws(()=>validateOfficeSources(root),/원본이 누락/);
  for(const file of ['src/app/layout.tsx','src/app/login/page.tsx','src/app/api/health/route.ts','src/app/(workspace)/page.tsx']){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'synthetic');}
  validateOfficeSources(root);assert.throws(()=>validateOfficeBuild(root),/404/);
  mkdirSync(join(root,'.next/server'),{recursive:true});writeFileSync(join(root,'.next/server/app-paths-manifest.json'),JSON.stringify({'/login/page':'app/login/page.js'}));assert.throws(()=>validateOfficeBuild(root),/필수 화면/);
  writeFileSync(join(root,'.next/server/app-paths-manifest.json'),JSON.stringify(Object.fromEntries(requiredOfficeRoutes.map(route=>[route,'synthetic.js']))));validateOfficeBuild(root);
  mkdirSync(join(root,'app'));assert.throws(()=>validateOfficeSources(root),/충돌/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('설치 압축 해제 파일 누락과 변경은 DB 작업 전 검출한다',()=>{
 const root=mkdtempSync(join(tmpdir(),'erp-payload-guard-'));
 try{writeFileSync(join(root,'sample.ts'),'expected');writeFileSync(join(root,'installer-checksums.json'),JSON.stringify({'sample.ts':createHash('sha256').update('expected').digest('hex')}));validateInstalledPayload(root);writeFileSync(join(root,'sample.ts'),'changed');assert.throws(()=>validateInstalledPayload(root),/손상/);rmSync(join(root,'sample.ts'));assert.throws(()=>validateInstalledPayload(root),/누락/);}finally{rmSync(root,{recursive:true,force:true});}
});

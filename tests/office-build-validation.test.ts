import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateOfficeBuild,validateOfficeSources,validateInstalledPayload,requiredOfficeRoutes,preserveOfficeShadowDirectories,requiredOfficeSourceFiles} from '../scripts/office-build-validation.mjs';
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

function sourceFixture(){
 const root=mkdtempSync(join(tmpdir(),'erp-shadow-'));
 const hashes:Record<string,string>={};
 for(const file of requiredOfficeSourceFiles){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'verified-source');hashes[file]=createHash('sha256').update('verified-source').digest('hex');}
 writeFileSync(join(root,'installer-checksums.json'),JSON.stringify(hashes));
 return root;
}
test('Next의 app 우선 검색 충돌 폴더를 백업해 보존하고 정상 소스는 유지한다',()=>{
 const root=sourceFixture();try{
  mkdirSync(join(root,'app'));mkdirSync(join(root,'pages'));writeFileSync(join(root,'app','user-notes.txt'),'must preserve');writeFileSync(join(root,'.env.office'),'private settings unchanged');
  assert.throws(()=>validateOfficeSources(root),/충돌/);const moved=preserveOfficeShadowDirectories(root);assert.equal(moved.length,2);assert.equal(existsSync(join(root,'app')),false);assert.equal(existsSync(join(root,'pages')),false);assert.equal(readFileSync(join(moved[0].backup,'user-notes.txt'),'utf8'),'must preserve');assert.equal(readFileSync(join(root,'.env.office'),'utf8'),'private settings unchanged');validateOfficeSources(root);assert.deepEqual(preserveOfficeShadowDirectories(root),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('원본 검증 실패·불완전한 매니페스트·심볼릭 링크는 이동하지 않는다',()=>{
 for(const mode of ['corrupt','missing-manifest','incomplete','link']){
  const root=sourceFixture();try{
   if(mode==='link')symlinkSync(join(root,'src/app'),join(root,'app'),'dir');else mkdirSync(join(root,'app'));
   if(mode==='corrupt')writeFileSync(join(root,requiredOfficeSourceFiles[0]),'corrupt');
   if(mode==='missing-manifest')rmSync(join(root,'installer-checksums.json'));
   if(mode==='incomplete')writeFileSync(join(root,'installer-checksums.json'),'{}');
   assert.throws(()=>preserveOfficeShadowDirectories(root));assert.equal(existsSync(join(root,'app')),true);assert.equal(existsSync(join(root,'backups')),false);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});

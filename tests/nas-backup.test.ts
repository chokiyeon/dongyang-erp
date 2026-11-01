import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,mkdir,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {runNasBackup,readNasBackupStatus} from "../src/lib/nas-backup";
test("NAS 백업은 로컬 완성본을 검증 복사하고 원래 공유 자료·이전 백업을 보존한다",async()=>{
 const temp=await mkdtemp(join(tmpdir(),"erp-nas-test-")),root=join(temp,"app"),nasRoot=join(temp,"nas");const bytes=Buffer.from("PGDMP synthetic backup with attachment bytes");
 try{await mkdir(nasRoot);await writeFile(join(nasRoot,"기존 회사 장부.xlsx"),"보존");await mkdir(join(nasRoot,"Dongyang-ERP-Backups"));await writeFile(join(nasRoot,"Dongyang-ERP-Backups","older.dump"),"previous");const result=await runNasBackup({root,nasRoot,createDump:async file=>{await writeFile(file,bytes);}});assert.equal(result.state,"SUCCESS");assert.equal(result.sha256,createHash("sha256").update(bytes).digest("hex"));assert.deepEqual(await readFile(join(nasRoot,"Dongyang-ERP-Backups",result.fileName!)),bytes);assert.deepEqual(await readFile(join(root,"backups","office",result.fileName!)),bytes);assert.equal(await readFile(join(nasRoot,"기존 회사 장부.xlsx"),"utf8"),"보존");assert.equal(await readFile(join(nasRoot,"Dongyang-ERP-Backups","older.dump"),"utf8"),"previous");assert.equal((await readNasBackupStatus(root))?.state,"SUCCESS");assert.ok((await readdir(join(nasRoot,"Dongyang-ERP-Backups"))).includes(`${result.fileName}.sha256`));}finally{await rm(temp,{recursive:true,force:true});}
});
test("NAS 연결 실패 시 로컬 백업을 남기고 동시에 같은 백업을 실행하지 않는다",async()=>{
 const temp=await mkdtemp(join(tmpdir(),"erp-nas-test-")),root=join(temp,"app"),nasRoot=join(temp,"blocked");let local="";
 try{await writeFile(nasRoot,"원래 파일");await assert.rejects(runNasBackup({root,nasRoot,createDump:async file=>{local=file;await writeFile(file,"PGDMP retained local dump");}}),/NAS/);assert.match(await readFile(local,"utf8"),/^PGDMP/);assert.equal(await readFile(nasRoot,"utf8"),"원래 파일");assert.equal((await readNasBackupStatus(root))?.state,"FAILED");
  const share=join(temp,"share");let begin!:()=>void,release!:()=>void;const started=new Promise<void>(r=>begin=r),gate=new Promise<void>(r=>release=r);const first=runNasBackup({root,nasRoot:share,createDump:async file=>{begin();await gate;await writeFile(file,"PGDMP complete");}});await started;assert.equal((await readNasBackupStatus(root))?.state,"RUNNING");await assert.rejects(runNasBackup({root,nasRoot:share}),/실행 중/);release();assert.equal((await first).state,"SUCCESS");
 }finally{await rm(temp,{recursive:true,force:true});}
});
test("완성되지 않은 덤프는 NAS에 성공 백업으로 보관하지 않는다",async()=>{
 const temp=await mkdtemp(join(tmpdir(),"erp-nas-test-"));try{await assert.rejects(runNasBackup({root:join(temp,"app"),nasRoot:join(temp,"nas"),createDump:async file=>{await writeFile(file,"partial");}}),/PostgreSQL 백업/);assert.equal((await readNasBackupStatus(join(temp,"app")))?.state,"FAILED");}finally{await rm(temp,{recursive:true,force:true});}
});

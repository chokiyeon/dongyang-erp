import {createHash,randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {mkdir,open,readFile,rename,unlink,stat,writeFile} from "node:fs/promises";
import {isAbsolute,join,resolve} from "node:path";
import {pipeline} from "node:stream/promises";
import {spawn} from "node:child_process";
import {InputError} from "./validation";
export type NasBackupStatus={state:"SUCCESS"|"FAILED"|"RUNNING";attemptAt:string;lastSuccessAt?:string;fileName?:string;size?:number;sha256?:string;message:string};
const statusPath=(root:string)=>join(root,"backups","office-backup-status.json");
export async function readNasBackupStatus(root=process.cwd()):Promise<NasBackupStatus|null>{try{const value=JSON.parse(await readFile(statusPath(root),"utf8"));if(!["SUCCESS","FAILED","RUNNING"].includes(value.state)||typeof value.message!=="string")return null;return value;}catch{return null;}}
async function saveStatus(root:string,status:NasBackupStatus){const path=statusPath(root),temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(status,null,2),{flag:"wx",mode:0o600});await rename(temp,path);}
async function hashFile(path:string){const hash=createHash("sha256");for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest("hex");}
async function dumpDatabase(root:string,file:string,env:NodeJS.ProcessEnv){await new Promise<void>((done,fail)=>{const child=spawn(process.execPath,["--env-file-if-exists=.env",join(root,"scripts","database-transfer.mjs"),"backup",file],{cwd:root,env,stdio:"ignore"});child.on("error",()=>fail(new InputError("로컬 DB 백업을 실행하지 못했습니다. PostgreSQL 17 백업 도구와 접속 설정을 확인하세요.")));child.on("exit",code=>code===0?done():fail(new InputError("로컬 DB 백업에 실패했습니다. PostgreSQL 17 백업 도구와 접속 설정을 확인하세요.")));});}
export async function runNasBackup(options:{root?:string;nasRoot?:string;env?:NodeJS.ProcessEnv;createDump?:(file:string)=>Promise<void>}={}){
 const root=resolve(options.root??process.cwd()),env=options.env??process.env,nasRoot=options.nasRoot??env.ERP_NAS_BACKUP_DIR;if(!nasRoot||!isAbsolute(nasRoot))throw new InputError("메인 PC에서 사용할 NAS 백업 폴더 경로를 먼저 설정하세요.");
 const local=join(root,"backups","office");await mkdir(local,{recursive:true,mode:0o700});const lockPath=join(root,"backups",".nas-backup.lock");let lock;
 try{lock=await open(lockPath,"wx",0o600);}catch{throw new InputError("NAS 백업이 실행 중이거나 이전 실행 잠금이 남아 있습니다. 실행 상태를 먼저 확인하세요.");}
 const started=new Date().toISOString(),name=`dongyang-${started.replace(/[:.]/g,"-")}-${randomUUID()}.dump`,file=join(local,name);const previous=await readNasBackupStatus(root);let destination="",createdDestination=false;let success:NasBackupStatus|undefined;
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,started}));await lock.close();await saveStatus(root,{state:"RUNNING",attemptAt:started,lastSuccessAt:previous?.lastSuccessAt,message:"로컬 DB 백업 후 NAS에 검증 복사하고 있습니다."});
  await(options.createDump?options.createDump(file):dumpDatabase(root,file,env));
  const source=await open(file,"r");let header;try{const buffer=Buffer.alloc(5);await source.read(buffer,0,5,0);header=buffer.toString("ascii");}finally{await source.close();}const info=await stat(file);if(header!=="PGDMP"||info.size<=5)throw new InputError("완료된 PostgreSQL 백업 파일인지 확인하지 못했습니다. 로컬 파일과 백업 도구를 확인하세요.");
  const folder=join(resolve(nasRoot),"Dongyang-ERP-Backups");await mkdir(folder,{recursive:true,mode:0o700});destination=join(folder,name);const target=await open(destination,"wx",0o600);createdDestination=true;
  await pipeline(createReadStream(file),target.createWriteStream());const sourceHash=await hashFile(file),targetHash=await hashFile(destination);if(sourceHash!==targetHash||(await stat(destination)).size!==info.size)throw new InputError("NAS 복사 검증에 실패했습니다. 로컬 백업은 보관했습니다.");
  await writeFile(`${destination}.sha256`,`${targetHash}  ${name}\n`,{flag:"wx",mode:0o600});success={state:"SUCCESS",attemptAt:started,lastSuccessAt:new Date().toISOString(),fileName:name,size:info.size,sha256:targetHash,message:"NAS 백업과 파일 검증을 완료했습니다. 로컬 백업도 보관했습니다."};await saveStatus(root,success);return success;
 }catch(error){
  if(createdDestination&&destination&&!success)await unlink(destination).catch(()=>{});
  const message=error instanceof InputError?error.message:"NAS 백업에 실패했습니다. 로컬 백업과 NAS 연결·쓰기 권한을 확인하세요.";await saveStatus(root,{state:"FAILED",attemptAt:started,lastSuccessAt:previous?.lastSuccessAt,message}).catch(()=>{});throw new InputError(message);
 }finally{await lock.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}
}

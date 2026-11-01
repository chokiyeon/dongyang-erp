import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {validateOfficeServer} from "./office-server-config.mjs";
const errors=validateOfficeServer(process.env);if(errors.length){errors.forEach(e=>console.error(e));process.exit(1);}
if(!existsSync(".next/BUILD_ID")){console.error("ERP 실행 빌드가 없습니다. 설치 안내에 따라 빌드를 준비하세요.");process.exit(1);}
const host=process.env.ERP_OFFICE_BIND??"127.0.0.1",port=process.env.PORT??"3000";
const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname",host,"--port",port],{stdio:"inherit",env:process.env});
for(const signal of["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("error",()=>{console.error("사내 ERP를 실행하지 못했습니다. 설치 상태와 포트를 확인하세요.");process.exitCode=1;});child.on("exit",code=>{process.exitCode=code??1;});

import "dotenv/config";
import {Client} from "pg";
import {randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
if(!process.env.DATABASE_URL)throw Error("DATABASE_URL is required");
const scenario=process.argv[2]??"budget-layout";if(!["budget-layout","period-review"].includes(scenario))throw Error("Unsupported isolated scenario");
const database=`erp_preview_${Date.now()}_${randomBytes(4).toString("hex")}`;
if(!/^erp_preview_\d+_[a-f0-9]{8}$/.test(database))throw Error("Invalid temporary database name");
const base=new URL(process.env.DATABASE_URL),target=new URL(base);target.pathname=`/${database}`;
const client=new Client({connectionString:base.toString()});let created=false;
const run=(command,args)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:"inherit",env:{...process.env,DATABASE_URL:target.toString()}});child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(Error(`Isolated check exited with code ${code}`)));});
try{await client.connect();await client.query(`CREATE DATABASE "${database}"`);created=true;await run("npx",["prisma","migrate","deploy"]);await run("npx",["playwright","test",`tests/browser/${scenario}.spec.ts`]);}finally{if(created)await client.query(`DROP DATABASE "${database}" WITH (FORCE)`);await client.end();}

import {createHash} from "node:crypto";
import type {Prisma} from "@/generated/prisma/client";
import {COMPANY_ID} from "./constants";
import {InputError,text,revision} from "./validation";
import {paymentMonth} from "./payment-terms";
import {saveLabor} from "./labor";
import {laborUnits} from "./labor-types";
export async function saveWorkBatch(tx:Prisma.TransactionClient,data:FormData){
 const requestId=text(data,"requestId","요청",true,50);if(!/^[a-f0-9-]{36}$/i.test(requestId))throw new InputError("화면을 다시 열어 주세요.");
 const employeeId=text(data,"employeeId","직원",true,50);const projectId=text(data,"projectId","현장",true,50);const period=text(data,"period","작업월",true,7);paymentMonth(period);
 const role=text(data,"role","작업 구분",true);if(!["NORMAL","SIGNAL"].includes(role))throw new InputError("작업 구분을 확인하세요.");
 const reason=text(data,"reason","등록 사유",true,300);const source=text(data,"source","원본 메모",true,200);const version=revision(data);
 const fingerprint=createHash("sha256").update(JSON.stringify({operation:"workBatch",values:[...data.entries()].filter(([k])=>!k.startsWith("$ACTION_")).sort(([a],[b])=>a.localeCompare(b))})).digest("hex");
 const replay=await tx.laborChange.findUnique({where:{requestId},include:{employee:true}});if(replay){if(replay.employee.companyId!==COMPANY_ID||replay.operation!=="workBatch"||replay.fingerprint!==fingerprint)throw new InputError("다른 내용에 사용한 요청입니다. 화면을 다시 열어 주세요.");return;}
 const employee=await tx.employee.findFirst({where:{id:employeeId,companyId:COMPANY_ID,active:true,kind:"DAILY"}});if(!employee)throw new InputError("사용 중인 일용직 직원을 선택하세요.");
 const last=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).getUTCDate();const days:{workedDate:string;units:string}[]=[];
 for(const[key]of data.entries())if(key.startsWith("day_")&&(!/^day_\d{2}$/.test(key)||Number(key.slice(4))<1||Number(key.slice(4))>last))throw new InputError("해당 월에 없는 날짜가 포함되어 있습니다.");
 for(let day=1;day<=last;day++){const key=`day_${String(day).padStart(2,"0")}`;if(data.getAll(key).length>1)throw new InputError("같은 날짜가 중복 입력되었습니다.");const units=text(data,key,`${day}일 공수`,false,5);if(!units||/^(0|0\.0{1,2})$/.test(units))continue;laborUnits(units);days.push({workedDate:`${period}-${String(day).padStart(2,"0")}`,units});}
 if(!days.length)throw new InputError("등록할 날짜의 공수를 입력하세요.");
 const locked=await tx.employee.updateMany({where:{id:employeeId,companyId:COMPANY_ID,version},data:{version:{increment:1}}});if(locked.count!==1)throw new InputError("직원·계약·출역이 변경되었습니다. 새로 조회하세요.");
 const ids:string[]=[];
 for(const day of days){const hash=createHash("sha256").update(`${requestId}:${day.workedDate}`).digest("hex").slice(0,32);const childId=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;const input=new FormData();Object.entries({employeeId,projectId,role,...day,requestId:childId,reason,source}).forEach(([key,v])=>input.set(key,v));ids.push(await saveLabor(tx,"work",input));}
 await tx.laborChange.create({data:{employeeId,requestId,fingerprint,operation:"workBatch",previous:{},next:{id:employeeId,period,workIds:ids},reason}});
}

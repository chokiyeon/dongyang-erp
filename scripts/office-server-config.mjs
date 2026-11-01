export function privateOfficeAddress(address){
 if(address==="127.0.0.1")return true;
 if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(address))return false;
 const parts=address.split(".").map(Number);if(parts.some(n=>n>255))return false;
 return parts[0]===10||(parts[0]===192&&parts[1]===168)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31);
}
export function validateOfficeServer(env){
 const errors=[];if(env.ERP_OFFICE_MODE!=="true")errors.push("사내 PC 실행 모드 ERP_OFFICE_MODE=true를 확인하세요.");
 if(!privateOfficeAddress(env.ERP_OFFICE_BIND??"127.0.0.1"))errors.push("접속 주소는 이 PC의 사내 IPv4 주소 또는 127.0.0.1로 설정하세요. 전체 인터페이스·공인 주소는 사내 모드에서 허용하지 않습니다.");
 if(!/^\d{1,5}$/.test(env.PORT??"3000")||Number(env.PORT??3000)<1||Number(env.PORT??3000)>65535)errors.push("ERP 포트 범위를 확인하세요.");
 const password=env.ERP_ADMIN_PASSWORD??"",secret=env.ERP_SESSION_SECRET??"";
 if(password.length<16||password.length>1024||/^(REPLACE|local-development-only|password|12345678)/i.test(password))errors.push("사내 운영용 관리자 비밀번호를 16자 이상으로 별도 설정하세요.");
 if(secret.length<32||/^REPLACE/i.test(secret)||secret===password)errors.push("비밀번호와 다른 32자 이상 세션 키를 설정하세요.");
 if(!["true","false"].includes(env.ERP_COOKIE_SECURE??""))errors.push("사내 접속 방식에 맞는 쿠키 설정을 명시하세요. HTTP는 false, HTTPS는 true입니다.");
 try{const url=new URL(env.DATABASE_URL??"");if(!["postgres:","postgresql:"].includes(url.protocol)||!url.username||!url.password||!url.pathname.slice(1)||(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)&&!privateOfficeAddress(url.hostname))||/^(REPLACE|local-development-only)/i.test(decodeURIComponent(url.password)))throw Error();}catch{errors.push("메인 PC 또는 사내 DB의 DATABASE_URL과 별도 DB 비밀번호를 확인하세요.");}
 return errors;
}

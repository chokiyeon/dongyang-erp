/** Private-LAN HTTP does not expose all secure-context Web Crypto methods. */
export async function browserSha256(bytes:ArrayBuffer|Uint8Array,cryptoApi:Crypto|undefined=globalThis.crypto){
 const data=new Uint8Array(bytes instanceof Uint8Array?bytes:new Uint8Array(bytes));
 if(typeof cryptoApi?.subtle?.digest==="function")return hex(new Uint8Array(await cryptoApi.subtle.digest("SHA-256",data)));
 const {sha256}=await import("@noble/hashes/sha2.js");return hex(sha256(data));
}
function hex(bytes:Uint8Array){return Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");}
export function browserRequestId(cryptoApi:Crypto|undefined=globalThis.crypto){
 if(typeof cryptoApi?.randomUUID==="function")return cryptoApi.randomUUID();
 if(typeof cryptoApi?.getRandomValues!=="function")throw new Error("안전한 요청번호를 생성할 수 없습니다. 최신 Edge 또는 Chrome으로 다시 열어 주세요.");
 const bytes=new Uint8Array(16);cryptoApi.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const value=hex(bytes);return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}

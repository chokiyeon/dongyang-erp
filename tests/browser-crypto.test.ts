import test from "node:test";
import assert from "node:assert/strict";
import {createHash,webcrypto} from "node:crypto";
import {browserSha256,browserRequestId} from "../src/lib/browser-crypto";
test("사내 HTTP용 파일 검증값은 보안 컨텍스트와 같고 바이트 오프셋을 보존한다",async()=>{
 const fallback={} as Crypto,native=webcrypto as unknown as Crypto;
 for(const value of["","abc","동양 ERP 원본 파일 검증"]){const bytes=new TextEncoder().encode(value),expected=createHash("sha256").update(bytes).digest("hex");assert.equal(await browserSha256(bytes,fallback),expected);assert.equal(await browserSha256(bytes,native),expected);}
 const buffer=new Uint8Array([0,255,1,2,3,128,0]),slice=buffer.subarray(1,6);assert.equal(await browserSha256(slice,fallback),createHash("sha256").update(slice).digest("hex"));
});
test("사내 HTTP 요청번호는 안전한 난수로 UUID v4를 만들고 난수가 없으면 중단한다",()=>{
 const fallback={getRandomValues:(bytes:Uint8Array)=>webcrypto.getRandomValues(bytes)} as unknown as Crypto;const ids=new Set(Array.from({length:300},()=>browserRequestId(fallback)));assert.equal(ids.size,300);for(const id of ids)assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.throws(()=>browserRequestId({} as Crypto),/안전한 요청번호/);assert.match(browserRequestId(webcrypto as unknown as Crypto),/^[a-f0-9-]{36}$/);
});

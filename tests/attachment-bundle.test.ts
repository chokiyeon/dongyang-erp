import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {storedZip,attachmentParts} from "../src/lib/attachment-bundle";
test("표준 ZIP으로 한글 원본 바이트를 보존하고 크기·경로·분할을 검증한다",()=>{
 const zip=storedZip([{name:"원본/합성 계약서.pdf",data:Buffer.from("%PDF-1.4\nsynthetic\n%%EOF")},{name:"안내.txt",data:Buffer.from("합성 검증 자료")}]);const result=spawnSync("python3",["-c","import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(json.dumps({n:z.read(n).decode('utf-8') for n in z.namelist()},ensure_ascii=False))"],{input:zip,encoding:"utf8"});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{"원본/합성 계약서.pdf":"%PDF-1.4\nsynthetic\n%%EOF","안내.txt":"합성 검증 자료"});assert.throws(()=>storedZip([{name:"../escape.pdf",data:Buffer.from("x")}]),/경로/);const files=[0,1,2,3].map(i=>({id:String(i),fileName:`${i}.pdf`,checksum:"synthetic",size:10*1024*1024}));assert.deepEqual(attachmentParts(files).map(p=>p.length),[3,1]);
});

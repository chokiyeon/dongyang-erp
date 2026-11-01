import test from "node:test";
import assert from "node:assert/strict";
import {privateOfficeAddress,validateOfficeServer} from "../scripts/office-server-config.mjs";
test("회사 PC 모드는 사내 주소·로컬 DB를 허용하되 공인/전체 접속과 미설정 접근 정보를 거부한다",()=>{
 for(const ip of["127.0.0.1","10.0.0.10","192.168.0.50","172.16.1.2","172.31.255.1"])assert.ok(privateOfficeAddress(ip));for(const ip of["0.0.0.0","8.8.8.8","172.32.0.1","192.168.1.999","localhost","192.168.0.1;whoami"])assert.equal(privateOfficeAddress(ip),false);
 const valid={ERP_OFFICE_MODE:"true",ERP_OFFICE_BIND:"192.168.0.50",PORT:"3000",DATABASE_URL:"postgresql://erp:test-only-private-db-password@127.0.0.1/erp",ERP_ADMIN_PASSWORD:"test-only-private-admin",ERP_SESSION_SECRET:"test-only-session-secret-more-than-32",ERP_COOKIE_SECURE:"false"};assert.deepEqual(validateOfficeServer(valid),[]);
 assert.ok(validateOfficeServer({...valid,ERP_OFFICE_BIND:"0.0.0.0"}).length);assert.ok(validateOfficeServer({...valid,DATABASE_URL:"postgresql://erp:test-only-secret@8.8.8.8/erp"}).length);assert.ok(validateOfficeServer({...valid,ERP_ADMIN_PASSWORD:"REPLACE_WITH_PRIVATE_PASSWORD"}).length);assert.ok(!validateOfficeServer({...valid,DATABASE_URL:"not a URL"}).join(" ").includes("test-only-private-db-password"));
});

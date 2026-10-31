import {test} from "node:test";
import assert from "node:assert/strict";
import {statementBasis,maskPayeeAccount} from "../src/lib/payroll-statement";
import {MONTHLY_PAY_FIELDS} from "../src/lib/monthly-payroll-details";
const line={id:"work1",date:"2026-10-01T00:00:00.000Z",project:"site1",role:"NORMAL",units:"0.50",rateAmount:"200000",amount:"100000"};
test("개별 명세서는 저장된 일용직 공수만 사용하고 중복·금액 오류·다른 직원 자료를 표시하지 않는다",()=>{
 const snapshot={employee:{id:"worker",kind:"DAILY"},period:"2026-10",lines:[line]};const result=statementBasis(snapshot,"worker","2026-10","100000");assert.equal(result.lines[0].rate,"200000");assert.equal(result.calculatedDaily,100000n);assert.deepEqual(result.issues,[]);
 assert.equal(statementBasis(snapshot,"other","2026-10","100000").lines.length,0);assert.equal(statementBasis(snapshot,"worker","2026-09","100000").lines.length,0);
 for(const lines of [[line,line],[{...line,amount:"99999"}],[{...line,date:"2026-10-32T00:00:00.000Z"}]]){const invalid=statementBasis({...snapshot,lines},"worker","2026-10","100000");assert.equal(invalid.lines.length,0);assert.ok(invalid.issues.length);}
});
test("상용직 명세서는 저장 공제와 지급액을 대조하고 계좌번호를 일부만 표시한다",()=>{
 const amounts={...Object.fromEntries(MONTHLY_PAY_FIELDS.map(([key])=>[key,"0"])),basic:"3000000",incomeTax:"100000"};const snapshot={employee:{id:"worker",kind:"MONTHLY"},period:"2026-10",monthlyDetails:{version:1,amounts}};
 assert.equal(statementBasis(snapshot,"worker","2026-10","2900000").monthly?.net,2900000n);assert.ok(statementBasis(snapshot,"worker","2026-10","3000000").issues.length);assert.equal(statementBasis(snapshot,"other","2026-10","2900000").monthly,null);assert.ok(statementBasis({...snapshot,monthlyDetails:undefined},"worker","2026-10","2900000").issues.length);
 assert.equal(maskPayeeAccount("001-123-456789"),"****6789");assert.equal(maskPayeeAccount("123"),"****");assert.equal(maskPayeeAccount(null),"미등록");
});

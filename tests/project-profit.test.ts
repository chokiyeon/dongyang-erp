import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db";
import { COMPANY_ID } from "../src/lib/constants";
import { summarizeProjectProfit, type ProfitProject, type ProfitDocument } from "../src/lib/project-profit-summary";
import { saveProjectProfit, profitSources } from "../src/lib/project-profit";
const money=(v:string)=>({toFixed:()=>v});
const form=(values:Record<string,string>)=>{const f=new FormData();Object.entries(values).forEach(([k,v])=>f.set(k,v));return f;};
test("공사 손익은 미지급 원가를 포함하고 부가세·원가 재검토·20자리 금액을 구분한다",()=>{
  const project:ProfitProject={contractAmount:money("2000"),remainingMaterial:money("300"),remainingLabor:money("100"),remainingOther:money("0"),remainingOverhead:money("50"),profitReviewedAt:new Date(),profitBasis:null};
  const doc:ProfitDocument={id:"d",reference:"P-1",supplyAmount:money("1000"),taxAmount:money("100"),inputVatReview:"DEDUCTIBLE",proofConfirmed:true,profitCategory:"MATERIAL",settledAmount:money("0"),grossAmount:money("1100")};
  const labor={id:"c",reference:"L-1",title:"발생 인건비",category:"LABOR" as const,amount:money("400"),incurredDate:new Date("2026-10-01")};
  let s=summarizeProjectProfit(project,[doc],[labor]);assert.equal(s.expectedProfit,null);assert.equal(s.unpaid,1100n);
  project.profitBasis=s.basis;s=summarizeProjectProfit(project,[doc],[labor]);assert.equal(s.expectedProfit,150n);assert.equal(s.expectedCost,1850n);assert.equal(s.margin,"7.5%");
  const paid={...doc,settledAmount:money("1100")};s=summarizeProjectProfit(project,[paid],[labor]);assert.equal(s.expectedProfit,150n);assert.equal(s.unpaid,0n);
  const nondeductible={...doc,inputVatReview:"NONDEDUCTIBLE"};s=summarizeProjectProfit(project,[nondeductible],[labor]);assert.equal(s.reviewed,false);project.profitBasis=s.basis;s=summarizeProjectProfit(project,[nondeductible],[labor]);assert.equal(s.expectedProfit,50n);
  const pending={...doc,inputVatReview:"PENDING",profitCategory:null};s=summarizeProjectProfit(project,[pending],[labor]);assert.equal(s.issues.length,2);assert.equal(s.expectedProfit,null);
  const loss={...project,contractAmount:money("1000")};loss.profitBasis=summarizeProjectProfit(loss,[doc],[labor]).basis;s=summarizeProjectProfit(loss,[doc],[labor]);assert.equal(s.expectedProfit,-850n);assert.equal(s.margin,"-85.0%");
  const huge={...project,contractAmount:money("99999999999999999999"),remainingMaterial:money("0"),remainingLabor:money("0"),remainingOverhead:money("0")};huge.profitBasis=summarizeProjectProfit(huge,[],[]).basis;assert.equal(summarizeProjectProfit(huge,[],[]).expectedProfit,99999999999999999999n);
});
test("발생원가와 준공 전망은 회사 범위·재요청·수정 충돌·검토 이력과 원본 보존을 검증한다",async()=>{
 const db=getDb();const rollback=new Error("ROLLBACK");
 try{await assert.rejects(db.$transaction(async tx=>{
  await tx.company.upsert({where:{id:COMPANY_ID},create:{id:COMPANY_ID,name:"검증 회사"},update:{}});
  const project=await tx.project.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"손익 검증",contractAmount:"2000"}});
  const partner=await tx.partner.create({data:{companyId:COMPANY_ID,code:randomUUID(),name:"원가 검증 매입처",type:"SUPPLIER"}});
  const document=await tx.tradeDocument.create({data:{companyId:COMPANY_ID,projectId:project.id,partnerId:partner.id,kind:"PURCHASE",reference:randomUUID(),title:"미지급 자재",issuedDate:new Date("2026-10-01"),supplyAmount:"1000",taxAmount:"100",grossAmount:"1100",evidence:"TAX_INVOICE",taxKind:"TAXABLE",proofConfirmed:true,inputVatReview:"DEDUCTIBLE",profitCategory:"MATERIAL",note:""}});
  const cost=form({projectId:project.id,version:"0",requestId:randomUUID(),reason:"발생 노무비 확인",reference:"L-1",title:"지급 전 노무비",category:"LABOR",incurredDate:"2026-10-01",amount:"400"});
  await saveProjectProfit(tx,cost,"cost");await saveProjectProfit(tx,cost,"cost");assert.equal(await tx.projectCostEntry.count({where:{projectId:project.id}}),1);
  cost.set("requestId",randomUUID());await assert.rejects(saveProjectProfit(tx,cost,"cost"),/다른 화면/);
  const forecast=form({projectId:project.id,version:"1",requestId:randomUUID(),reason:"잔여 공사비 확인",remainingMaterial:"300",remainingLabor:"100",remainingOther:"0",remainingOverhead:"50",unapprovedAdditional:"9999",confirmed:"on"});
  await saveProjectProfit(tx,forecast,"estimate");await saveProjectProfit(tx,forecast,"estimate");
  let saved=await tx.project.findUniqueOrThrow({where:{id:project.id}});let sources=await profitSources(tx,project.id);assert.equal(summarizeProjectProfit(saved,sources.documents,sources.entries).expectedProfit,150n);assert.equal(saved.contractAmount?.toFixed(0),"2000");assert.equal(saved.version,0);
  assert.equal((await tx.tradeDocument.findUniqueOrThrow({where:{id:document.id}})).settledAmount.toFixed(0),"0");
  const extra=await tx.projectCostEntry.findFirstOrThrow({where:{projectId:project.id}});
  cost.set("version","2");cost.set("costId",extra.id);cost.set("amount","800");await saveProjectProfit(tx,cost,"cost");
  saved=await tx.project.findUniqueOrThrow({where:{id:project.id}});sources=await profitSources(tx,project.id);assert.equal(summarizeProjectProfit(saved,sources.documents,sources.entries).expectedProfit,null);
  forecast.set("requestId",randomUUID());forecast.set("version","3");await saveProjectProfit(tx,forecast,"estimate");saved=await tx.project.findUniqueOrThrow({where:{id:project.id}});assert.equal(summarizeProjectProfit(saved,sources.documents,sources.entries).expectedProfit,-250n);
  const undo=form({projectId:project.id,version:"4",costId:extra.id,requestId:randomUUID(),reason:"중복 발생원가 취소"});await saveProjectProfit(tx,undo,"void");await saveProjectProfit(tx,undo,"void");
  assert.ok((await tx.projectCostEntry.findUniqueOrThrow({where:{id:extra.id}})).voidedAt);
  forecast.set("version","5");forecast.set("requestId",randomUUID());forecast.set("remainingOther","");await assert.rejects(saveProjectProfit(tx,forecast,"estimate"),/네 항목/);
  forecast.set("remainingOther","0");forecast.set("projectId","foreign-project");await assert.rejects(saveProjectProfit(tx,forecast,"estimate"),/회사 현장/);
  assert.equal(await tx.projectProfitChange.count({where:{projectId:project.id}}),5);throw rollback;
 },{timeout:15000}),(e:unknown)=>e===rollback);}finally{await db.$disconnect();}
});

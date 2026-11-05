import {normalizeBusinessNumber} from "./business-number";
import {assertNoCancellationApproval} from "./trade-approval-guard";
import {normalizeTaxApproval} from "./trade-identifiers";
import {invalidateSourceCosts} from "./source-cost-invalidation";
import {assertBankNotVehicleMatched} from "./vehicle-cash";
import {acquirePeriodReviewLock,assertPeriodsOpen} from "./period-guard";
import {refreshTradeCashPlan} from "./trade-cash";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { koreanToday } from "./forecast";
import { InputError, text, revision, date, choice, amount } from "./validation";
import { paymentDue, PAYMENT_TERMS, PAYMENT_METHODS } from "./payment-terms";
import { PROJECT_COST_CATEGORIES } from "./project-profit-types";
import { TRADE_KINDS, TAX_KINDS, TRADE_EVIDENCE, INPUT_VAT_REVIEWS } from "./trade-types";
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function request(data: FormData) { const value = text(data, "requestId", "요청", true, 50); if (!/^[0-9a-f-]{36}$/i.test(value)) throw new InputError("화면을 다시 열어 주세요."); return value; }
const requiredAmount = (data: FormData, name: string, label: string) => amount(text(data, name, label, true, 20), label)!;
export async function saveTradeDocument(tx: Prisma.TransactionClient, data: FormData) {
  const id = text(data, "id", "문서", false, 50); const version = revision(data); const requestId = request(data);
  const reason = text(data, "reason", "등록·수정 사유", true, 300);
  const kind = choice(text(data, "kind", "구분", true), Object.keys(TRADE_KINDS) as (keyof typeof TRADE_KINDS)[], "구분");
  const reference = text(data, "reference", "관리번호", true, 50); const title = text(data, "title", "거래내용", true, 200);
  const partnerId = text(data, "partnerId", "거래처", true, 50); const projectId = text(data, "projectId", "현장", false, 50) || null;
  const issuedDate = date(text(data, "issuedDate", "증빙·청구일", true), "증빙·청구일")!;
  let dueDate = date(text(data, "dueDate", "수금·지급 기한"), "수금·지급 기한");
  if (issuedDate.toISOString().slice(0,10) > koreanToday()) throw new InputError("증빙·청구일은 오늘 이후일 수 없습니다.");
  const supplyAmount = requiredAmount(data, "supplyAmount", "공급가액"); const taxAmount = requiredAmount(data, "taxAmount", "부가세");
  const gross = BigInt(supplyAmount) + BigInt(taxAmount);
  if (gross <= 0n || gross > 99999999999999999999n) throw new InputError("합계금액은 0보다 큰 20자리 이하 금액이어야 합니다.");
  const taxKind = choice(text(data, "taxKind", "과세 구분", true), Object.keys(TAX_KINDS) as (keyof typeof TAX_KINDS)[], "과세 구분");
  if (taxKind !== "TAXABLE" && taxAmount !== "0") throw new InputError("영세율·면세 거래의 부가세는 0원이어야 합니다.");
  if (BigInt(taxAmount) > BigInt(supplyAmount)) throw new InputError("부가세가 공급가액보다 큽니다. 증빙을 확인해 주세요.");
  const evidence = choice(text(data, "evidence", "증빙 종류", true), Object.keys(TRADE_EVIDENCE) as (keyof typeof TRADE_EVIDENCE)[], "증빙 종류");
  const taxApprovalNumber=data.has("taxApprovalNumber")?normalizeTaxApproval(text(data,"taxApprovalNumber","전자 승인번호",false,80)):undefined;
  const proofConfirmed = data.get("proofConfirmed") === "on";
  let inputVatReview = choice(text(data, "inputVatReview", "매입세액 공제 검토", true), Object.keys(INPUT_VAT_REVIEWS) as (keyof typeof INPUT_VAT_REVIEWS)[], "매입세액 공제 검토");
  if (kind === "SALE") inputVatReview = "PENDING";
  if (inputVatReview === "DEDUCTIBLE" && (evidence !== "TAX_INVOICE" || !proofConfirmed || taxKind !== "TAXABLE")) throw new InputError("매입 공제 가능은 과세 세금계산서 원본을 확인한 경우에 선택해 주세요.");
  const note = text(data, "note", "비고", false, 500);
  const categoryInput = text(data, "profitCategory", "공사 원가 구분", false, 30);
  const profitCategory = kind === "PURCHASE" && categoryInput ? choice(categoryInput, Object.keys(PROJECT_COST_CATEGORIES) as (keyof typeof PROJECT_COST_CATEGORIES)[], "공사 원가 구분") : null;
  const payPartner = await tx.partner.findFirst({ where: { id: partnerId, companyId: COMPANY_ID, type: { in: kind === "SALE" ? ["CLIENT", "BOTH"] : ["SUPPLIER", "BOTH"] } } });
  const dueMode = text(data,"dueMode","지급기한 기준",false,30)||"MANUAL";
  if(kind==="PURCHASE"&&dueMode!=="MANUAL"){
    const term=dueMode==="PARTNER"?payPartner?.paymentTerm??"MANUAL":choice(dueMode,Object.keys(PAYMENT_TERMS) as (keyof typeof PAYMENT_TERMS)[],"지급기한 기준");
    const calculated=paymentDue(issuedDate.toISOString().slice(0,10),term);dueDate=calculated?new Date(calculated):null;
  }
  const rawMethod=text(data,"paymentMethod","지급방법",false,30)||"UNCONFIRMED";
  const paymentMethod=kind==="SALE"?"UNCONFIRMED":rawMethod==="PARTNER"?payPartner?.paymentMethod??"UNCONFIRMED":choice(rawMethod,Object.keys(PAYMENT_METHODS) as (keyof typeof PAYMENT_METHODS)[],"지급방법");
  const companyExpense=kind==="PURCHASE"&&data.get("companyExpense")==="on";
  if(companyExpense&&projectId)throw new InputError("현장 지급은 현장을 선택하고, 본사·공통 지급은 현장 없이 표시하세요.");
  const values = { taxApprovalNumber,paymentMethod, companyExpense, profitCategory, kind, reference, title, partnerId, projectId, issuedDate, dueDate, supplyAmount, taxAmount, grossAmount: gross.toString(), taxKind, evidence, proofConfirmed, inputVatReview, note };
  const digest = fingerprint({ id, version, values, reason });
  const replay = await tx.tradeDocumentChange.findUnique({ where: { requestId }, include: { document: true } });
  if (replay) { if (replay.document.companyId !== COMPANY_ID || replay.fingerprint !== digest) throw new InputError("다른 내용으로 사용된 요청입니다. 화면을 다시 열어 주세요."); return replay.documentId; }
  const previous = id ? await tx.tradeDocument.findFirst({ where: { id, companyId: COMPANY_ID } }) : null;
  if (id && (!previous || previous.voidedAt)) throw new InputError("사용 중인 회사 문서를 선택해 주세요.");
  await assertPeriodsOpen(tx,issuedDate,previous?.issuedDate);
  const effectiveApproval=taxApprovalNumber===undefined?previous?.taxApprovalNumber:taxApprovalNumber;
  if(effectiveApproval)await assertNoCancellationApproval(tx,effectiveApproval);
  if(effectiveApproval&&evidence!=="TAX_INVOICE")throw new InputError("전자 승인번호는 세금계산서 원본에만 입력하세요. 증빙 종류와 번호를 확인하세요.");
  if(effectiveApproval&&await tx.tradeDocument.findFirst({where:{companyId:COMPANY_ID,taxApprovalNumber:effectiveApproval,voidedAt:null,...(id?{id:{not:id}}:{})}}))throw new InputError("같은 전자 승인번호의 활성 문서가 있습니다. 기존 매입·매출을 확인하세요.");
  if (previous && previous.settledAmount.toFixed(0) !== "0" && (previous.grossAmount.toFixed(0) !== values.grossAmount || previous.partnerId !== partnerId || previous.projectId !== projectId)) throw new InputError("금액·거래처·현장을 바꾸려면 은행 연결을 먼저 해제해 주세요.");
  const partner = payPartner;
  if (!partner || (!partner.active && previous?.partnerId !== partner.id)) throw new InputError("구분에 맞는 사용 중인 회사 거래처를 선택해 주세요.");
  if(previous){
    const source=await tx.tradeWorkbookSource.findUnique({where:{documentId:id},include:{replacesCancellation:{include:{originalDocument:true}}}}),cancelled=source?.replacesCancellation;
    if(cancelled){
      const cells=Array.isArray(cancelled.cells)?cancelled.cells:[],business=normalizeBusinessNumber(String(cells[kind==='SALE'?9:4]??''));
      const validParent=cancelled.companyId===COMPANY_ID&&!cancelled.voidedAt&&cancelled.originalDocument.voidedAt&&cancelled.originalDocument.kind===kind;
      const validBusiness=Boolean(business)&&business===normalizeBusinessNumber(partner.businessNumber??'');
      const validDate=issuedDate.toISOString().slice(0,7)>=cancelled.issuedDate.toISOString().slice(0,7);
      if(!validParent||!validBusiness||!validDate||evidence!=='TAX_INVOICE'||!effectiveApproval)throw new InputError("재발급 연결 원본의 구분·사업자·작성월·세금계산서 관계를 유지해야 합니다. 원본 관계부터 확인하세요.");
    }
  }
  if (projectId) { const project = await tx.project.findFirst({ where: { id: projectId, companyId: COMPANY_ID } }); if (!project || (!project.active && previous?.projectId !== project.id)) throw new InputError("사용 중인 회사 현장을 선택해 주세요."); }
  if (previous && previous.kind !== kind) throw new InputError("매입·매출 구분은 수정할 수 없습니다. 취소 후 새로 등록해 주세요.");
  if(previous&&await tx.tradeReduction.count({where:{originalDocumentId:id,companyId:COMPANY_ID,voidedAt:null}})&&["supplyAmount","taxAmount","grossAmount","partnerId","projectId","issuedDate","taxApprovalNumber","taxKind","evidence","companyExpense"].some(key=>{const old=previous[key as keyof typeof previous],next=key==="taxApprovalNumber"&&values.taxApprovalNumber===undefined?old:values[key as keyof typeof values];return String(old instanceof Date?old.toISOString():old??"")!==String(next instanceof Date?next.toISOString():next??"");}))throw new InputError("감액 증빙이 연결된 청구입니다. 원본 금액·거래처·공사·세무 구분은 감액 이력부터 확인하세요.");
  if(previous){const linked=await tx.stockMovement.aggregate({where:{documentId:id,voidedAt:null},_sum:{supplyAmount:true},_count:true});if(linked._count&&(previous.partnerId!==partnerId||BigInt(supplyAmount)<BigInt(linked._sum.supplyAmount?.toFixed(0)??"0")))throw new InputError("품목 입고가 연결된 매입입니다. 연결 품목 공급가액·거래처를 먼저 확인하세요.");}
  if(previous){const vehicle=await tx.vehicleExpense.findUnique({where:{documentId:id}});if(vehicle&&(gross.toString()!==vehicle.amount.toFixed(0)||projectId!==vehicle.projectId||companyExpense!==vehicle.companyExpense||!proofConfirmed))throw new InputError("차량 비용에 연결된 매입입니다. 금액·공사·원본 확인을 변경하려면 차량 연결을 먼저 해제하세요.");}
  if(previous&&projectId&&await tx.sourceCostReview.count({where:{companyId:COMPANY_ID,sourceType:"TRADE",sourceId:id,active:true}}))throw new InputError("공사별 배부가 있는 매입입니다. 배부를 먼저 취소한 뒤 단일 현장으로 지정하세요.");
  await assertPeriodsOpen(tx,issuedDate,previous?.issuedDate);
  let documentId = id;
  if (previous) { const updated = await tx.tradeDocument.updateMany({ where: { id, companyId: COMPANY_ID, version, settledAmount: previous.settledAmount, voidedAt: null }, data: { ...values, version: { increment: 1 } } }); if (updated.count !== 1) throw new InputError("다른 화면에서 문서를 변경했습니다. 다시 조회해 주세요."); }
  else { documentId = (await tx.tradeDocument.create({ data: { ...values, companyId: COMPANY_ID } })).id; }
  const snapshot = previous ? JSON.parse(JSON.stringify(previous)) as Prisma.InputJsonValue : {};
  await tx.tradeDocumentChange.create({ data: { documentId, requestId, fingerprint: digest, previous: snapshot, next: JSON.parse(JSON.stringify(values)) as Prisma.InputJsonValue, reason } });
  if(previous&&["supplyAmount","taxAmount","profitCategory","inputVatReview","proofConfirmed","projectId","companyExpense","issuedDate","partnerId","taxApprovalNumber"].some(key=>{const before=previous[key as keyof typeof previous],after=key==="taxApprovalNumber"&&values.taxApprovalNumber===undefined?before:values[key as keyof typeof values];return String(before instanceof Date?before.toISOString():before??"")!==String(after instanceof Date?after.toISOString():after??"");}))await invalidateSourceCosts(tx,"TRADE",[documentId]);
  await refreshTradeCashPlan(tx,documentId);
  return documentId;
}
export async function voidTradeDocument(tx: Prisma.TransactionClient, data: FormData, options:{verifiedCredit?:boolean;verifiedStockReturns?:boolean;verifiedVehicleCosts?:boolean}={}) {
  const id = text(data, "documentId", "문서", true, 50); const version = revision(data); const reason = text(data, "reason", "취소 사유", true, 300); const requestId = request(data);
  const previous = await tx.tradeDocument.findFirst({ where: { id, companyId: COMPANY_ID } });
  if (!previous) throw new InputError("회사 문서를 선택해 주세요."); if (previous.voidedAt) return id;
  if (previous.settledAmount.toFixed(0) !== "0") throw new InputError("은행 연결을 먼저 해제한 뒤 취소해 주세요.");
  if(!options.verifiedCredit&&await tx.tradeReduction.count({where:{companyId:COMPANY_ID,originalDocumentId:id,voidedAt:null}}))throw new InputError("부분 감액 이력이 있는 청구입니다. 감액 등록 정정 또는 별도 후속 정산을 먼저 확인하세요.");
  if(await tx.sourceCostReview.count({where:{companyId:COMPANY_ID,sourceType:"TRADE",sourceId:id,active:true}}))throw new InputError("공사별 매입 원가 배부를 먼저 취소하세요.");
  if(!options.verifiedVehicleCosts&&await tx.vehicleExpense.count({where:{documentId:id}}))throw new InputError("차량 비용의 매입 연결을 먼저 해제하세요.");
  if(!options.verifiedStockReturns&&await tx.stockMovement.count({where:{documentId:id,voidedAt:null}}))throw new InputError("연결한 품목 입고를 먼저 확인·취소하세요. 실제 사용한 자재의 반품·환불은 원본을 삭제하지 말고 별도 정산하세요.");
  await assertPeriodsOpen(tx,previous.issuedDate);
  const changed = await tx.tradeDocument.updateMany({ where: { id, companyId: COMPANY_ID, version, voidedAt: null, settledAmount: 0 }, data: { voidedAt: new Date(), voidReason: reason, version: { increment: 1 } } });
  if (changed.count !== 1) throw new InputError("문서가 변경되었습니다. 다시 조회해 주세요.");
  await tx.tradeDocumentChange.create({ data: { documentId: id, requestId, fingerprint: fingerprint({ id, version, reason, void: true }), previous: { voided: false }, next: { voided: true }, reason } });
  await refreshTradeCashPlan(tx,id);
  return id;
}
export async function linkTradeBank(tx: Prisma.TransactionClient, data: FormData) {
  const documentId = text(data, "documentId", "문서", true, 50); const transactionId = text(data, "transactionId", "은행 거래", true, 50); const version = revision(data); const requestId = request(data);
  const value = requiredAmount(data, "amount", "연결 금액"); if (BigInt(value) <= 0n) throw new InputError("연결 금액은 0보다 커야 합니다.");
  const note = text(data, "note", "연결 사유", true, 300); const digest = fingerprint({ documentId, transactionId, version, value, note });
  const replay = await tx.tradeBankLink.findUnique({ where: { requestId }, include: { document: true } });
  if (replay) { if (replay.document.companyId !== COMPANY_ID || replay.fingerprint !== digest) throw new InputError("다른 내용으로 사용된 요청입니다. 다시 조회해 주세요."); return documentId; }
  const document = await tx.tradeDocument.findFirst({ where: { id: documentId, companyId: COMPANY_ID, voidedAt: null } });
  if (!document || document.version !== version) throw new InputError("문서가 변경되었습니다. 다시 조회해 주세요.");
  const transaction = await tx.bankTransaction.findFirst({ where: { id: transactionId, account: { companyId: COMPANY_ID }, internalTransfer: false }, include: { tradeLinks: { where: { voidedAt: null } } } });
  if (!transaction || transaction.direction !== (document.kind === "SALE" ? "IN" : "OUT")) throw new InputError("매출은 입금, 매입은 출금 거래를 선택해 주세요. 회사 계좌 간 이체는 연결할 수 없습니다.");
  await assertBankNotVehicleMatched(tx,transaction.id);
  if(await tx.cashSettlement.count({where:{bankTransactionId:transaction.id,voidedAt:null,plan:{OR:[{refundCancellation:{isNot:null}},{refundReduction:{isNot:null}}]}}}))throw new InputError("환급에 연결한 은행 거래입니다. 환급 연결부터 확인하세요.");
  await assertPeriodsOpen(tx,transaction.tradedDate);
  const used = transaction.tradeLinks.reduce((sum,r) => sum + BigInt(r.amount.toFixed(0)), 0n);
  if (BigInt(value) > BigInt(document.grossAmount.toFixed(0)) - BigInt(document.settledAmount.toFixed(0))) throw new InputError("연결 금액이 문서의 미수·미지급 잔액을 초과합니다.");
  if (used + BigInt(value) > BigInt(transaction.amount.toFixed(0))) throw new InputError("다른 문서에 연결한 금액을 포함해 은행 거래금액을 초과합니다.");
  const updated = await tx.tradeDocument.updateMany({ where: { id: documentId, companyId: COMPANY_ID, version, voidedAt: null }, data: { settledAmount: { increment: value }, version: { increment: 1 } } });
  if (updated.count !== 1) throw new InputError("문서가 변경되었습니다. 다시 조회해 주세요.");
  const bankChanged = await tx.bankTransaction.updateMany({ where: { id: transactionId, settlementVersion: transaction.settlementVersion, classificationVersion: transaction.classificationVersion, internalTransfer: false }, data: { settlementVersion: { increment: 1 } } });
  if (bankChanged.count !== 1) throw new InputError("은행 연결 상태가 변경되었습니다. 다시 조회해 주세요.");
  await tx.tradeBankLink.create({ data: { documentId, transactionId, amount: value, requestId, fingerprint: digest, note } }); await refreshTradeCashPlan(tx,documentId); return documentId;
}
export async function unlinkTradeBank(tx: Prisma.TransactionClient, data: FormData) {
  const id = text(data, "linkId", "연결", true, 50); const version = revision(data); const reason = text(data, "reason", "해제 사유", true, 300);
  await acquirePeriodReviewLock(tx);
  const link = await tx.tradeBankLink.findFirst({ where: { id, document: { companyId: COMPANY_ID }, transaction: { account: { companyId: COMPANY_ID } } }, include: { document: true, transaction: true } });
  if (!link) throw new InputError("회사 은행 연결을 선택해 주세요."); if (link.voidedAt) return link.documentId;
  if(await tx.tradeCancellation.count({where:{companyId:COMPANY_ID,originalDocumentId:link.documentId,voidedAt:null,refundPlanId:{not:null}}}))throw new InputError("환급 정산의 원 지급 기록입니다. 수정증빙 등록 정정부터 확인하세요.");
  const paidCredits=await tx.tradeReduction.findMany({where:{companyId:COMPANY_ID,originalDocumentId:link.documentId,voidedAt:null,paymentBasis:{not:null}},select:{paidLinkIds:true}});
  if(paidCredits.some(r=>!Array.isArray(r.paidLinkIds)||r.paidLinkIds.includes(link.id)))throw new InputError('기지급 부분 감액의 원 지급 기록입니다. 감액 등록 정정부터 확인하세요.');
  await assertPeriodsOpen(tx,link.transaction.tradedDate);
  const changed = await tx.tradeDocument.updateMany({ where: { id: link.documentId, version, companyId: COMPANY_ID, settledAmount: { gte: link.amount } }, data: { settledAmount: { decrement: link.amount }, version: { increment: 1 } } });
  if (changed.count !== 1) throw new InputError("문서가 변경되었습니다. 다시 조회해 주세요.");
  const bankChanged = await tx.bankTransaction.updateMany({ where: { id: link.transactionId, settlementVersion: link.transaction.settlementVersion }, data: { settlementVersion: { increment: 1 } } });
  if (bankChanged.count !== 1) throw new InputError("은행 연결 상태가 변경되었습니다. 다시 조회해 주세요.");
  const unlinked = await tx.tradeBankLink.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason } });
  if (unlinked.count !== 1) throw new InputError("연결이 변경되었습니다. 다시 조회해 주세요."); await refreshTradeCashPlan(tx,link.documentId); return link.documentId;
}

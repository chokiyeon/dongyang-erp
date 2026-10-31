import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { PAYMENT_TERMS, PAYMENT_METHODS, normalizePayeeAccount } from "./payment-terms";
import { COMPANY_ID } from "./constants";
import { BANKS, WORK_TYPES, STATUS_LABELS, PARTNER_LABELS, InputError, amount, choice, date, revision, text } from "./validation";

type Store = PrismaClient | Prisma.TransactionClient;
export type Kind = "partners" | "projects" | "accounts";

export async function saveMaster(db: Store, kind: Kind, data: FormData): Promise<void> {
  if (typeof (db as PrismaClient).$transaction === "function") return (db as PrismaClient).$transaction(tx => saveMaster(tx, kind, data));
  const company = await db.company.findUnique({ where: { id: COMPANY_ID } });
  if (!company) throw new InputError("먼저 회사 정보를 등록해 주세요.");
  const id = text(data, "id", "항목", false, 50);
  const version = id ? revision(data) : 0;
  const name = text(data, "name", "이름", true);
  const active = data.get("active") === "on";
  let count = 1;
  if (kind === "partners") {
    const code = text(data, "code", "거래처 코드", true, 30).toUpperCase();
    const previous = id ? await db.partner.findFirst({where:{id,companyId:COMPANY_ID}}) : null;
    if (id && !previous) throw new InputError("회사 거래처를 선택하세요.");
    const hasPaymentData = ["paymentTerm","paymentMethod","payeeBank","payeeAccount","payeeHolder"].some(key=>data.has(key));
    const payeeBank = hasPaymentData ? text(data,"payeeBank","송금 은행",false,50)||null : previous?.payeeBank??null;
    const rawAccount = hasPaymentData ? text(data,"payeeAccount","송금 계좌번호",false,40) : previous?.payeeAccount??"";
    const payeeAccount = rawAccount ? normalizePayeeAccount(rawAccount) : null;
    const payeeHolder = hasPaymentData ? text(data,"payeeHolder","예금주",false,100)||null : previous?.payeeHolder??null;
    if ((payeeBank||payeeAccount||payeeHolder)&&!(payeeBank&&payeeAccount&&payeeHolder)) throw new InputError("송금 은행·계좌번호·예금주를 모두 입력하세요.");
    const accountChanged=previous?.payeeBank!==payeeBank||previous?.payeeAccount!==payeeAccount||previous?.payeeHolder!==payeeHolder;
    const payeeVerifiedAt = !hasPaymentData ? previous?.payeeVerifiedAt??null : payeeBank&&data.get("payeeConfirmed")==="on" ? (!accountChanged&&previous?.payeeVerifiedAt?previous.payeeVerifiedAt:new Date()) : null;
    const paymentTerm=hasPaymentData?choice(text(data,"paymentTerm","지급 조건"),Object.keys(PAYMENT_TERMS) as (keyof typeof PAYMENT_TERMS)[],"지급 조건"):previous?.paymentTerm??"MANUAL";
    const paymentMethod=hasPaymentData?choice(text(data,"paymentMethod","기본 지급방법"),Object.keys(PAYMENT_METHODS) as (keyof typeof PAYMENT_METHODS)[],"기본 지급방법"):previous?.paymentMethod??"UNCONFIRMED";
    const values = { name, code, active, type: choice(text(data, "type", "거래처 구분"), Object.keys(PARTNER_LABELS) as (keyof typeof PARTNER_LABELS)[], "거래처 구분"), contact: text(data, "contact", "담당자", false, 100) || null, note: text(data, "note", "비고", false, 500) || null,paymentTerm,paymentMethod,payeeBank,payeeAccount,payeeHolder,payeeVerifiedAt };
    const before={paymentTerm:previous?.paymentTerm??"MANUAL",paymentMethod:previous?.paymentMethod??"UNCONFIRMED",payeeBank:previous?.payeeBank??null,payeeAccount:previous?.payeeAccount??null,payeeHolder:previous?.payeeHolder??null,verified:previous?.payeeVerifiedAt?.toISOString()??null};
    const after={paymentTerm,paymentMethod,payeeBank,payeeAccount,payeeHolder,verified:payeeVerifiedAt?.toISOString()??null};
    const paymentChanged=hasPaymentData&&JSON.stringify(before)!==JSON.stringify(after);
    const paymentReason=paymentChanged?text(data,"paymentReason","송금정보 변경 사유",true,300):"";
    let partnerId=id;
    if (id) count = (await db.partner.updateMany({ where: { id, companyId: COMPANY_ID, version }, data: { ...values, version: { increment: 1 } } })).count;
    else partnerId=(await db.partner.create({ data: { ...values, companyId: COMPANY_ID } })).id;
    if(count!==1)throw new InputError("다른 화면에서 거래처가 변경되었습니다. 다시 조회하세요.");
    if(paymentChanged)await db.partnerPaymentChange.create({data:{partnerId,previous:before,next:after,reason:paymentReason}});
  } else if (kind === "accounts") {
    const values = { label: name, active, accountingCode: null, bankName: choice(text(data, "bankName", "은행"), BANKS, "은행"), overdraftLimit: amount(text(data, "overdraftLimit", "마이너스 한도", false, 20), "마이너스 한도") };
    if (id) count = (await db.bankAccount.updateMany({ where: { id, companyId: COMPANY_ID, version }, data: { ...values, version: { increment: 1 } } })).count;
    else await db.bankAccount.create({ data: { ...values, companyId: COMPANY_ID } });
  } else {
    const code = text(data, "code", "현장 코드", true, 30).toUpperCase();
    const clientId = text(data, "clientId", "발주처", false, 50) || null;
    if (clientId && !(await db.partner.findFirst({ where: { id: clientId, companyId: COMPANY_ID, type: { in: ["CLIENT", "BOTH"] } } }))) throw new InputError("회사에 등록된 발주처를 선택해 주세요.");
    const startDate = date(text(data, "startDate", "착공일"), "착공일");
    const endDate = date(text(data, "endDate", "준공 예정일"), "준공 예정일");
    if (startDate && endDate && startDate > endDate) throw new InputError("준공 예정일은 착공일보다 빠를 수 없습니다.");
    const rawTypes = data.getAll("workTypes");
    const workTypes = [...new Set(rawTypes.map((v) => choice(typeof v === "string" ? v : "", WORK_TYPES, "공종")))];
    const values = { name, code, active, clientId, workTypes, startDate, endDate, manager: text(data, "manager", "담당자", false, 100) || null, address: text(data, "address", "현장 주소", false, 300) || null, status: choice(text(data, "status", "공사 상태"), Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[], "공사 상태"), contractAmount: amount(text(data, "contractAmount", "계약 공급가액", false, 20), "계약 공급가액") };
    if (id) count = (await db.project.updateMany({ where: { id, companyId: COMPANY_ID, version }, data: { ...values, version: { increment: 1 } } })).count;
    else await db.project.create({ data: { ...values, companyId: COMPANY_ID } });
  }
  if (count !== 1) throw new InputError("다른 화면에서 변경되었거나 존재하지 않는 자료입니다. 목록에서 다시 열어 주세요.");
}

export async function saveCompany(db: Store, data: FormData) {
  const name = text(data, "name", "법인명", true);
  const representatives = text(data, "representatives", "대표자", false, 300).split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  if (representatives.length > 10) throw new InputError("대표자는 10명 이내로 등록해 주세요.");
  const current = await db.company.findUnique({ where: { id: COMPANY_ID } });
  if (!current) {
    await db.company.create({ data: { id: COMPANY_ID, name, representatives } });
  } else {
    const result = await db.company.updateMany({ where: { id: COMPANY_ID, version: revision(data) }, data: { name, representatives, version: { increment: 1 } } });
    if (result.count !== 1) throw new InputError("회사 정보가 변경되었습니다. 화면을 새로 열어 주세요.");
  }
}

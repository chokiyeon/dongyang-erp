import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { COMPANY_ID } from "./constants";
import { InputError, amount, choice, date, revision, text } from "./validation";

export const CASH_CATEGORIES = ["공사대금", "자재대금", "직원급여", "현장노무비", "현장경비", "세금", "보험료", "카드대금", "어음결제", "수취어음", "대출·이자", "기타"] as const;
export const DIRECTIONS = { IN: "입금", OUT: "지출" } as const;
export const CERTAINTIES = { CONFIRMED: "확정", ESTIMATED: "예상" } as const;

export function cashSummary(plan: { plannedAmount: { toFixed: (n: number) => string }; completedAt: Date | null; settlements: { amount: { toFixed: (n: number) => string }; voidedAt?: Date | null }[] }) {
  const planned = BigInt(plan.plannedAmount.toFixed(0));
  const actual = plan.settlements.filter((s) => !s.voidedAt).reduce((sum, s) => sum + BigInt(s.amount.toFixed(0)), 0n);
  return { planned, actual, remaining: plan.completedAt ? 0n : planned > actual ? planned - actual : 0n, difference: planned - actual, status: plan.completedAt ? "완료" : actual > 0n ? "일부 처리" : "예정" };
}
export function won(value: bigint) { return `${value.toLocaleString("ko-KR")}원`; }

export async function createCashPlan(tx: Prisma.TransactionClient, data: FormData) {
  if (!(await tx.company.findUnique({ where: { id: COMPANY_ID } }))) throw new InputError("먼저 회사 정보를 등록해 주세요.");
  const plannedDate = date(text(data, "plannedDate", "예정일", true), "예정일");
  const plannedAmount = amount(text(data, "plannedAmount", "예정금액", true, 20), "예정금액");
  if (!plannedDate || !plannedAmount || BigInt(plannedAmount) <= 0n) throw new InputError("예정금액은 0보다 커야 합니다.");
  const requestId = text(data, "requestId", "요청 식별자", true, 50);
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw new InputError("화면을 새로 열어 주세요.");
  const values = {
    companyId: COMPANY_ID,
    title: text(data, "title", "내용", true, 200),
    category: choice(text(data, "category", "항목"), CASH_CATEGORIES, "항목"),
    direction: choice(text(data, "direction", "입출금 구분"), ["IN", "OUT"] as const, "입출금 구분"),
    certainty: choice(text(data, "certainty", "확정 여부"), ["CONFIRMED", "ESTIMATED"] as const, "확정 여부"),
    plannedDate, plannedAmount, requestId,
  };
  const previous = await tx.cashPlan.findUnique({ where: { requestId } });
  if (previous) {
    if (previous.companyId === COMPANY_ID && previous.title === values.title && previous.plannedAmount.toFixed(0) === plannedAmount && previous.plannedDate.getTime() === plannedDate.getTime() && previous.direction === values.direction && previous.certainty === values.certainty && previous.category === values.category) return;
    throw new InputError("이미 사용된 요청입니다. 화면을 새로 열어 주세요.");
  }
  await tx.cashPlan.create({ data: values });
}

export async function settleCashPlan(tx: Prisma.TransactionClient, data: FormData) {
  const planId = text(data, "planId", "예정 내역", true, 50);
  const version = revision(data);
  const bankTransactionId = text(data, "bankTransactionId", "은행 거래", false, 50) || null;
  const bank = bankTransactionId ? await tx.bankTransaction.findFirst({ where: { id: bankTransactionId, account: { companyId: COMPANY_ID }, internalTransfer: false }, include: { cashSettlements: { where: { voidedAt: null } } } }) : null;
  if (bankTransactionId && !bank) throw new InputError("회사 은행 거래를 선택해 주세요. 계좌 간 이체는 연결할 수 없습니다.");
  const processedDate = bank ? bank.tradedDate : date(text(data, "processedDate", "실제 처리일", true), "실제 처리일");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (processedDate && processedDate.toISOString().slice(0, 10) > today) throw new InputError("실제 처리일은 오늘 이후일 수 없습니다.");
  const inputAmount = amount(text(data, "amount", "실제 처리액", true, 20), "실제 처리액");
  const note = text(data, "note", "처리 사유", false, 500);
  const finish = data.get("finish") === "on";
  const requestId = text(data, "requestId", "요청 식별자", true, 50);
  if (!/^[a-f0-9-]{36}$/i.test(requestId) || !processedDate || !inputAmount) throw new InputError("처리 내역을 확인해 주세요.");
  const previous = await tx.cashSettlement.findUnique({ where: { requestId }, include: { plan: true } });
  if (previous) {
    if (previous.plan.companyId === COMPANY_ID && previous.planId === planId && previous.bankTransactionId === bankTransactionId && previous.amount.toFixed(0) === inputAmount && previous.processedDate.getTime() === processedDate.getTime() && (previous.note ?? "") === note && previous.finalized === finish) return;
    throw new InputError("이미 사용된 요청입니다. 화면을 새로 열어 주세요.");
  }
  const plan = await tx.cashPlan.findFirst({ where: { id: planId, companyId: COMPANY_ID }, include: { settlements: true, issuedNote: true, receivedNote: true } });
  if (!plan || plan.version !== version || plan.completedAt) throw new InputError("이미 처리되었거나 변경된 내역입니다. 목록에서 다시 열어 주세요.");
  if (plan.issuedNote) {
    if (plan.issuedNote.status !== "OPEN" || !bank || bank.accountId !== plan.issuedNote.accountId || inputAmount !== plan.issuedNote.amount.toFixed(0) || processedDate < plan.issuedNote.issuedDate) throw new InputError("발행어음은 지정 결제 계좌의 실제 은행 출금으로 어음금액 전액을 연결해야 합니다. 발행일 전 거래는 사용할 수 없습니다.");
  }
  if (plan.receivedNote) {
    if (plan.receivedNote.status !== "HELD" || !bank || inputAmount !== plan.receivedNote.amount.toFixed(0) || processedDate < plan.receivedNote.receivedDate) throw new InputError("수취어음 전액 입금은 수취일 이후 실제 은행 입금으로 액면금액 전액을 연결하세요. 할인은 수취어음대장에서 처리합니다.");
  }
  const summary = cashSummary(plan);
  const paid = BigInt(inputAmount);
  const total = summary.actual + paid;
  const complete = finish || total === summary.planned;
  if (paid === 0n && !finish) throw new InputError("추가 처리액을 입력하거나 최종 완료를 선택해 주세요.");
  if (total > summary.planned && !finish) throw new InputError("예정액을 초과하면 최종 완료를 선택하고 사유를 입력해 주세요.");
  if (complete && total !== summary.planned && !note) throw new InputError("예정액과 다르게 완료하는 사유를 입력해 주세요.");
  if (bank) {
    if (bank.direction !== plan.direction) throw new InputError("입출금 예정과 같은 방향의 은행 거래를 선택해 주세요.");
    const used = bank.cashSettlements.reduce((sum, s) => sum + BigInt(s.amount.toFixed(0)), 0n);
    if (paid <= 0n || used + paid > BigInt(bank.amount.toFixed(0))) throw new InputError("이미 반영한 금액을 포함해 은행 거래금액을 초과하거나 연결 금액이 0원입니다.");
  }
  const updated = await tx.cashPlan.updateMany({ where: { id: plan.id, companyId: COMPANY_ID, version, completedAt: null }, data: { version: { increment: 1 }, ...(complete ? { completedAt: new Date(), completionNote: note || null } : {}) } });
  if (updated.count !== 1) throw new InputError("다른 화면에서 처리했습니다. 목록에서 다시 열어 주세요.");
  if (bank) {
    const changed = await tx.bankTransaction.updateMany({ where: { id: bank.id, settlementVersion: bank.settlementVersion, classificationVersion: bank.classificationVersion, internalTransfer: false }, data: { settlementVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new InputError("은행 연결 상태가 변경되었습니다. 다시 조회해 주세요.");
  }
  const settlement = await tx.cashSettlement.create({ data: { planId, bankTransactionId, amount: inputAmount, processedDate, note: note || null, requestId, finalized: finish } });
  if (plan.issuedNote) {
    const updatedNote = await tx.issuedNote.updateMany({ where: { id: plan.issuedNote.id, companyId: COMPANY_ID, version: plan.issuedNote.version, status: "OPEN" }, data: { status: "SETTLED", settledDate: processedDate, version: { increment: 1 } } });
    if (updatedNote.count !== 1) throw new InputError("어음 상태가 변경되었습니다. 다시 조회해 주세요.");
    await tx.issuedNoteChange.create({ data: { noteId: plan.issuedNote.id, requestId: `settle:${requestId}`, fingerprint: createHash("sha256").update(settlement.id).digest("hex"), previous: { status: "OPEN" }, next: { status: "SETTLED", amount: inputAmount, date: processedDate.toISOString().slice(0,10), settlementId: settlement.id }, reason: note || "은행 전액 결제 확인" } });
  }
  if (plan.receivedNote) {
    const received = plan.receivedNote;
    const changed = await tx.receivedNote.updateMany({ where: { id: received.id, companyId: COMPANY_ID, version: received.version, status: "HELD" }, data: { status: "COLLECTED", realizedDate: processedDate, discountFee: "0", netProceeds: inputAmount, version: { increment: 1 } } });
    if (changed.count !== 1) throw new InputError("수취어음 상태가 변경되었습니다. 다시 조회하세요.");
    await tx.receivedNoteChange.create({ data: { noteId: received.id, requestId: `collect:${requestId}`, fingerprint: createHash("sha256").update(settlement.id).digest("hex"), previous: { status: "HELD" }, next: { status: "COLLECTED", netProceeds: inputAmount, date: processedDate.toISOString().slice(0,10), settlementId: settlement.id }, reason: note || "은행 전액 입금 확인" } });
  }
}


export async function voidCashSettlement(tx: Prisma.TransactionClient, data: FormData) {
  const id = text(data, "settlementId", "처리 내역", true, 50); const version = revision(data); const reason = text(data, "reason", "처리 취소 사유", true, 300);
  const settlement = await tx.cashSettlement.findFirst({ where: { id, plan: { companyId: COMPANY_ID } }, include: { bankTransaction: true, plan: { include: { issuedNote: true, receivedNote: true } } } });
  if (!settlement) throw new InputError("회사 처리 내역을 선택해 주세요."); if (settlement.voidedAt) return settlement.planId;
  if (settlement.plan.issuedNote && settlement.plan.issuedNote.status !== "SETTLED") throw new InputError("어음 상태가 변경되었습니다. 어음대장에서 확인해 주세요.");
  if (settlement.plan.receivedNote && !["COLLECTED", "DISCOUNTED"].includes(settlement.plan.receivedNote.status)) throw new InputError("수취어음 상태를 확인하세요. 할인 만기 확인을 완료했다면 먼저 만기 확인을 취소해야 합니다.");
  const latest = await tx.cashSettlement.findFirst({ where: { planId: settlement.planId, voidedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (latest?.id !== id) throw new InputError("가장 최근에 등록한 유효 처리부터 순서대로 취소해 주세요.");
  const updated = await tx.cashPlan.updateMany({ where: { id: settlement.planId, companyId: COMPANY_ID, version }, data: { version: { increment: 1 }, completedAt: null, completionNote: null } });
  if (updated.count !== 1) throw new InputError("예정 내역이 변경되었습니다. 다시 조회해 주세요.");
  if (settlement.bankTransaction) {
    const changed = await tx.bankTransaction.updateMany({ where: { id: settlement.bankTransaction.id, settlementVersion: settlement.bankTransaction.settlementVersion }, data: { settlementVersion: { increment: 1 } } });
    if (changed.count !== 1) throw new InputError("은행 연결 상태가 변경되었습니다. 다시 조회해 주세요.");
  }
  const changed = await tx.cashSettlement.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date(), voidReason: reason } });
  if (changed.count !== 1) throw new InputError("처리 내역이 변경되었습니다. 다시 조회해 주세요.");
  if (settlement.plan.issuedNote) {
    const issued = settlement.plan.issuedNote;
    const noteChanged = await tx.issuedNote.updateMany({ where: { id: issued.id, companyId: COMPANY_ID, version: issued.version, status: "SETTLED" }, data: { status: "OPEN", settledDate: null, version: { increment: 1 } } });
    if (noteChanged.count !== 1) throw new InputError("어음 상태가 변경되었습니다. 다시 조회해 주세요.");
    await tx.issuedNoteChange.create({ data: { noteId: issued.id, requestId: `cash-undo:${settlement.id}`, fingerprint: createHash("sha256").update(reason).digest("hex"), previous: { status: "SETTLED" }, next: { status: "OPEN" }, reason } });
  }
  if (settlement.plan.receivedNote) {
    const received = settlement.plan.receivedNote;
    const changed = await tx.receivedNote.updateMany({ where: { id: received.id, companyId: COMPANY_ID, version: received.version, status: received.status }, data: { status: "HELD", realizedDate: null, discountFee: null, netProceeds: null, maturityConfirmedAt: null, version: { increment: 1 } } });
    if (changed.count !== 1) throw new InputError("수취어음 상태가 변경되었습니다. 다시 조회하세요.");
    await tx.receivedNoteChange.create({ data: { noteId: received.id, requestId: `cash-undo:${settlement.id}`, fingerprint: createHash("sha256").update(reason).digest("hex"), previous: { status: received.status, discountFee: received.discountFee?.toFixed(0) ?? null, netProceeds: received.netProceeds?.toFixed(0) ?? null }, next: { status: "HELD" }, reason } });
  }
  return settlement.planId;
}

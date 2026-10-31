import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { BatchClassification } from "@/components/batch-classification";
import { RecordForm } from "@/components/record-form";
import { Field, Select, Section } from "@/components/fields";
import { undoBatchAction } from "./actions";
import type { Prisma } from "@/generated/prisma/client";
type Query = { q?: string; direction?: string; page?: string; batch?: string; result?: string; undo?: string };
async function Content({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin(); const company = await requireCompany(); const query = await searchParams;
  const direction = query.direction === "IN" ? "IN" : "OUT";
  const q = (query.q ?? "").slice(0, 100); const page = Math.min(100000, Math.max(1, Math.floor(Number(query.page)) || 1));
  const db = getDb();
  const where: Prisma.BankTransactionWhereInput = { account: { companyId: company.id }, accountingCodeId: null, direction, ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { legacyCategory: { contains: q, mode: "insensitive" } }] } : {}) };
  const [rows, count, codes, batches, undo] = await Promise.all([
    db.bankTransaction.findMany({ where, include: { account: true }, orderBy: [{ tradedDate: "desc" }, { id: "asc" }], skip: (page - 1) * 100, take: 100 }),
    db.bankTransaction.count({ where }), db.accountingCode.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.classificationBatch.findMany({ where: { companyId: company.id }, include: { _count: { select: { items: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
    query.undo ? db.classificationBatch.findFirst({ where: { id: query.undo, companyId: company.id }, include: { items: { include: { transaction: true } } } }) : null,
  ]);
  const href = (p: number) => `/ledger/classify?${new URLSearchParams({ q, direction, page: String(p) })}`;
  return <><h1>미분류 묶음 정리</h1><p className="erp-page-description">같은 용도의 미분류 거래만 선택해 계정과목을 적용하세요. 이전 장부 분류는 참고용이며 자동 확정하지 않습니다.</p>
  {query.result && <p role="status">{query.result === "applied" ? "묶음 분류를 저장했습니다." : query.result === "undone" ? "묶음 분류를 되돌렸습니다." : "이미 되돌린 작업입니다."}</p>}
  <Section title="미분류 거래 조회"><form method="get" className="flex flex-wrap items-end gap-3"><Select name="direction" label="입출금 구분" defaultValue={direction}><option value="OUT">출금</option><option value="IN">입금</option></Select><Field name="q" label="거래 내용 · 이전 분류 검색" defaultValue={q} maxLength={100} /><button className="erp-button" type="submit">조회</button></form><p>검색 결과 {count.toLocaleString()}건 · 한 번에 최대 100건</p><BatchClassification key={`${direction}:${q}:${page}:${query.result ?? ""}`} rows={rows.map((r) => ({ id: r.id, version: r.classificationVersion, date: r.tradedDate.toISOString().slice(0, 10), account: `${r.account.bankName} · ${r.account.label}`, description: r.description, amount: r.amount.toFixed(0), legacyCategory: r.legacyCategory ?? "" }))} codes={codes} requestId={randomUUID()} direction={direction} /><div className="mt-4 flex gap-4">{page > 1 && <Link href={href(page - 1)}>이전</Link>}<span>{page}쪽</span>{page * 100 < count && <Link href={href(page + 1)}>다음</Link>}</div></Section>
  {undo && <Section title="되돌리기 전 확인" description="이 작업 이후 따로 수정한 거래가 있으면 전체 되돌리기를 중단합니다."><p>{undo.targetLabel} · {undo.items.length}건 · 사유: {undo.reason}</p><ul>{undo.items.map((item) => <li key={item.id}>{item.transaction.tradedDate.toISOString().slice(0, 10)} · {item.transaction.description} · {item.transaction.amount.toFixed(0)}원 → 적용 전 분류로 복원</li>)}</ul>{undo.undoneAt ? <p>이미 되돌린 작업입니다.</p> : <RecordForm action={undoBatchAction} label="이 묶음 분류 되돌리기"><input type="hidden" name="batchId" value={undo.id} /><Field label="되돌리기 사유" name="reason" required maxLength={300} /></RecordForm>}</Section>}
  <Section title="최근 묶음 분류 이력"><div className="overflow-x-auto"><table className="erp-table"><thead><tr><th>처리일</th><th>계정</th><th>건수</th><th>사유</th><th>상태</th></tr></thead><tbody>{batches.map((b) => <tr key={b.id}><td>{b.createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td><td>{b.targetLabel}</td><td>{b._count.items}</td><td>{b.reason}</td><td>{b.undoneAt ? "되돌림 완료" : <Link href={`/ledger/classify?undo=${b.id}`}>되돌리기 검토</Link>}</td></tr>)}</tbody></table></div></Section></>;
}
export default function Page(props: { searchParams: Promise<Query> }) { return <Suspense fallback={<p>거래를 조회하는 중입니다.</p>}><Content {...props} /></Suspense>; }

import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { RecordForm } from "@/components/record-form";
import { Section, Field } from "@/components/fields";
import { AccountingCodeImport } from "@/components/accounting-code-import";
import { Active, EditMeta, ListHeader, Search, type ListParams, listParams } from "@/components/master-list";
import { saveCodeAction } from "./actions";
async function Content({ searchParams }: { searchParams: Promise<ListParams> }) {
  await requireAdmin(); const params = await searchParams; const { query, inactive } = listParams(params); const db = getDb();
  const [codes, current] = await Promise.all([db.accountingCode.findMany({ where: { ...(inactive ? {} : { active: true }), OR: [{ code: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] }, orderBy: { code: "asc" }, take: 1000 }), params.edit ? db.accountingCode.findUnique({ where: { id: params.edit } }) : null]);
  if (params.edit && !current) notFound();
  return <><ListHeader title="회계코드 관리" description="건설업의 세무회계 계정과목을 기준으로 정리한 기본 코드입니다. 코드 번호는 이 ERP의 관리 번호이며 특정 회계 프로그램의 번호와 다를 수 있습니다." saved={params.saved} /><div className="erp-ledger-layout"><Section title="회계코드 목록" description="코드와 앞자리 0을 그대로 보관합니다. 최대 1,000건 표시."><Search query={query} inactive={inactive} /><div className="overflow-x-auto"><table><thead><tr><th>회계코드</th><th>계정과목명</th><th>분류</th><th>상태</th><th>수정</th></tr></thead><tbody>{codes.map((c) => <tr key={c.id}><td>{c.code}</td><td>{c.name}</td><td>{c.group}</td><td>{c.active ? "사용" : "중지"}</td><td><Link className="erp-row-action" href={`/accounting-codes?edit=${c.id}`}>수정</Link></td></tr>)}{!codes.length && <tr><td colSpan={5} className="erp-empty">조회 조건에 맞는 코드가 없습니다. 검색 조건을 확인하거나 새 계정과목을 등록해 주세요.</td></tr>}</tbody></table></div></Section><div className="space-y-4"><Section title={current ? "회계코드 수정" : "회계코드 등록"}><RecordForm key={current ? `${current.id}-${current.version}` : randomUUID()} action={saveCodeAction}><EditMeta record={current} /><Field label="회계코드" name="code" required maxLength={30} defaultValue={current?.code ?? ""} /><Field label="계정과목명" name="name" required maxLength={100} defaultValue={current?.name ?? ""} /><Field label="분류" name="group" maxLength={50} defaultValue={current?.group ?? ""} /><Field label="비고" name="note" maxLength={500} defaultValue={current?.note ?? ""} /><Active active={current?.active} /></RecordForm>{current && <Link href="/accounting-codes" className="mt-3 block text-xs text-blue-800">새 등록으로 돌아가기</Link>}</Section><Section title="외부 코드표 추가 가져오기 (선택)"><AccountingCodeImport /></Section></div></div></>;
}
export default function AccountingCodes(props: { searchParams: Promise<ListParams> }) { return <Suspense fallback={<p>회계코드를 불러오는 중입니다.</p>}><Content {...props} /></Suspense>; }

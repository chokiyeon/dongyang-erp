import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { BANKS, formatWon } from "@/lib/validation";
import { RecordForm } from "@/components/record-form";
import { Field, Select, Section } from "@/components/fields";
import { Active, EditLink, EditMeta, Empty, ListHeader, Search, listParams, type ListParams } from "@/components/master-list";
import { saveAccountAction } from "../actions";
async function Content({ searchParams }: { searchParams: Promise<ListParams> }) {
  await requireAdmin();
  const company = await requireCompany();
  const params = await searchParams;
  const { query, inactive } = listParams(params);
  const db = getDb();
  const [records, record] = await Promise.all([
    db.bankAccount.findMany({ where: { companyId: company.id, ...(inactive ? {} : { active: true }), OR: [{ label: { contains: query, mode: "insensitive" } }, { bankName: { contains: query, mode: "insensitive" } }] }, orderBy: [{ bankName: "asc" }, { label: "asc" }], take: 200 }),
    params.edit ? db.bankAccount.findFirst({ where: { companyId: company.id, id: params.edit } }) : null,
  ]);
  if (params.edit && !record) notFound();
  return <><ListHeader title="계좌 관리" description="계좌번호 대신 업무용 별칭으로 구분합니다. 여기의 한도는 잔액이나 보유현금이 아닙니다." saved={params.saved} />
    <div className="erp-ledger-layout">
      <Section title="법인 계좌" description="최대 200건을 표시합니다."><Search query={query} inactive={inactive} />{records.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="pb-3">은행·별칭</th><th>마이너스 한도</th><th>상태</th><th><span className="sr-only">수정</span></th></tr></thead><tbody>{records.map((a) => <tr key={a.id} className="border-t border-slate-100"><td className="py-4"><span className="block text-xs text-slate-500">{a.bankName}</span>{a.label}</td><td>{a.overdraftLimit === null ? "미확인" : formatWon(a.overdraftLimit)}</td><td>{a.active ? "사용" : "중지"}</td><td><EditLink href={`/accounts?edit=${a.id}`} /></td></tr>)}</tbody></table></div> : <Empty />}</Section>
      <Section title={record ? "계좌 수정" : "새 계좌"} description="한도 미확인은 빈칸, 마이너스 약정이 없는 것으로 확인된 계좌는 0을 입력하세요. 회사 확인 약정은 전북은행 200,000,000원(2026-11-02 재확인), 신한은행 50,000,000원입니다. 실제 해당 계좌를 확인해 입력하며 잔액에 더하지 않습니다."><RecordForm key={record ? `${record.id}-${record.version}` : randomUUID()} action={saveAccountAction}><EditMeta record={record} />
        <Select label="은행" name="bankName" defaultValue={record?.bankName ?? BANKS[0]}>{BANKS.map((b) => <option key={b}>{b}</option>)}</Select>
        <Field label="계좌 별칭" name="name" required maxLength={100} placeholder="예: 하나은행 운영계좌" defaultValue={record?.label ?? ""} />
        <Field label="마이너스 약정 한도 (원)" name="overdraftLimit" inputMode="numeric" maxLength={20} defaultValue={record?.overdraftLimit?.toFixed(0) ?? ""} /><Active active={record?.active} />
      </RecordForm>{record && <Link className="mt-4 block text-sm text-slate-600 underline" href="/accounts">새 등록으로 돌아가기</Link>}</Section>
    </div></>;
}
export default function Accounts(props: { searchParams: Promise<ListParams> }) { return <Suspense fallback={<p>계좌를 불러오는 중입니다.</p>}><Content {...props} /></Suspense>; }

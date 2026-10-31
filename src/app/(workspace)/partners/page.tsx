import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { PAYMENT_TERMS, PAYMENT_METHODS } from "@/lib/payment-terms";
import { PARTNER_LABELS } from "@/lib/validation";
import { RecordForm } from "@/components/record-form";
import { Field, Select, Section } from "@/components/fields";
import { Active, EditLink, EditMeta, Empty, ListHeader, Search, listParams, type ListParams } from "@/components/master-list";
import { savePartnerAction } from "../actions";
async function Content({ searchParams }: { searchParams: Promise<ListParams> }) {
  await requireAdmin();
  const company = await requireCompany();
  const params = await searchParams;
  const { query, inactive } = listParams(params);
  const db = getDb();
  const [records, record] = await Promise.all([
    db.partner.findMany({ where: { companyId: company.id, ...(inactive ? {} : { active: true }), OR: [{ name: { contains: query, mode: "insensitive" } }, { code: { contains: query, mode: "insensitive" } }] }, orderBy: { name: "asc" }, take: 200 }),
    params.edit ? db.partner.findFirst({ where: { companyId: company.id, id: params.edit } }) : null,
  ]);
  if (params.edit && !record) notFound();
  return <><ListHeader title="거래처 관리" description="발주처와 매입처를 함께 관리합니다. 기존 거래 이력을 유지하기 위해 삭제 대신 사용 중지할 수 있습니다." saved={params.saved} />
    <div className="erp-ledger-layout">
      <Section title="거래처 목록" description="최대 200건을 표시합니다. 더 많은 자료는 검색해 주세요."><Search query={query} inactive={inactive} />{records.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="pb-3">코드·이름</th><th>구분</th><th>상태</th><th><span className="sr-only">수정</span></th></tr></thead><tbody>{records.map((p) => <tr key={p.id} className="border-t border-slate-100"><td className="py-4"><span className="block text-xs text-slate-500">{p.code}</span>{p.name}</td><td>{PARTNER_LABELS[p.type]}</td><td>{p.active ? "사용" : "중지"}</td><td><EditLink href={`/partners?edit=${p.id}`} /></td></tr>)}</tbody></table></div> : <Empty />}</Section>
      <Section title={record ? "거래처 수정" : "새 거래처"}><RecordForm key={record ? `${record.id}-${record.version}` : randomUUID()} action={savePartnerAction}><EditMeta record={record} />
        <Field label="거래처 코드" name="code" required maxLength={30} defaultValue={record?.code ?? ""} /><Field label="거래처명" name="name" required maxLength={100} defaultValue={record?.name ?? ""} />
        <Select label="구분" name="type" defaultValue={record?.type ?? "BOTH"}>{Object.entries(PARTNER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
        <Field label="담당자" name="contact" maxLength={100} defaultValue={record?.contact ?? ""} /><Field label="비고" name="note" maxLength={500} defaultValue={record?.note ?? ""} />
        <Select label="거래처 기본 지급 조건" name="paymentTerm" defaultValue={record?.paymentTerm??"MANUAL"}>{Object.entries(PAYMENT_TERMS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select><Select label="거래처 기본 지급방법" name="paymentMethod" defaultValue={record?.paymentMethod??"UNCONFIRMED"}>{Object.entries(PAYMENT_METHODS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select><Field label="송금 은행" name="payeeBank" maxLength={50} defaultValue={record?.payeeBank??""}/><Field label="송금 계좌번호" name="payeeAccount" maxLength={40} defaultValue={record?.payeeAccount??""}/><Field label="송금 예금주" name="payeeHolder" maxLength={100} defaultValue={record?.payeeHolder??""}/><label className="flex gap-2 text-xs leading-6"><input type="checkbox" name="payeeConfirmed" defaultChecked={Boolean(record?.payeeVerifiedAt)}/>통장 사본 등으로 송금 은행·계좌번호·예금주를 확인했습니다.</label><Field label="송금정보 등록·변경 사유" name="paymentReason" maxLength={300}/><p className="text-xs text-slate-500">송금정보나 지급 조건을 바꾸면 사유를 기록합니다. 확인하지 않은 계좌는 송금 준비표에서 보류합니다.</p><Active active={record?.active} />
      </RecordForm>{record && <Link className="mt-4 block text-sm text-slate-600 underline" href="/partners">새 등록으로 돌아가기</Link>}</Section>
    </div></>;
}
export default function Partners(props: { searchParams: Promise<ListParams> }) { return <Suspense fallback={<p>거래처를 불러오는 중입니다.</p>}><Content {...props} /></Suspense>; }

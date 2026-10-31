import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { STATUS_LABELS, WORK_TYPES, formatWon } from "@/lib/validation";
import { RecordForm } from "@/components/record-form";
import { Field, Select, Section } from "@/components/fields";
import { Active, EditLink, EditMeta, Empty, ListHeader, Search, listParams, type ListParams } from "@/components/master-list";
import { saveProjectAction } from "../actions";
async function Content({ searchParams }: { searchParams: Promise<ListParams> }) {
  await requireAdmin();
  const company = await requireCompany();
  const params = await searchParams;
  const { query, inactive } = listParams(params);
  const db = getDb();
  const [records, record, clients] = await Promise.all([
    db.project.findMany({ where: { companyId: company.id, ...(inactive ? {} : { active: true }), OR: [{ name: { contains: query, mode: "insensitive" } }, { code: { contains: query, mode: "insensitive" } }] }, include: { client: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    params.edit ? db.project.findFirst({ where: { companyId: company.id, id: params.edit } }) : null,
    db.partner.findMany({ where: { companyId: company.id, type: { in: ["CLIENT", "BOTH"] } }, orderBy: { name: "asc" } }),
  ]);
  if (params.edit && !record) notFound();
  return <><ListHeader title="현장 관리" description="계약 공급가액과 발주처를 연결합니다. 이 금액은 관리용 현재 계약금액이며, 세금계산서·수금·손익과는 구분됩니다." saved={params.saved} />
    <div className="erp-ledger-layout">
      <Section title="현장 목록" description="최대 200건을 표시합니다."><Search query={query} inactive={inactive} />{records.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="pb-3">현장</th><th>상태·계약 공급가액</th><th><span className="sr-only">수정</span></th></tr></thead><tbody>{records.map((p) => <tr key={p.id} className="border-t border-slate-100"><td className="py-4 pr-3"><span className="block text-xs text-slate-500">{p.code} · {p.client?.name ?? "발주처 미지정"}</span>{p.name}<span className="mt-1 block text-xs text-slate-500">{p.workTypes.join(" · ")}</span></td><td className="pr-3"><span className="block">{STATUS_LABELS[p.status]}{!p.active && " · 사용 중지"}</span>{formatWon(p.contractAmount)}</td><td><EditLink href={`/projects?edit=${p.id}`} /><Link className="erp-row-action ml-2" href={`/project-profit/statement?project=${p.id}`}>손익계산서</Link></td></tr>)}</tbody></table></div> : <Empty />}</Section>
      <Section title={record ? "현장 수정" : "새 현장"}><RecordForm key={record ? `${record.id}-${record.version}` : randomUUID()} action={saveProjectAction}><EditMeta record={record} />
        <Field label="현장 코드" name="code" required maxLength={30} defaultValue={record?.code ?? ""} /><Field label="공사명" name="name" required maxLength={100} defaultValue={record?.name ?? ""} />
        <Select label="발주처" name="clientId" defaultValue={record?.clientId ?? ""}><option value="">미지정</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.active ? " (사용 중지)" : ""}</option>)}</Select>
        <fieldset><legend className="mb-2 text-sm font-medium">공종 (복수 선택)</legend><div className="flex flex-wrap gap-4">{WORK_TYPES.map((t) => <label key={t} className="text-sm"><input type="checkbox" name="workTypes" value={t} defaultChecked={record?.workTypes.includes(t)} className="mr-1" />{t}</label>)}</div></fieldset>
        <Select label="공사 상태" name="status" defaultValue={record?.status ?? "PLANNED"}>{Object.entries(STATUS_LABELS).map(([v, l]) => <option value={v} key={v}>{l}</option>)}</Select>
        <Field label="담당자·현장 소장" name="manager" maxLength={100} defaultValue={record?.manager ?? ""} /><Field label="현장 주소" name="address" maxLength={300} defaultValue={record?.address ?? ""} />
        <div className="grid gap-3 sm:grid-cols-2"><Field label="착공일" name="startDate" type="date" min="1900-01-01" max="2199-12-31" defaultValue={record?.startDate?.toISOString().slice(0, 10) ?? ""} /><Field label="준공 예정일" name="endDate" type="date" min="1900-01-01" max="2199-12-31" defaultValue={record?.endDate?.toISOString().slice(0, 10) ?? ""} /></div>
        <Field label="계약 공급가액 (부가세 제외, 원)" name="contractAmount" inputMode="numeric" maxLength={20} defaultValue={record?.contractAmount?.toFixed(0) ?? ""} />
        <p className="text-xs leading-5 text-slate-500">계약 변경 이력과 증빙 연결은 후속 기능입니다. 현재는 기초 계약정보를 등록합니다.</p><Active active={record?.active} />
      </RecordForm>{record && <Link className="mt-4 block text-sm text-slate-600 underline" href="/projects">새 등록으로 돌아가기</Link>}</Section>
    </div></>;
}
export default function Projects(props: { searchParams: Promise<ListParams> }) { return <Suspense fallback={<p>현장을 불러오는 중입니다.</p>}><Content {...props} /></Suspense>; }

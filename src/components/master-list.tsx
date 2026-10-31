import Link from "next/link";
export function ListHeader({ title, description, saved }: { title: string; description: string; saved?: string }) {
  return <><h1 className="erp-page-title">{title}</h1><p className="erp-page-description">{description}</p>{saved === "1" && <p role="status" className="mb-5 rounded-lg bg-green-50 p-4 text-green-800">저장했습니다.</p>}</>;
}
export function Search({ query, inactive }: { query: string; inactive: boolean }) {
  return <form className="erp-query-bar"><label className="flex-1 text-sm">이름·코드 검색<input name="q" defaultValue={query} maxLength={100} className="erp-input" /></label><label className="text-sm"><input name="inactive" type="checkbox" value="1" defaultChecked={inactive} className="mr-2" />사용 중지 포함</label><button className="erp-button erp-button-dark">검색</button></form>;
}
export function EditLink({ href }: { href: string }) { return <Link className="erp-row-action" href={href}>수정</Link>; }
export function Empty() { return <p className="py-8 text-center text-sm text-slate-500">등록된 자료가 없거나 검색 결과가 없습니다.</p>; }
export type ListParams = { q?: string; edit?: string; saved?: string; inactive?: string };
export function listParams(params: ListParams) { return { query: (params.q ?? "").slice(0, 100), inactive: params.inactive === "1" }; }
export function EditMeta({ record }: { record: { id: string; version: number } | null }) {
  return <><input type="hidden" name="id" value={record?.id ?? ""} /><input type="hidden" name="version" value={record?.version ?? 0} /></>;
}
export function Active({ active }: { active?: boolean }) { return <label className="block text-sm"><input name="active" type="checkbox" defaultChecked={active ?? true} className="mr-2" />사용 중</label>; }

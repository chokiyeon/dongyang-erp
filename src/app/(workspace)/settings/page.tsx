import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { RecordForm } from "@/components/record-form";
import { Field, Section } from "@/components/fields";
import { saveCompanyAction } from "../actions";
async function Content({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const [company, params] = await Promise.all([getCompany(), searchParams]);
  return <><h1 className="mb-2 text-3xl font-bold">회사 정보</h1><p className="mb-7 text-sm text-slate-600">단일 법인 기준입니다. 공동대표는 한 줄에 한 분씩 등록합니다.</p>{params.saved === "1" && <p role="status" className="mb-5 rounded-lg bg-green-50 p-4 text-green-800">회사 정보를 저장했습니다.</p>}
    <Section title={company ? "회사 정보 수정" : "회사 정보 등록"} description="먼저 법인을 등록하면 현장·거래처·계좌를 연결할 수 있습니다.">
      <RecordForm action={saveCompanyAction}><input type="hidden" name="version" value={company?.version ?? 0} /><Field label="법인명" name="name" required maxLength={100} defaultValue={company?.name ?? ""} />
        <label className="block text-sm font-medium">대표자<textarea name="representatives" maxLength={300} rows={3} defaultValue={company?.representatives.join("\n") ?? ""} className="mt-1 block w-full rounded-lg border border-slate-300 p-3" /></label>
      </RecordForm>
    </Section></>;
}
export default function Settings(props: { searchParams: Promise<{ saved?: string }> }) { return <Suspense fallback={<p>회사 정보를 불러오는 중입니다.</p>}><Content {...props} /></Suspense>; }

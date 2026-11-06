import {randomUUID} from 'node:crypto';
import {COMPANY_PROFILE_FIELDS} from '@/lib/company-profile';
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { RecordForm } from "@/components/record-form";
import { Field, Section } from "@/components/fields";
import { saveCompanyAction } from "../actions";
async function Content({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireAdmin();
  const [company, params] = await Promise.all([getCompany(), searchParams]);
  return <><h1 className="mb-2 text-3xl font-bold">회사 정보</h1><p className="mb-7 text-sm text-slate-600">사업자등록증에 기재된 내용을 입력합니다. 공동대표와 여러 업태·종목을 함께 기록할 수 있습니다.</p>{params.saved === "1" && <p role="status" className="mb-5 rounded-lg bg-green-50 p-4 text-green-800">회사 정보를 저장했습니다.</p>}
    <Section title={company ? "회사 정보 수정" : "회사 정보 등록"} description="먼저 법인을 등록하면 현장·거래처·계좌를 연결할 수 있습니다.">
      <RecordForm action={saveCompanyAction}><input type="hidden" name="requestId" value={randomUUID()}/><input type="hidden" name="version" value={company?.version ?? 0} /><Field label="법인명" name="name" required maxLength={100} defaultValue={company?.name ?? ""} />
        <label className="block text-sm font-medium">대표자<textarea name="representatives" maxLength={300} rows={3} defaultValue={company?.representatives.join("\n") ?? ""} className="mt-1 block w-full rounded-lg border border-slate-300 p-3" /></label>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="사업자등록번호" name="businessNumber" maxLength={30} placeholder="000-00-00000" defaultValue={company?.businessNumber??''}/><Field label="법인등록번호" name="corporateNumber" maxLength={40} placeholder="숫자 13자리 · 해당 시 입력" defaultValue={company?.corporateNumber??''}/><Field label="종사업장번호" name="registrationUnitNumber" maxLength={4} placeholder="해당 시 4자리" defaultValue={company?.registrationUnitNumber??''}/><Field label="개업연월일" name="businessStartDate" type="date" defaultValue={company?.businessStartDate?.toISOString().slice(0,10)??''}/><Field label="사업자등록증 발급일" name="registrationDate" type="date" defaultValue={company?.registrationDate?.toISOString().slice(0,10)??''}/>{COMPANY_PROFILE_FIELDS.map(([key,label,max])=><Field key={key} label={label} name={key} maxLength={max} defaultValue={company?.[key]??''}/>)}</div><Field label="회사 정보 변경 사유" name="reason" maxLength={300} placeholder="사업자등록증 확인·주소 변경 등"/>
      </RecordForm>
    </Section></>;
}
export default function Settings(props: { searchParams: Promise<{ saved?: string }> }) { return <Suspense fallback={<p>회사 정보를 불러오는 중입니다.</p>}><Content {...props} /></Suspense>; }

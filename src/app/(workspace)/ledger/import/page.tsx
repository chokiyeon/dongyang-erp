import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { LegacyLedgerImport } from "@/components/legacy-ledger-import";
import { Section } from "@/components/fields";
async function Content() {
  await requireAdmin(); const company = await requireCompany();
  const accounts = await getDb().bankAccount.findMany({ where: { companyId: company.id, active: true }, select: { id: true, label: true, bankName: true }, orderBy: [{ bankName: "asc" }, { label: "asc" }] });
  return <><h1>기존 장부 가져오기</h1><p className="erp-page-description">원본은 유지하고 시트·원본 행·이전 분류를 보관합니다. 계좌 연결과 가져올 행을 확인한 뒤 저장하세요.</p><Section title="장부 검토 · 계좌 연결 · 선택 가져오기" description="기존 장부의 날짜·구분·은행·내역·차입입금·입금·출금 형식을 지원합니다. 은행에서 받은 단일 계좌 파일은 통합 장부의 은행 엑셀 가져오기를 사용하세요."><LegacyLedgerImport accounts={accounts} /></Section></>;
}
export default function LegacyImportPage() { return <Suspense fallback={<p>가져오기 화면을 준비하는 중입니다.</p>}><Content /></Suspense>; }

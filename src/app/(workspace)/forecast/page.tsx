import { Suspense } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { requireCompany } from "@/lib/company";
import { getDb } from "@/lib/db";
import { buildForecast, koreanToday } from "@/lib/forecast";
import { BudgetSheet } from "@/components/budget-sheet";
import { buildBudgetSheet } from "@/lib/budget-sheet";
import { won } from "@/lib/cash";
import { Field, Section } from "@/components/fields";
import { RecordForm } from "@/components/record-form";
import { saveBaselineAction } from "../cash-actions";
async function Content({ searchParams }: { searchParams: Promise<{ months?: string }> }) {
  await requireAdmin();
  const company = await requireCompany();
  const params = await searchParams;
  const months = params.months === "6" ? 6 : 3;
  const db = getDb();
  const [baseline, plans, accounts, heldNotes] = await Promise.all([
    db.cashBaseline.findFirst({ where: { companyId: company.id }, orderBy: { revision: "desc" } }),
    db.cashPlan.findMany({ where: { companyId: company.id }, include: { settlements: true } }),
    db.bankAccount.findMany({ where: { companyId: company.id, active: true }, orderBy: [{ bankName: "asc" }, { label: "asc" }], select: { id: true, bankName: true, label: true, transactions: { where: { bankBalance: { not: null }, tradedDate: { lte: new Date(koreanToday()) } }, orderBy: [{ tradedDate: "desc" }, { tradedTime: "desc" }, { id: "desc" }], take: 1, select: { bankBalance: true, tradedDate: true } } } }),
    db.receivedNote.findMany({ where: { companyId: company.id, status: "HELD" }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], select: { id: true, reference: true, receivedDate: true, dueDate: true, amount: true, partner: { select: { name: true } } } }),
  ]);
  const forecast = baseline ? buildForecast(baseline, plans, months) : null;
  const budgetDays = forecast ? buildBudgetSheet(plans, forecast) : [];
  return <><h1 className="text-3xl font-bold">예산안·자금계획</h1><p className="mb-6 mt-3 text-sm leading-6 text-slate-600">수기로 확인한 기준일 종료 시점의 순잔액과 등록한 입출금만 계산합니다. 은행 실시간 잔액·전체 회계장부와 자동 대조한 금액은 아닙니다.</p>
    <div className="mb-6 flex flex-wrap gap-3"><Link href="/forecast?months=3" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">3개월</Link><Link href="/forecast?months=6" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">6개월</Link><Link href="/cash" className="px-4 py-2 text-sm text-blue-700 underline">입출금 예정·실적 관리</Link><Link href="/issued-notes" className="px-4 py-2 text-sm text-blue-700 underline">발행어음 만기 확인</Link><Link href="/received-notes" className="px-4 py-2 text-sm text-blue-700 underline">수취어음·할인 확인</Link></div>
    <div className="mb-4 border border-slate-300 bg-white px-5 py-4"><h2 className="text-center text-2xl font-bold tracking-[0.4em]">[ 예 산 안 ]</h2><div className="mt-3 flex flex-wrap justify-between gap-2 text-sm"><span>{company.name} · {forecast ? `${forecast.firstDate} ~ ${forecast.endDate}` : "기준 잔액 설정 필요"}</span><span>조회일: {koreanToday()}</span></div></div>
    <div className="budget-holdings">
      <Section title="현금 · 보유현금 및 당좌" description="계좌별 금액은 가져온 장부의 최근 잔액 참고값입니다. 실시간 조회값·기준 가용현금 합산값이 아닙니다.">
        <div className="overflow-x-auto"><table className="erp-table" data-erp-report-title="예산안 통장 현황"><thead><tr><th>은행</th><th>계좌 별칭</th><th>장부 잔액</th><th>잔액 기준일</th></tr></thead><tbody>{accounts.map(account => { const last = account.transactions[0]; return <tr key={account.id}><td>{account.bankName}</td><td>{account.label}</td><td className="text-right">{last?.bankBalance ? won(BigInt(last.bankBalance.toFixed(0))) : "확인 필요"}</td><td>{last?.tradedDate.toISOString().slice(0, 10) ?? "미등록"}</td></tr>; })}{!accounts.length && <tr><td colSpan={4}>등록된 통장이 없습니다.</td></tr>}</tbody></table></div>
        <p className="mt-3 text-sm font-semibold">기준 가용현금: {baseline ? won(BigInt(baseline.amount.toFixed(0))) : "확인 필요"}</p><p className="mt-1 text-xs text-slate-500">{baseline ? `${baseline.baseDate.toISOString().slice(0, 10)} 종료 · ${baseline.note}` : "아래에서 확인한 통장 순잔액을 설정하세요."} · 미사용 대출 한도는 합산하지 않습니다.</p>
      </Section>
      <Section title="어음 · 보유 수취어음" description="보유 액면은 현금과 구분합니다. 만기 예정은 아래 입금 내역에 연결되며, 이미 할인한 어음은 보유 목록에서 제외합니다.">
        <div className="overflow-x-auto"><table className="erp-table" data-erp-report-title="예산안 보유어음"><thead><tr><th>어음번호</th><th>거래처명</th><th>기간</th><th>금액</th></tr></thead><tbody>{heldNotes.map(note => <tr key={note.id}><td><Link href={`/received-notes?view=${note.id}`} className="underline">{note.reference}</Link></td><td>{note.partner.name}</td><td>{note.receivedDate.toISOString().slice(0, 10)} ~ {note.dueDate.toISOString().slice(0, 10)}</td><td className="text-right">{won(BigInt(note.amount.toFixed(0)))}</td></tr>)}{!heldNotes.length && <tr><td colSpan={4}>등록된 보유어음이 없습니다.</td></tr>}<tr className="font-semibold"><td>합계</td><td/><td>보유 액면</td><td className="text-right">{won(heldNotes.reduce((sum, note) => sum + BigInt(note.amount.toFixed(0)), 0n))}</td></tr></tbody></table></div>
      </Section>
    </div>
    <Section title="입금 예정액 · 지출 예정액 · 잔액" description="원본 예산안처럼 왼쪽에 입금, 오른쪽에 지출을 나란히 배치했습니다. 내용 선택 시 실제 처리·수정 화면으로 이동합니다.">
      {baseline && forecast ? <><p className="mb-3 text-sm">확정입금 기준 첫 부족일: <strong className={forecast.firstShortage ? "text-red-700" : "text-green-800"}>{forecast.firstShortage ?? "등록한 자료 범위에서 없음"}</strong></p><BudgetSheet days={budgetDays} openingBalance={BigInt(baseline.amount.toFixed(0))}/></> : <p className="py-5 text-sm text-slate-500">기준 잔액을 설정하면 입금·지출과 잔액을 표시합니다.</p>}
      <p className="mt-3 text-xs leading-6 text-slate-500">같은 날짜의 입금·지출을 나란히 표시하며 행 순서가 실제 이체 순서는 아닙니다. 맨 오른쪽은 해당 날짜 전체를 반영한 확정입금 기준 일말 잔액입니다. 예상 입금까지 포함한 잔액은 월말 행에 따로 표시합니다. 기준일 이전 미처리 예정은 기준일 다음 날로 이월하며 원래 예정일을 표시합니다.</p>
    </Section>
    <div className="mt-6">
    <Section title="월별 자금 예산안" description={forecast ? `${forecast.firstDate} ~ ${forecast.endDate} · 첫 달은 기준일 다음 날부터 계산합니다. 금액 단위: 원` : "기준 잔액을 설정한 뒤 월별 예산안을 확인할 수 있습니다."}>
      <p className="mb-4 text-sm leading-6 text-slate-600">월초 잔액 + 실제 입금 + 남은 입금 예정 − 실제 지출 − 남은 지출 예정으로 계산합니다. 일부 지급은 실제 처리액과 미지급 잔액으로 나누고, 최종 완료한 건은 남은 예정액에서 제외합니다.</p>
      <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">등록된 입출금 예정·실적을 기준으로 작성합니다. 장부에만 등록한 거래와 매입·매출 세금계산서는 자동으로 더하지 않으므로, 입출금 예정에 반영했는지 확인해 주세요. 같은 건을 중복 등록하지 않아야 합니다.</p>
      {forecast ? <div className="overflow-x-auto"><table data-erp-report-title="월별 자금 예산안" className="w-full text-right text-sm"><thead><tr>{["월", "월초 잔액", "실제 입금액", "남은 확정 입금 예정액", "남은 예상 입금 예정액", "실제 지출액", "남은 지출 예정액", "확정입금 기준 월말 잔액", "예상입금 포함 월말 잔액"].map((label) => <th key={label} className="whitespace-nowrap px-3 pb-3">{label}</th>)}</tr></thead><tbody>{forecast.monthlyRows.map((r) => <tr key={r.month} className="border-t border-slate-100"><td className="whitespace-nowrap px-3 py-4 font-semibold">{r.month}</td>{[r.openingBalance, r.actualIn, r.confirmedIn, r.estimatedIn, r.actualOut, r.expectedOut, r.confirmedBalance, r.allBalance].map((value, index) => <td key={index} className={`whitespace-nowrap px-3 ${value < 0n ? "font-semibold text-red-700" : ""}`}>{won(value)}</td>)}</tr>)}</tbody></table></div> : <p className="py-4 text-sm text-slate-500">기준 잔액이 없어 계산하지 않습니다.</p>}
      <p className="mt-3 text-xs leading-6 text-slate-500">월초 잔액은 확정입금 기준 전월말 잔액입니다. 예상입금 포함 전망은 전월의 예상입금 포함 잔액을 이어 계산합니다. 월말이 양수여도 월중 부족할 수 있으므로 아래 첫 부족일도 확인해 주세요.</p>
    </Section>
    </div>
    <div className="mt-6 erp-ledger-layout">
      <Section title={`${months}개월 잔액 전망`} description={forecast ? `${forecast.firstDate} ~ ${forecast.endDate} · 기준일 이후 실제 입출금과 남은 예정액을 반영합니다.` : "기준일과 잔액을 등록하면 계산합니다."}>
        {baseline && forecast ? <>
          <p className="mb-4 text-sm leading-6">{baseline.baseDate.toISOString().slice(0, 10)} 종료 기준: <strong>{won(BigInt(baseline.amount.toFixed(0)))}</strong><span className="block text-xs text-slate-500">확인 근거: {baseline.note}</span></p>
          <p className="mb-4 rounded-lg bg-blue-50 p-3 text-sm leading-6 text-blue-900">확정입금 기준은 예상 입금과 보유 수취어음을 제외합니다. 할인 현금화는 원래 만기 액면 대신 실제 실입금액만 반영합니다. 두 전망 모두 예상 지출을 포함하며 대출 미사용 한도는 더하지 않습니다. 일별 잔액이므로 같은 날 입출금 순서에 따른 부족 여부는 판단하지 않습니다.</p>
          {forecast.overdueCount > 0 && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">기준일 이전 미처리 예정 {forecast.overdueCount}건은 기준일 다음 날 처리되는 것으로 가정했습니다. 실제 지급·수금 여부를 확인해 주세요.</p>}
          <p className="mb-4 text-sm font-medium">확정입금 기준 첫 부족일: <span className={forecast.firstShortage ? "text-red-700" : "text-green-800"}>{forecast.firstShortage ?? "등록한 자료 범위에서 없음"}</span></p>
          <div className="overflow-x-auto"><table className="w-full text-right text-sm"><thead><tr><th className="pb-3 text-left">날짜</th><th className="px-3">남은 입금 예정</th><th className="px-3">남은 지출 예정</th><th className="px-3">실제 순입출금</th><th className="px-3">확정입금 기준 잔액</th><th className="pl-3">예상입금 포함 잔액</th></tr></thead><tbody>{forecast.rows.map((r) => <tr key={r.date} className="border-t border-slate-100"><td className="whitespace-nowrap py-4 text-left">{r.date}</td><td className="whitespace-nowrap px-3">{won(r.expectedIn)}</td><td className="whitespace-nowrap px-3">{won(r.expectedOut)}</td><td className="whitespace-nowrap px-3">{won(r.actualIn - r.actualOut)}</td><td className={`whitespace-nowrap px-3 font-semibold ${r.confirmedBalance < 0n ? "text-red-700" : ""}`}>{won(r.confirmedBalance)}</td><td className={`whitespace-nowrap pl-3 ${r.allBalance < 0n ? "text-red-700" : ""}`}>{won(r.allBalance)}</td></tr>)}</tbody></table></div>
        </> : <p className="py-8 text-sm text-slate-500">기준 잔액이 없어 예상잔액을 표시하지 않습니다. 잔액을 0원으로 가정하지 않습니다.</p>}
      </Section>
      <Section title="기준일 잔액 설정" description="8개 계좌의 실제 잔액을 합산한 순잔액을 입력합니다. 이미 사용한 마이너스는 음수 잔액에 포함하며, 미사용 대출 한도는 더하지 않습니다. 입력 이력은 보관합니다.">
        <RecordForm key={company.baselineVersion} action={saveBaselineAction} label="기준 잔액 저장"><input type="hidden" name="version" value={company.baselineVersion} /><Field label="잔액 기준일 (종료 시점)" name="baseDate" type="date" required min="1900-01-01" max={koreanToday()} defaultValue={baseline?.baseDate.toISOString().slice(0, 10) ?? koreanToday()} /><Field label="기준 순잔액 (원, 음수 가능)" name="baseAmount" required inputMode="text" maxLength={21} defaultValue={baseline?.amount.toFixed(0) ?? ""} /><Field label="잔액 확인 근거" name="baseNote" required maxLength={300} defaultValue={baseline?.note ?? ""} placeholder="예: 당일 인터넷뱅킹 8개 계좌 잔액 확인" /><p className="text-xs leading-6 text-slate-500">기준일에 이미 반영된 실제 입출금은 다시 계산하지 않습니다. 미처리 예정은 자동 완료하지 않으므로 지급 여부를 별도로 확인해야 합니다.</p></RecordForm>
      </Section>
    </div>
  </>;
}
export default function ForecastPage(props: { searchParams: Promise<{ months?: string }> }) { return <Suspense fallback={<p>자금계획을 계산하는 중입니다.</p>}><Content {...props} /></Suspense>; }

import {Suspense} from "react";
import Link from "next/link";
import {requireAdmin} from "@/lib/auth";
import {requireCompany} from "@/lib/company";
import {SalaryCalculator} from "@/components/salary-calculator";
import {Section} from "@/components/fields";
async function Content(){await requireAdmin();await requireCompany();return <><h1>급여 계산기 · 세후 → 세전</h1><p className="erp-page-description">예: 세후 250만원을 받으려면 세전 월급이 얼마여야 하는지 입력한 공제 조건으로 계산합니다. 금액은 급여대장에 저장되지 않는 계산용 결과입니다.</p><Section title="실수령액 기준 역산"><SalaryCalculator/></Section><Link className="erp-row-action mt-4" href="/payroll-payments">급여 지급 확인으로 이동</Link></>;}
export default function Page(){return <Suspense fallback={<p>급여 계산기를 준비하는 중입니다.</p>}><Content/></Suspense>;}

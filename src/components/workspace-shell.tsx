"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageActions } from "./page-actions";
import { useState } from "react";

const groups = [
  { title: "업무 현황", href: "/", items: [["/", "종합 현황"], ["/month-end-review", "월말 경리 마감 점검"]] },
  { title: "자금 관리", href: "/ledger", items: [["/ledger", "통합 입출금 장부"], ["/bank-reconciliation", "통장별 월말 잔액 대조"], ["/bank-transfers", "회사 통장 간 이체"], ["/ledger/import", "기존 장부 가져오기"], ["/ledger/classify", "미분류 묶음 정리"], ["/cash", "입출금 예정·실적"], ["/transfer-preparation", "송금 준비표"], ["/transfer-approvals", "송금 검토·구두승인"], ["/recurring-payments", "월세·공과금 정기 지급"], ["/forecast", "예산안·자금계획"], ["/issued-notes", "발행어음대장"], ["/received-notes", "수취어음·할인 관리"]] },
  { title: "매입·매출", href: "/trades", items: [["/trades", "매입·매출 자료"], ["/receivables", "미수·미지급 현황"], ["/tax-summary", "부가세 추정"], ["/corporate-tax", "법인세·지방소득세 추정"], ["/accounting-delivery", "회계 전달·인수인계"]] },
  { title: "공사 관리", href: "/projects", items: [["/projects", "현장 관리"], ["/project-costs", "현장별 지급 현황"], ["/project-budgets", "현장별 지급예산"], ["/project-profit", "준공 예상 손익"], ["/source-costs", "총원가 확인·공사 배부"]] },
  { title: "인사·급여", href: "/payroll-review", items: [["/employees", "직원·계약 단가"], ["/work-records", "현장 출역·공수"], ["/payroll-review", "급여대장·월별 검토"], ["/payroll-payments", "급여 지급 확인"], ["/payroll-statements", "급여명세서 모아 저장"], ["/payroll-reporting", "급여 신고·회사 부담분"], ["/salary-calculator", "급여 역산 계산기"]] },
  { title: "자재·재고", href: "/inventory", items: [["/inventory", "자재·재고 관리"]] },
  { title: "차량 관리", href: "/vehicles", items: [["/vehicles", "차량·과태료 관리"]] },
  { title: "기준정보", href: "/partners", items: [["/accounting-codes", "회계코드 관리"], ["/partners", "거래처 관리"], ["/accounts", "계좌 관리"], ["/settings", "회사 정보"], ["/documents", "증빙·원본 파일"]] },
];
export function WorkspaceShell({ companyName, logout, children }: { companyName: string; logout: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const currentPath = pathname.startsWith("/project-profit/") ? "/project-profit" : pathname;
  const [menuOpen, setMenuOpen] = useState(false);
  const group = groups.find((g) => g.items.some(([href]) => href === currentPath)) ?? groups[0];
  const current = group.items.find(([href]) => href === currentPath)?.[1] ?? "업무 화면";
  return <div className="erp-shell">
    <header className="erp-topbar">
      <Link href="/" className="erp-brand"><span className="erp-brand-mark" aria-hidden="true">D</span><span>DONGYANG <strong>ERP</strong></span></Link>
      <span className="erp-company">{companyName}</span>
      <div className="erp-user"><span className="erp-user-avatar" aria-hidden="true">관</span><span>관리자</span>{logout}</div>
    </header>
    <nav aria-label="업무 분류" className="erp-modules">{groups.map((g) => <Link key={g.href} href={g.href} aria-current={group.title === g.title ? "true" : undefined} className={group.title === g.title ? "is-active" : ""}>{g.title}</Link>)}<span className="erp-module-note">동양계전 통합 업무 시스템</span></nav>
    <div className="erp-body">
      <aside className={`erp-sidebar ${menuOpen ? "is-open" : ""}`}>
        <button className="erp-menu-toggle" aria-expanded={menuOpen} aria-controls="erp-side-menu" onClick={() => setMenuOpen(!menuOpen)}>업무 메뉴 <span aria-hidden="true">{menuOpen ? "−" : "+"}</span></button>
        <div id="erp-side-menu" className="erp-side-menu">
          <div className="erp-sidebar-title">경리 업무<span>ACCOUNTING</span></div>
          <nav aria-label="주요 메뉴">{groups.map((g) => <div className="erp-menu-group" key={g.title}><p>{g.title}</p>{g.items.map(([href, label]) => <Link onClick={() => setMenuOpen(false)} aria-current={currentPath === href ? "page" : undefined} href={href} key={href} className={currentPath === href ? "is-active" : ""}><span aria-hidden="true" className="erp-menu-square" />{label}{currentPath === href && <span className="erp-menu-arrow" aria-hidden="true">›</span>}</Link>)}</div>)}</nav>
          <div className="erp-sidebar-foot"><span className="erp-status-dot" />관리자 업무 공간<p>금액 단위: 원(KRW)</p></div>
        </div>
      </aside>
      <div className="erp-stage">
        <div className="erp-breadcrumb"><Link href="/">홈</Link><span>›</span><span>{group.title}</span><span>›</span><strong>{current}</strong></div>
        <div className="erp-page-tab"><span>{current}</span><span className="erp-page-tab-note">{companyName}</span></div>
        <PageActions companyName={companyName} />
        <main className="erp-workspace">{children}</main>
        <footer className="erp-statusbar"><span>동양계전 ERP</span><span>관리자 · 개발 환경</span></footer>
      </div>
    </div>
  </div>;
}

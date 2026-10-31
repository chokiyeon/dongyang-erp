import { Suspense } from "react";
import { redirect } from "next/navigation";
import { authConfigured, isAuthenticated } from "@/lib/auth";
import { LoginForm } from "./login-form";
async function LoginContent() {
  if (await isAuthenticated()) redirect("/");
  return <main className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-200 bg-white p-8">
    <p className="text-xs font-bold tracking-widest text-blue-700">DONGYANG</p>
    <h1 className="mt-3 text-2xl font-bold">동양계전 ERP 로그인</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600">회사 업무자료를 관리하는 관리자 전용 공간입니다.</p>
    {authConfigured() ? <LoginForm /> : <p role="status" className="mt-6 rounded-lg bg-amber-50 p-4 text-sm leading-6 text-amber-900">관리자 접근이 아직 설정되지 않았습니다. 실행 환경에 관리자 비밀번호(ERP_ADMIN_PASSWORD)와 세션 키(ERP_SESSION_SECRET)를 설정해야 합니다.</p>}
  </main>;
}
export default function LoginPage() { return <Suspense fallback={<p className="p-8">로그인 화면을 준비하고 있습니다.</p>}><LoginContent /></Suspense>; }

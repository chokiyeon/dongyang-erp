"use client";
import { useActionState } from "react";
import { login } from "./actions";
export function LoginForm() {
  const [state, action, pending] = useActionState(login, { error: "" });
  return <form action={action} className="mt-6 space-y-4">
    <label className="block text-sm font-medium">관리자 비밀번호<input name="password" type="password" required maxLength={1024} autoComplete="current-password" className="mt-2 w-full rounded-lg border border-slate-300 p-3" /></label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending} className="w-full rounded-lg bg-blue-700 p-3 font-semibold text-white disabled:opacity-50">{pending ? "확인 중…" : "로그인"}</button>
  </form>;
}

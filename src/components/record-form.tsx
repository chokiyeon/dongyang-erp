"use client";
import { useActionState } from "react";
export type FormState = { error: string; success?: string };
export function RecordForm({ action, children, label = "저장" }: {
  action: (previous: FormState, data: FormData) => Promise<FormState>;
  children: React.ReactNode;
  label?: string;
}) {
  const [state, submit, pending] = useActionState(action, { error: "" });
  return <form action={submit} onFocusCapture={(event) => {
    document.querySelectorAll(".erp-record-form[data-erp-active]").forEach((form) => form.removeAttribute("data-erp-active"));
    event.currentTarget.setAttribute("data-erp-active", "true");
  }} onSubmit={(event) => {
    // React 19 resets uncontrolled fields after an action returns, including
    // validation errors. Keep submitted values as the reset baseline.
    for (const element of Array.from(event.currentTarget.elements)) {
      if (element instanceof HTMLInputElement && element.type !== "hidden") {
        element.defaultValue = element.value;
        element.defaultChecked = element.checked;
      } else if (element instanceof HTMLTextAreaElement) {
        element.defaultValue = element.value;
      } else if (element instanceof HTMLSelectElement) {
        const selected = Array.from(element.options, (option) => option.selected);
        Array.from(element.options).forEach((option, index) => { option.defaultSelected = selected[index]; });
      }
    }
  }} className="erp-record-form">
    {children}
    {state.success && <p role="status" className="rounded border border-green-200 bg-green-50 p-3 text-xs text-green-900">{state.success}</p>}
    {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
    <button disabled={pending} className="erp-button erp-button-primary">{pending ? "저장 중…" : label}</button>
  </form>;
}

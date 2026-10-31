import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
const control = "erp-input";
export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="erp-field"><span>{label}{props.required && <span className="erp-required"> *</span>}</span><input {...props} className={control} /></label>;
}
export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className="erp-field"><span>{label}{props.required && <span className="erp-required"> *</span>}</span><select {...props} className={control}>{children}</select></label>;
}
export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="erp-panel"><header className="erp-panel-heading"><h2>{title}</h2></header>{description && <p className="erp-panel-description">{description}</p>}<div className="erp-panel-body">{children}</div></section>;
}

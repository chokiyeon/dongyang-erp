import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { logout } from "@/app/login/actions";
import { WorkspaceShell } from "@/components/workspace-shell";
async function Workspace({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const company = await getCompany();
  return <WorkspaceShell companyName={company?.name ?? "동양계전 ERP"} logout={<form action={logout}><button className="erp-logout">로그아웃</button></form>}>{children}</WorkspaceShell>;
}
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) { return <Suspense fallback={<p className="p-8">업무 공간을 준비하고 있습니다.</p>}><Workspace>{children}</Workspace></Suspense>; }

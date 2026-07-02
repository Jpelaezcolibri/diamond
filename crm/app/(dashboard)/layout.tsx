import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "@/components/logout-button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="text-lg font-bold">💎 Diamond</span>
          <nav className="flex gap-4 text-sm">
            <Link href="/inbox" className="text-slate-600 hover:text-slate-900">
              Inbox
            </Link>
            <Link href="/kanban" className="text-slate-600 hover:text-slate-900">
              Kanban
            </Link>
            <Link href="/leads" className="text-slate-600 hover:text-slate-900">
              Leads
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

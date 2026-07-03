import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth";
import LogoutButton from "@/components/logout-button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = isSuperAdmin(user);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[#c9a24b]/30 bg-[#0b1526] px-6 py-2.5">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Diamond" className="h-9 w-9 rounded-lg" />
            <span className="text-lg font-bold tracking-wide text-[#c9a24b]">DIAMOND</span>
          </span>
          <nav className="flex gap-4 text-sm">
            <Link href="/inbox" className="text-slate-300 hover:text-[#c9a24b]">
              Inbox
            </Link>
            <Link href="/kanban" className="text-slate-300 hover:text-[#c9a24b]">
              Kanban
            </Link>
            <Link href="/leads" className="text-slate-300 hover:text-[#c9a24b]">
              Leads
            </Link>
            {admin && (
              <Link href="/usuarios" className="text-slate-300 hover:text-[#c9a24b]">
                Usuarios
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span>{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth";
import LogoutButton from "@/components/logout-button";
import NavLink from "@/components/nav-link";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = isSuperAdmin(user);

  const { count: alertCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("estado", "calificado");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[#c9a24b]/30 bg-[#0b1526] px-6 py-2.5">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Diamond" className="h-9 w-9 rounded-lg" />
            <span className="text-lg font-bold tracking-wide text-[#c9a24b]">DIAMOND</span>
          </span>
          <nav className="flex gap-1 text-sm">
            <NavLink href="/inbox">Inbox</NavLink>
            <NavLink href="/kanban">Kanban</NavLink>
            <NavLink href="/leads">Leads</NavLink>
            {admin && <NavLink href="/usuarios">Usuarios</NavLink>}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-400">
          <Link
            href="/leads"
            className="relative rounded-full p-2 text-slate-300 transition hover:bg-white/5 hover:text-[#c9a24b]"
            title="Leads calificados esperando atención"
          >
            <span className="text-lg">🔔</span>
            {!!alertCount && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {alertCount}
              </span>
            )}
          </Link>
          <span>{user.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

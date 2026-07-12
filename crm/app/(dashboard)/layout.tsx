import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import LogoutButton from "@/components/logout-button";
import NavLink from "@/components/nav-link";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = isAdmin(user);

  const { count: alertCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("estado", "calificado");

  const links = [
    { href: "/sofi", label: "SOFI" },
    { href: "/inbox", label: "Inbox" },
    { href: "/kanban", label: "Kanban" },
    { href: "/leads", label: "Leads" },
    { href: "/aliados", label: "Red de aliados" },
    ...(admin ? [{ href: "/marketing", label: "Marketing" }, { href: "/usuarios", label: "Usuarios" }] : []),
  ];

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-[#c9a24b]/30 bg-[#0b1526]">
        <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-6 lg:py-2.5">
          <div className="flex min-w-0 items-center gap-3 lg:gap-6">
            <span className="flex shrink-0 items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Diamond" className="h-8 w-8 rounded-lg sm:h-9 sm:w-9" />
              <span className="text-base font-bold tracking-wide text-[#c9a24b] sm:text-lg">DIAMOND</span>
            </span>
            <nav className="hidden gap-1 text-sm lg:flex">
              {links.map((l) => (
                <NavLink key={l.href} href={l.href}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-sm text-slate-400 sm:gap-4">
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
            <span className="hidden max-w-[14rem] truncate md:inline" title={user.email || undefined}>
              {user.email}
            </span>
            <LogoutButton />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:hidden">
          {links.map((l) => (
            <NavLink key={l.href} href={l.href}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

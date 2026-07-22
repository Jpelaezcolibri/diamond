import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import NavLink from "@/components/nav-link";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/inbox");
  const admin = isAdmin(user);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between sm:mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Marketing</h1>
      </div>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <NavLink href="/marketing">Dashboard</NavLink>
        <NavLink href="/marketing/publicaciones">Publicaciones</NavLink>
        <NavLink href="/marketing/calendario">Calendario</NavLink>
        <NavLink href="/marketing/cola">Cola</NavLink>
        <NavLink href="/marketing/plantillas">Plantillas</NavLink>
        <NavLink href="/marketing/analytics">Analytics</NavLink>
        {admin && <NavLink href="/marketing/configuracion">Configuración</NavLink>}
      </nav>
      {children}
    </div>
  );
}

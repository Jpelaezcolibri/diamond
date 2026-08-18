import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { fetchSafe } from "@/lib/fetch-safe";
import { type Conversation } from "@/lib/types";
import EquipoList from "@/components/equipo-list";
import ErrorBanner from "@/components/error-banner";

export const dynamic = "force-dynamic";

// Panel de admin (Juan, 2026-08-18): conversaciones entre Sofi y el EQUIPO —
// avisos del radar, reenvíos de Sofi-Comando, recordatorios — separadas del
// Inbox, que es solo clientes. Antes de esto, un mensaje de Sofi a un asesor
// (o una prueba tecnica) no quedaba visible en ningun lado: se mandaba
// directo por WhatsApp sin pasar por conversations/messages. Ver
// src/lib/mensaje-asesor.js, que es lo que ahora alimenta esta pantalla.
export default async function EquipoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user)) redirect("/sofi");

  const [{ data: conversations, hasError, message }, { data: advisorRows }] = await Promise.all([
    fetchSafe<Conversation>(
      // !inner: filtrar por una columna de la tabla embebida (leads.source)
      // exige el join interno en PostgREST — sin el, el .eq() se ignora y
      // trae TODAS las conversaciones, clientes incluidos.
      supabase
        .from("conversations")
        .select("*, leads!inner(*)")
        .eq("leads.source", "asesor")
        .order("last_activity_at", { ascending: false })
        .limit(200),
      "equipo:conversations"
    ),
    supabase.from("advisors").select("name, phone"),
  ]);

  // leads.nombre no se llena para estas filas (nunca pasaron por la
  // calificacion de un cliente) — sin esto la lista mostraria puros numeros
  // en vez del nombre real del asesor.
  const nombrePorTelefono: Record<string, string> = {};
  for (const a of advisorRows || []) {
    if (a.phone && !nombrePorTelefono[a.phone]) nombrePorTelefono[a.phone] = a.name;
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Equipo</h1>
      <p className="mb-5 text-sm text-slate-500">
        Conversaciones entre Sofi y el equipo — avisos del radar, reenvíos y recordatorios. Los clientes siguen en el Inbox.
      </p>
      {hasError && <ErrorBanner message={message} />}
      <EquipoList conversations={conversations} nombrePorTelefono={nombrePorTelefono} />
    </div>
  );
}

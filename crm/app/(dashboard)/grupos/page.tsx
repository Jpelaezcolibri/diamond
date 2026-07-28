import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { fetchSafe } from "@/lib/fetch-safe";
import ErrorBanner from "@/components/error-banner";
import GruposPanel, { type Grupo } from "@/components/grupos-panel";
import VincularLinea, { type Sesion, type Asesor } from "@/components/vincular-linea";

export const dynamic = "force-dynamic";

type Signal = {
  id: string;
  clase: "demanda" | "oferta";
  autor_nombre: string | null;
  operacion: string | null;
  tipo: string | null;
  zona: string | null;
  precio_max: number | null;
  habitaciones: number | null;
  texto_original: string | null;
  matches: { fuente: string; ref: string | null }[] | null;
  created_at: string;
};

const pesos = (n: number | null) =>
  n && n > 0 ? `$${n.toLocaleString("es-CO")}` : null;

function Ficha({ s }: { s: Signal }) {
  const extraido = [s.operacion, s.tipo, s.zona, s.habitaciones ? `${s.habitaciones} alc` : null, pesos(s.precio_max)]
    .filter(Boolean)
    .join(" · ");
  const matches = s.matches || [];

  return (
    <li className="border-b border-slate-100 py-3 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">{s.autor_nombre || "Colega"}</span>
        <span>{new Date(s.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span>
      </div>
      <p className="mt-0.5 text-sm text-slate-800">{s.texto_original}</p>
      {extraido && <p className="mt-1 text-xs text-slate-500">{extraido}</p>}
      {s.clase === "demanda" && (
        <p className="mt-1 text-xs">
          {matches.length === 0 ? (
            <span className="text-slate-400">sin match en inventario</span>
          ) : (
            <span className="text-emerald-700">
              {matches.length} match{matches.length > 1 ? "es" : ""}:{" "}
              {matches.map((m) => m.ref || "s/ref").join(", ")}
            </span>
          )}
        </p>
      )}
    </li>
  );
}

export default async function GruposPage() {
  const supabase = await createClient();

  // Esconder el link del menú no es control de acceso: acá se ve qué líneas
  // están vinculadas y el contenido de los grupos gremiales. Mismo guard que
  // /usuarios.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) redirect("/inbox");

  const [gruposRes, senalesRes, sesionesRes, asesoresRes] = await Promise.all([
    fetchSafe<Grupo>(
      supabase.from("whatsapp_groups").select("*").order("nombre"),
      "grupos:whatsapp_groups"
    ),
    fetchSafe<Signal>(
      supabase.from("group_signals").select("*").order("created_at", { ascending: false }).limit(100),
      "grupos:group_signals"
    ),
    fetchSafe<Sesion>(
      supabase.from("whatsapp_sessions").select("*").order("created_at"),
      "grupos:whatsapp_sessions"
    ),
    fetchSafe<Asesor>(
      supabase.from("advisors").select("id, name, phone").eq("activo", true).order("name"),
      "grupos:advisors"
    ),
  ]);

  const grupos = gruposRes.data || [];
  const senales = senalesRes.data || [];
  const demandas = senales.filter((s) => s.clase === "demanda");
  const ofertas = senales.filter((s) => s.clase === "oferta");
  const conMatch = demandas.filter((s) => (s.matches || []).length > 0).length;
  const escuchando = grupos.filter((g) => g.modo !== "ignorar").length;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Grupos de WhatsApp</h1>
      <p className="mb-6 text-sm text-slate-500">
        Sofi escucha los grupos gremiales a través de la línea vinculada de un asesor.{" "}
        <strong>Nunca escribe en ningún grupo</strong> — sólo detecta. Un grupo nuevo aparece acá
        apagado y no procesa nada hasta que lo prendas.
      </p>

      {gruposRes.hasError && <ErrorBanner message={gruposRes.message} />}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: escuchando, t: "grupos escuchados", d: `de ${grupos.length} descubiertos` },
          { n: demandas.length, t: "demandas", d: "colegas buscando" },
          { n: conMatch, t: "con match", d: "atendibles con inventario" },
          { n: ofertas.length, t: "ofertas", d: "propiedades de colegas" },
        ].map((c) => (
          <div key={c.t} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-2xl font-bold tabular-nums text-slate-900">{c.n}</p>
            <p className="text-xs font-medium text-slate-700">{c.t}</p>
            <p className="text-xs text-slate-400">{c.d}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-lg font-semibold text-slate-900">La línea</h2>
      <VincularLinea sesiones={sesionesRes.data || []} asesores={asesoresRes.data || []} />

      <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-900">Qué escucha Sofi</h2>
      <GruposPanel grupos={grupos} />

      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Pedidos de colegas</h2>
      <p className="mb-2 text-sm text-slate-500">
        Clientes de <em>otras</em> inmobiliarias, no de Diamond — no van al embudo propio.
      </p>
      {senalesRes.hasError && <ErrorBanner message={senalesRes.message} />}
      <ul className="rounded-lg border border-slate-200 bg-white px-4">
        {demandas.length === 0 ? (
          <li className="py-4 text-sm italic text-slate-400">Nada detectado todavía.</li>
        ) : (
          demandas.map((s) => <Ficha key={s.id} s={s} />)
        )}
      </ul>

      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Propiedades de colegas</h2>
      <p className="mb-2 text-sm text-slate-500">
        Nunca son inventario propio. Confirmá disponibilidad antes de ofrecerlas a un cliente.
      </p>
      <ul className="rounded-lg border border-slate-200 bg-white px-4">
        {ofertas.length === 0 ? (
          <li className="py-4 text-sm italic text-slate-400">Nada detectado todavía.</li>
        ) : (
          ofertas.map((s) => <Ficha key={s.id} s={s} />)
        )}
      </ul>
    </div>
  );
}

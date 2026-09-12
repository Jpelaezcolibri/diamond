import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { callBot } from "@/lib/bot";
import { fetchSafe, countSafe } from "@/lib/fetch-safe";
import ErrorBanner from "@/components/error-banner";
import SenalesGrupos, { type Signal } from "@/components/senales-grupos";
import AmobladosDashboard from "@/components/amoblados-dashboard";
import InventarioAmoblado, { type PropiedadArriendo } from "@/components/inventario-amoblado";
import { esAmoblada, pedidosPorRef, periodoDePropiedad, resumenSalidas, salidaDelPedido } from "@/lib/amoblados";

export const dynamic = "force-dynamic";

// Panel de amoblados (spec 2026-09-12-panel-amoblados, mockup aprobado).
// Solo pedidos de arriendo CON match, y lo que salio para cada uno. Aparte de
// /grupos "para que no se sature" (Juan).
const DIAS = 7;

type SenalArriendo = Signal & {
  aviso_wamid?: string | null;
  revalidacion?: { sirve_alguna?: boolean | null; por_que?: string | null } | null;
};

type Propiedad = {
  ref: string;
  titulo: string | null;
  zona: string | null;
  precio: string | null;
  caracteristicas: string | null;
  descripcion: string | null;
};

export default async function AmobladosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = isAdmin(user);

  // Mismo aislamiento que /grupos: un asesor ve solo lo que el observo.
  const { data: miAdvisor } = await supabase
    .from("advisors").select("id").eq("auth_user_id", user.id).limit(1).maybeSingle();
  const miAdvisorId: string | null = miAdvisor?.id ?? null;
  const mias = <T extends { eq: (c: string, v: string) => T }>(q: T): T =>
    admin || !miAdvisorId ? q : q.eq("advisor_id", miAdvisorId);

  const desde = new Date(Date.now() - DIAS * 86400e3);

  const [conMatchRes, arriendo7dRes, gruposRes, propsRes] = await Promise.all([
    fetchSafe<SenalArriendo>(
      mias(supabase.from("group_signals").select("*").eq("clase", "demanda").eq("operacion", "arriendo"))
        .neq("matches", "[]")
        .order("created_at", { ascending: false })
        .limit(200),
      "amoblados:con_match"
    ),
    countSafe(
      mias(
        supabase
          .from("group_signals")
          .select("*", { count: "exact", head: true })
          .eq("clase", "demanda")
          .eq("operacion", "arriendo")
      ).gte("created_at", desde.toISOString()),
      "amoblados:arriendo_7d"
    ),
    fetchSafe<{ id: string; nombre: string | null; jid: string }>(
      supabase.from("whatsapp_groups").select("*"),
      "amoblados:grupos"
    ),
    fetchSafe<Propiedad>(
      supabase
        .from("properties")
        .select("ref, titulo, zona, precio, caracteristicas, descripcion")
        .eq("operacion", "Arriendo")
        .eq("disponible", true),
      "amoblados:inventario"
    ),
  ]);

  const senales = conMatchRes.data;

  // El texto del aviso que recibio la asesora: messages por aviso_wamid (lo
  // guarda src/lib/mensaje-asesor.js). RLS "team read" lo deja leer.
  const wamids = [...new Set(senales.map((s) => s.aviso_wamid).filter(Boolean))] as string[];
  const avisosRes = wamids.length
    ? await fetchSafe<{ wa_message_id: string; content: string }>(
        supabase.from("messages").select("wa_message_id, content").in("wa_message_id", wamids),
        "amoblados:avisos"
      )
    : null;
  const avisoPorWamid = new Map((avisosRes?.data || []).map((m) => [m.wa_message_id, m.content]));

  // En que quedo cada oportunidad (mismo criterio que /grupos).
  const ultimoEvento = new Map<string, string>();
  if (senales.length > 0) {
    const { data: eventos } = await supabase
      .from("signal_events")
      .select("signal_id, tipo, created_at")
      .in("signal_id", senales.map((s) => s.id))
      .order("created_at", { ascending: true });
    for (const e of eventos || []) ultimoEvento.set(e.signal_id as string, e.tipo as string);
  }

  const grupoPorId = new Map(gruposRes.data.map((g) => [g.id, g]));
  const lista: Signal[] = senales.map((s) => ({
    ...s,
    grupo_nombre: grupoPorId.get(s.group_id)?.nombre ?? null,
    grupo_jid: grupoPorId.get(s.group_id)?.jid ?? null,
    ultimo_evento: ultimoEvento.get(s.id) ?? null,
    aviso_texto: s.aviso_wamid ? avisoPorWamid.get(s.aviso_wamid) ?? null : null,
    descarte_motivo:
      salidaDelPedido(s) === "descartado"
        ? s.revalidacion?.por_que || "Sofi revisó el pedido y ninguna propiedad le servía."
        : null,
  }));

  const ultimos = senales.filter((s) => new Date(s.created_at) >= desde);
  const salidas = resumenSalidas(ultimos);

  const porRef = pedidosPorRef(senales);
  const inventario: PropiedadArriendo[] = propsRes.data
    .map((p) => ({
      ref: String(p.ref),
      titulo: p.titulo,
      zona: p.zona,
      precio: p.precio,
      amoblada: esAmoblada(p),
      periodo: periodoDePropiedad(p),
      pedidos: porRef.get(String(p.ref)) ?? 0,
    }))
    .sort((a, b) => b.pedidos - a.pedidos);

  const carril = await callBot<{ activo: boolean; umbral: number }>("/api/grupos/amoblados/estado", {});

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-6 2xl:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-slate-900">Amoblados</h1>
          <p className="mt-1 max-w-[62ch] text-sm text-slate-600">
            Pedidos de arriendo de los colegas que calzan con nuestro inventario, y qué se respondió a cada uno.
          </p>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">
          {!carril.ok ? (
            <span>No se pudo consultar el carril de amoblados.</span>
          ) : carril.data.activo ? (
            <span>
              <i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
              <b>Carril encendido</b> · sale solo al colega si calza {carril.data.umbral} o más
            </span>
          ) : (
            <span>
              <i className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400 align-middle" />
              <b>Carril apagado</b> · nada sale solo al colega: todo le llega a la asesora
            </span>
          )}
        </div>
      </div>

      <AmobladosDashboard
        dias={DIAS}
        arriendo={arriendo7dRes.hasError ? null : arriendo7dRes.count}
        conMatch={ultimos.length}
        salidas={salidas}
      />
      {conMatchRes.hasError && <ErrorBanner message={conMatchRes.message} />}
      {arriendo7dRes.hasError && <ErrorBanner message={arriendo7dRes.message} />}
      {avisosRes?.hasError && <ErrorBanner message={avisosRes.message} />}
      {propsRes.hasError && <ErrorBanner message={propsRes.message} />}

      <section className="grid items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div id="pedidos" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-display text-sm font-bold text-slate-900">Pedidos con match</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{lista.length}</span>
          </div>
          <div className="px-1 py-3">
            <SenalesGrupos
              senales={lista}
              clase="demanda"
              vacio="Todavía no llegó ningún pedido de arriendo que calce con el inventario."
              embebido
            />
          </div>
        </div>
        <InventarioAmoblado propiedades={inventario} />
      </section>
    </div>
  );
}

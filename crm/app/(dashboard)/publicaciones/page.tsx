import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchSafe } from "@/lib/fetch-safe";
import { diaEnBogota } from "@/lib/fecha";
import ErrorBanner from "@/components/error-banner";
import { Kpi } from "@/components/dashboard-matches";
import ListaPublicaciones, { type FichaVista } from "@/components/publicaciones/lista-publicaciones";
import {
  agrupar,
  estadoDe,
  gruposQueResponden,
  resumen,
  sinAtender,
  visitasPorRespuesta,
  type LeadConCita,
  type Post,
  type Propiedad,
  type Respuesta,
} from "@/lib/publicaciones";

export const dynamic = "force-dynamic";

// Pestaña Publicaciones (spec 2026-10-20-publicaciones-y-respuestas §6, mockup
// aprobado docs/superpowers/mockups/2026-10-20-publicaciones-respuestas.html):
// lo que el publicador saco a los grupos y lo que respondieron los colegas por
// las tres vias. Si la migracion 2026-10-20_respuestas_publicacion.sql no ha
// corrido, las consultas fallan y la pagina se ve vacia con el aviso.

const PERIODOS = [
  { dias: 1, texto: "Hoy" },
  { dias: 7, texto: "7 días" },
  { dias: 30, texto: "30 días" },
] as const;

function desdeDe(dias: number): Date {
  // "Hoy" es desde la medianoche de Medellin (UTC-5, sin horario de verano).
  if (dias === 1) return new Date(`${diaEnBogota()}T00:00:00-05:00`);
  return new Date(Date.now() - dias * 86400e3);
}

const faltaMigracion = (m: string | null) => Boolean(m && /does not exist|could not find|schema cache/i.test(m));

export default async function PublicacionesPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { dias: diasParam } = await searchParams;
  const dias = PERIODOS.some((p) => String(p.dias) === diasParam) ? Number(diasParam) : 7;
  const desde = desdeDe(dias);
  const ahora = Date.now();

  const [postsRes, respRes, gruposRes, leadsRes] = await Promise.all([
    fetchSafe<Post>(
      supabase
        .from("grupo_publicaciones")
        .select("*")
        .eq("estado", "enviado")
        .gte("created_at", desde.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000),
      "publicaciones:posts"
    ),
    // Por el ultimo mensaje: una respuesta vieja que volvio a escribir sigue viva.
    fetchSafe<Respuesta>(
      supabase
        .from("respuestas_publicacion")
        .select("*")
        .gte("ultimo_entrante_at", desde.toISOString())
        .order("primer_at", { ascending: false })
        .limit(1000),
      "publicaciones:respuestas"
    ),
    fetchSafe<{ id: string; nombre: string | null; jid: string | null }>(
      supabase.from("whatsapp_groups").select("id, nombre, jid"),
      "publicaciones:grupos"
    ),
    // Visitas: citas de colegas (las de la linea traen origen linea_dm). El
    // filtro por ref publicada y por periodo lo hace lib/publicaciones.
    fetchSafe<LeadConCita>(
      supabase.from("leads").select("id, phone, cita").not("cita", "is", null).limit(1000),
      "publicaciones:citas"
    ),
  ]);

  const posts = postsRes.data;
  const respuestas = respRes.data;
  const refs = [...new Set([...posts, ...respuestas].map((x) => String(x.property_ref)))];
  const propsRes = refs.length
    ? await fetchSafe<Propiedad>(
        supabase.from("properties").select("ref, titulo, tipo, operacion, precio, images, disponible").in("ref", refs),
        "publicaciones:propiedades"
      )
    : null;

  const nombreGrupo: Record<string, string | null> = {};
  for (const g of gruposRes.data) nombreGrupo[g.id] = g.nombre || g.jid;

  const r = resumen(posts, respuestas, leadsRes.data, { ahora, desde });
  const conVisita = visitasPorRespuesta(respuestas, leadsRes.data);
  const fichas: FichaVista[] = agrupar(posts, respuestas, propsRes?.data ?? [], nombreGrupo).map((f) => ({
    ...f,
    respuestas: f.respuestas.map((x) => ({
      ...x,
      estado: estadoDe(x, ahora, conVisita.has(x.id)),
      grupoNombre: x.group_id ? nombreGrupo[x.group_id] ?? null : null,
    })),
  }));

  const topFichas = fichas
    .filter((f) => f.respuestas.length > 0)
    .sort((a, b) => b.respuestas.length - a.respuestas.length)
    .slice(0, 6);
  const fichasSinRespuesta = fichas.filter((f) => f.posts > 0 && f.respuestas.length === 0).length;
  const grupos = gruposQueResponden(posts, respuestas, nombreGrupo);
  const topGrupos = grupos.top.slice(0, 6);

  const periodo = dias === 1 ? "hoy" : `últimos ${dias} días`;
  const errores = [postsRes, respRes, gruposRes, leadsRes, propsRes].filter((x) => x?.hasError);
  const sinMigracion = errores.some((x) => faltaMigracion(x!.message));
  const pendientesVia = respuestas.filter((x) => sinAtender(x, ahora));
  const pendLinea = pendientesVia.filter((x) => x.via === "linea").length;
  const pendGrupo = pendientesVia.length - pendLinea;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1526] via-[#13223a] to-[#1b2b47] p-5 text-white sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(600px 220px at 85% -10%, rgba(201,162,75,.18), transparent 70%)" }}
        />
        <div className="relative">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="font-display text-xl font-bold">
              Publicaciones en grupos <span className="text-[#c9a24b]">· {periodo}</span>
            </h1>
            <nav className="inline-flex rounded-lg bg-white/10 p-0.5" aria-label="Período">
              {PERIODOS.map((p) => (
                <Link
                  key={p.dias}
                  href={`/publicaciones?dias=${p.dias}`}
                  className={`rounded-md px-3 py-1.5 text-xs sm:text-sm ${
                    p.dias === dias ? "bg-white font-semibold text-[#0b1526]" : "text-slate-300 hover:text-white"
                  }`}
                >
                  {p.texto}
                </Link>
              ))}
            </nav>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-2.5">
            <Kpi
              n={postsRes.hasError ? "—" : r.posts}
              titulo="Posts enviados"
              detalle={`${r.grupos} ${r.grupos === 1 ? "grupo" : "grupos"} · ${r.fichas} ${r.fichas === 1 ? "ficha distinta" : "fichas distintas"}`}
              tono="sky"
              href="#enviado"
            />
            <Kpi n={respRes.hasError ? "—" : r.respuestas} titulo="Respuestas" detalle="de colegas, por las 3 vías" tono="indigo" />
            <Kpi n={respRes.hasError ? "—" : r.colegas} titulo="Colegas distintos" detalle="que preguntaron por algo" tono="teal" />
            <Kpi n={leadsRes.hasError ? "—" : r.visitas} titulo="Visitas" detalle="agendadas desde un post o la línea" tono="amber" />
            <Kpi
              n={postsRes.hasError || respRes.hasError ? "—" : `${r.pctConRespuesta}%`}
              titulo="Fichas con respuesta"
              detalle={`${r.fichasConRespuesta} de ${r.fichas} publicadas`}
              tono="slate"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
            <span className="rounded-full bg-white/10 px-2.5 py-1">
              💬 Escribió a Sofi <b className="text-white">{r.porVia.sofi}</b>
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-1">
              📱 Escribió a la línea <b className="text-white">{r.porVia.linea}</b>
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-1">
              ↩️ Respondió en el grupo <b className="text-white">{r.porVia.grupo}</b>
            </span>
          </div>
          {r.sinAtender > 0 && (
            <p className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/20 px-3 py-2 text-[13px] text-rose-100">
              ⚠️{" "}
              <b className="text-white">
                {r.sinAtender} {r.sinAtender === 1 ? "respuesta sin atender" : "respuestas sin atender"}
              </b>{" "}
              hace más de 2 h
              {pendLinea > 0 && pendGrupo > 0
                ? `: ${pendLinea} en la línea y ${pendGrupo} en el grupo`
                : pendLinea > 0
                  ? ": en la línea"
                  : ": en el grupo"}
              . Abajo están marcadas en rojo.
            </p>
          )}
        </div>
      </section>

      {sinMigracion && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Falta correr la migración <code>db/migrations/2026-10-20_respuestas_publicacion.sql</code>: sin ella el CRM no
          puede leer las publicaciones ni las respuestas.
        </div>
      )}
      {errores.map((e, i) => (
        <ErrorBanner key={i} message={e!.message} />
      ))}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ListaPublicaciones fichas={fichas} totalPosts={r.posts} />

        <aside className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3.5">
            <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Fichas que más responden</h3>
            {topFichas.length === 0 && <p className="text-xs text-slate-500">Todavía ninguna ficha tiene respuestas.</p>}
            {topFichas.map((f) => (
              <Barra key={f.ref} texto={`${f.ref}${f.titulo ? ` · ${f.titulo}` : ""}`} n={f.respuestas.length} max={topFichas[0].respuestas.length} />
            ))}
            {fichasSinRespuesta > 0 && (
              <p className="text-xs text-slate-500">
                {fichasSinRespuesta} {fichasSinRespuesta === 1 ? "ficha publicada" : "fichas publicadas"} sin ninguna respuesta todavía.
              </p>
            )}
          </div>
          <div className="border-b border-slate-200 px-4 py-3.5">
            <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Grupos que más responden</h3>
            {topGrupos.length === 0 && <p className="text-xs text-slate-500">Todavía ningún grupo trajo respuestas.</p>}
            {topGrupos.map((g) => (
              <Barra key={g.nombre} texto={g.nombre} n={g.n} max={topGrupos[0].n} />
            ))}
            {grupos.sinRespuesta.length > 0 && (
              <p className="text-xs text-slate-500">
                {grupos.sinRespuesta.slice(0, 4).join(", ")}
                {grupos.sinRespuesta.length > 4 ? ` y ${grupos.sinRespuesta.length - 4} más` : ""}: 0 {periodo === "hoy" ? "hoy" : `en ${dias} días`}.
              </p>
            )}
          </div>
          <div className="px-4 py-3.5 text-[12.5px] leading-relaxed text-slate-700">
            <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Cómo se cuenta una respuesta</h3>
            <p>
              💬 <b>Sofi:</b> el colega le escribe con &quot;vi en un grupo la Ref N&quot;.
            </p>
            <p>
              📱 <b>Línea de la asesora:</b> escribe a la línea nombrando la ref, o pregunta dentro de las 48 h siguientes a un
              post en un grupo donde está.
            </p>
            <p>
              ↩️ <b>Grupo:</b> responde citando nuestro post (solo en los grupos que el radar escucha).
            </p>
            <p className="mt-1 text-xs text-slate-500">
              &quot;Sin atender&quot;: nadie le contestó en 2 h. Las visitas vienen del detector de la línea y de Sofi.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Barra({ texto, n, max }: { texto: string; n: number; max: number }) {
  return (
    <div className="mb-2 grid grid-cols-[minmax(0,1fr)_96px_24px] items-center gap-2 text-[12.5px]">
      <span className="truncate" title={texto}>
        {texto}
      </span>
      <span className="h-2 overflow-hidden rounded bg-slate-100">
        <span className="block h-full rounded bg-indigo-600" style={{ width: `${max ? Math.round((n / max) * 100) : 0}%` }} />
      </span>
      <span className="text-right font-semibold tabular-nums">{n}</span>
    </div>
  );
}

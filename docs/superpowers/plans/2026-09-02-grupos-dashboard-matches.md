# Grupos: dashboard de matches en vivo + reorganización — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar `/grupos` en el CRM con un dashboard de matches en vivo arriba, un acordeón horizontal de Grupos, y dos tablas (entrada/salida) con links visibles — más las métricas de cuánto resuelve el bot solo contra cuánto reenvía cada asesora a mano.

**Architecture:** Cambios de capa de presentación únicamente (Next.js/React en `crm/`), sobre datos que el bot (`src/`) ya genera hoy. Cada tarea agrega o modifica un componente autocontenido y sus queries correspondientes en el server component de la página (`page.tsx`). La actualización en vivo reusa el patrón ya probado en `InboxList` (Supabase Realtime + `router.refresh()`), sin librerías nuevas.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres + Realtime), Tailwind CSS.

## Global Constraints

- El filtro `mias` (definido en `page.tsx`, filtra por `advisor_id`) debe aplicarse a toda query nueva de señales/mensajes que no sea explícitamente de supervisión admin-only — mismo criterio que ya usan `mandatosRes` y `matchesEncontradosRes`.
- La sección "Mensajes por asesora" es **admin-only** (compara entre asesoras) — mismo criterio que "Matches sin entregar".
- No se modifica nada en `src/` (el bot) — todo el trabajo es en `crm/`.
- Este proyecto (`crm/`) no tiene suite de tests automatizados para componentes; la verificación de cada tarea es `npx tsc --noEmit` (desde `crm/`) + `npm run build` (desde `crm/`), ambos sin errores. No hay comando de test unitario que correr.
- Los nombres en español ya establecidos en el archivo (Grupo, Mandato, MatchPendiente, MatchEncontrado, señal, asesor) se mantienen — no traducir ni renombrar lo existente.

---

### Task 1: Dashboard — 2 KPIs nuevos (bot resolvió solo / asesora reenvió a mano)

**Files:**
- Modify: `crm/app/(dashboard)/grupos/page.tsx`

**Interfaces:**
- Produces: dos variables nuevas en el scope del componente, `autoDm: number` y `reenvioManual: number`, disponibles para el grid de KPIs.

- [ ] **Step 1: Agregar las dos queries nuevas**

En `crm/app/(dashboard)/grupos/page.tsx`, localizar el bloque `Promise.all` que ya trae `mandatosRes, matchesPendientesRes, matchesEncontradosRes` (busca `const [mandatosRes, matchesPendientesRes, matchesEncontradosRes] = await Promise.all([`). Justo después de ese bloque (después de la línea `const matchesEncontrados = matchesEncontradosRes.data;`), agregar:

```ts
  // Dashboard de matches (Juan, 2026-09-02): "de esto depende la viabilidad
  // del sistema" -- cuanto resuelve el bot completamente solo (DM directo al
  // colega, sin que ninguna asesora tenga que intervenir) contra cuanto le
  // toca reenviar a mano a la asesora (sin telefono resuelto -- el aviso le
  // llega con el texto ya armado para que ella misma se lo mande al colega).
  const [autoDmRes, reenvioManualRes] = await Promise.all([
    fetchSafe<{ id: string }>(
      mias(supabase.from("group_signals").select("id").eq("respuesta_modo", "auto")),
      "grupos:auto_dm"
    ),
    fetchSafe<{ id: string }>(
      mias(
        supabase
          .from("group_signals")
          .select("id")
          .eq("politica_motivo", "sin_telefono")
          .not("aviso_advisor_id", "is", null)
      ),
      "grupos:reenvio_manual"
    ),
  ]);
  const autoDm = autoDmRes.data.length;
  const reenvioManual = reenvioManualRes.data.length;
```

**OJO:** `fetchSafe` siempre devuelve `data` como array (nunca `null` — ver `crm/lib/fetch-safe.ts`), así que `.length` directo es seguro, sin `|| []`.

- [ ] **Step 2: Agregar los dos KPIs al grid del dashboard**

Localizar el grid de KPIs (busca `mandatos activos` en el archivo). Reemplazar:

```tsx
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { n: mandatos.length, t: "mandatos activos", d: "clientes propios buscando" },
          { n: conMatch, t: "pedidos con match", d: `${pendientes} por revisar` },
          { n: matchesEncontrados.length, t: "propiedades con match", d: "ofertas que sirven a un mandato" },
          ...(admin ? [{ n: matchesPendientes.length, t: "sin entregar", d: "matches que no llegaron a la asesora" }] : []),
        ].map((c) => (
          <div key={c.t} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-2xl font-bold tabular-nums text-slate-900">{c.n}</p>
            <p className="text-xs font-medium text-slate-700">{c.t}</p>
            <p className="text-xs text-slate-400">{c.d}</p>
          </div>
        ))}
      </div>
```

Por:

```tsx
      <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { n: mandatos.length, t: "mandatos activos", d: "clientes propios buscando" },
          { n: conMatch, t: "pedidos con match", d: `${pendientes} por revisar` },
          { n: matchesEncontrados.length, t: "propiedades con match", d: "ofertas que sirven a un mandato" },
          { n: autoDm, t: "bot resolvió solo", d: "DM directo al colega, sin asesora" },
          { n: reenvioManual, t: "asesora reenvió a mano", d: "sin teléfono resuelto" },
          ...(admin ? [{ n: matchesPendientes.length, t: "sin entregar", d: "matches que no llegaron a la asesora" }] : []),
        ].map((c) => (
          <div key={c.t} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-2xl font-bold tabular-nums text-slate-900">{c.n}</p>
            <p className="text-xs font-medium text-slate-700">{c.t}</p>
            <p className="text-xs text-slate-400">{c.d}</p>
          </div>
        ))}
      </div>
      {autoDm + reenvioManual > 0 && (
        <p className="mb-6 text-xs text-slate-400">
          {autoDm} de {autoDm + reenvioManual} pedidos con teléfono ubicable los resolvió el bot
          solo, sin que nadie tuviera que escribirle a un colega.
        </p>
      )}
```

**OJO:** el `<div className="mb-6 grid...">` original cambia a `className="mb-2 grid..."` (el `mb-6` se mueve al párrafo de contexto que ahora es el último elemento del bloque). Si no hay pedidos todavía (`autoDm + reenvioManual === 0`), no se muestra el párrafo de contexto — no tiene nada que decir con 0/0.

- [ ] **Step 3: Verificar**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

Run (desde `crm/`): `npm run build`
Expected: build limpio, sin errores, ruta `/grupos` compilada.

- [ ] **Step 4: Commit**

```bash
git add crm/app/\(dashboard\)/grupos/page.tsx
git commit -m "feat(crm): dashboard de matches agrega bot-resolvio-solo y reenvio-manual"
```

---

### Task 2: Mensajes por asesora (panel admin-only)

**Files:**
- Create: `crm/components/mensajes-por-asesora-panel.tsx`
- Modify: `crm/app/(dashboard)/grupos/page.tsx`

**Interfaces:**
- Produces: `MensajesPorAsesora` (type) y `MensajesPorAsesoraPanel({ filas }: { filas: MensajesPorAsesora[] })` (componente), exportados desde el archivo nuevo.
- Consumes: nada de tareas anteriores.

- [ ] **Step 1: Crear el componente**

Crear `crm/components/mensajes-por-asesora-panel.tsx`:

```tsx
export type MensajesPorAsesora = {
  id: string;
  nombre: string;
  entrada: number;
  reenvioManual: number;
  salida: number;
};

export function MensajesPorAsesoraPanel({ filas }: { filas: MensajesPorAsesora[] }) {
  if (filas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía ninguna asesora recibió un aviso de entrada o salida.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Asesora</th>
            <th className="px-4 py-2">Entrada</th>
            <th className="px-4 py-2">↳ reenvió a mano</th>
            <th className="px-4 py-2">Salida</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-900">{f.nombre}</td>
              <td className="px-4 py-2 text-slate-600">{f.entrada}</td>
              <td className="px-4 py-2 text-slate-600">{f.reenvioManual}</td>
              <td className="px-4 py-2 text-slate-600">{f.salida}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Agregar las queries y el cálculo en `page.tsx`**

Importar el componente nuevo junto a los demás imports de `@/components/mandatos-panel` (agregar una línea nueva, no modificar esa importación):

```ts
import { MensajesPorAsesoraPanel, type MensajesPorAsesora } from "@/components/mensajes-por-asesora-panel";
```

Localizar el bloque admin-only que ya trae `sesionesRes, asesoresRes` (busca `const [sesionesRes, asesoresRes] = admin`). Justo después de ese bloque completo (después de la línea `const gruposVivos: GrupoVivo[] = ...`), agregar:

```ts
  // Mensajes por asesora (Juan, 2026-09-02): comparación admin-only entre
  // asesoras -- mismo criterio que "Matches sin entregar", no es informacion
  // que cada asesora necesite ver de si misma en esta pantalla (su propio
  // trabajo ya se ve en el resto de la pagina).
  const [entradaPorAsesorRes, salidaPorAsesorRes, activosRes] = admin
    ? await Promise.all([
        fetchSafe<{ aviso_advisor_id: string; politica_motivo: string | null }>(
          supabase.from("group_signals").select("aviso_advisor_id, politica_motivo").not("aviso_advisor_id", "is", null),
          "grupos:entrada_por_asesor"
        ),
        fetchSafe<{ advisor_id: string }>(
          supabase.from("mandato_match_alerts").select("advisor_id").eq("entregado", true),
          "grupos:salida_por_asesor"
        ),
        fetchSafe<{ id: string; name: string }>(
          supabase.from("advisors").select("id, name").eq("activo", true),
          "grupos:advisores_activos_mensajes"
        ),
      ])
    : [null, null, null];

  const mensajesPorAsesora: MensajesPorAsesora[] = admin
    ? (activosRes?.data || [])
        .map((a) => {
          const propias = (entradaPorAsesorRes?.data || []).filter((f) => f.aviso_advisor_id === a.id);
          return {
            id: a.id,
            nombre: a.name,
            entrada: propias.length,
            reenvioManual: propias.filter((f) => f.politica_motivo === "sin_telefono").length,
            salida: (salidaPorAsesorRes?.data || []).filter((f) => f.advisor_id === a.id).length,
          };
        })
        .filter((f) => f.entrada > 0 || f.salida > 0)
    : [];
```

**OJO:** esta consulta es admin-only (no pasa por `mias`) porque el propósito de la sección es comparar entre asesoras — un no-admin nunca la ve.

- [ ] **Step 3: Renderizar la sección**

Localizar el `<h2>Dashboard de matches</h2>` y el bloque de contexto del Step 2 de la Tarea 1 (el párrafo `{autoDm} de {autoDm + reenvioManual}...`). Justo después de ese bloque (antes del `{m && (...)}`de métricas del bot), agregar:

```tsx
      {admin && mensajesPorAsesora.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Mensajes por asesora</h2>
          {entradaPorAsesorRes?.hasError && <ErrorBanner message={entradaPorAsesorRes.message} />}
          {salidaPorAsesorRes?.hasError && <ErrorBanner message={salidaPorAsesorRes.message} />}
          <MensajesPorAsesoraPanel filas={mensajesPorAsesora} />
        </div>
      )}
```

- [ ] **Step 4: Verificar**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

Run (desde `crm/`): `npm run build`
Expected: build limpio.

- [ ] **Step 5: Commit**

```bash
git add crm/components/mensajes-por-asesora-panel.tsx crm/app/\(dashboard\)/grupos/page.tsx
git commit -m "feat(crm): panel admin-only 'Mensajes por asesora' (entrada, reenvio manual, salida)"
```

---

### Task 3: Entrada — los matches arrancan abiertos (sin clic extra)

**Files:**
- Modify: `crm/components/senales-grupos.tsx`

**Interfaces:**
- Ningún cambio de props ni de tipos — un solo estado inicial cambia.

- [ ] **Step 1: Cambiar el estado inicial**

En `crm/components/senales-grupos.tsx`, dentro de la función `Ficha` (busca `function Ficha({ s, copias, grupos }`), localizar:

```ts
  const [abierta, setAbierta] = useState(false);
```

Reemplazar por:

```ts
  // Arranca abierta (Juan, 2026-09-02): "las entradas deben traer la
  // tarjeta del pedido mas los links de las propuestas, para ver cada uno
  // de los pedidos mas facil" -- un clic extra por pedido para ver que le
  // podemos ofrecer al colega no aportaba nada.
  const [abierta, setAbierta] = useState(true);
```

- [ ] **Step 2: Verificar**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

Run (desde `crm/`): `npm run build`
Expected: build limpio.

- [ ] **Step 3: Commit**

```bash
git add crm/components/senales-grupos.tsx
git commit -m "feat(crm): las tarjetas de entrada arrancan con los links de propuestas visibles"
```

---

### Task 4: Salida — link a la publicación original cuando existe

**Files:**
- Modify: `crm/app/(dashboard)/grupos/page.tsx`
- Modify: `crm/components/mandatos-panel.tsx`

**Interfaces:**
- Produces: `MatchEncontrado` (en ambos archivos, donde ya existe) gana un campo nuevo `ally_properties: { mensaje_original: string | null } | null`.
- Consumes: la relación ya existe en la base — `mandato_match_alerts.ally_property_id` referencia `ally_properties.id` (ver `db/migrations/2026-08-25_mandatos_compra.sql:75`) — Supabase/PostgREST puede traerla embebida en el mismo `select`.

- [ ] **Step 1: Ampliar el tipo `MatchEncontrado` en `mandatos-panel.tsx`**

Localizar (en `crm/components/mandatos-panel.tsx`):

```ts
export type MatchEncontrado = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  entregado_at: string | null;
  escalado_a: string | null;
  texto: string | null;
  created_at: string;
};
```

Reemplazar por:

```ts
export type MatchEncontrado = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  entregado_at: string | null;
  escalado_a: string | null;
  texto: string | null;
  created_at: string;
  ally_properties: { mensaje_original: string | null } | null;
};
```

- [ ] **Step 2: Ampliar el mismo tipo local en `page.tsx`**

Localizar (en `crm/app/(dashboard)/grupos/page.tsx`) el tipo `MatchEncontrado` local (idéntico al de arriba salvo el campo nuevo) y aplicar el mismo cambio: agregar `ally_properties: { mensaje_original: string | null } | null;` al final.

- [ ] **Step 3: Ampliar el `select` de la consulta**

En `page.tsx`, localizar la consulta de `matchesEncontradosRes` (busca `"grupos:matches_encontrados"`):

```ts
    fetchSafe<MatchEncontrado>(
      mias(
        supabase.from("mandato_match_alerts").select("*").eq("entregado", true)
          .order("created_at", { ascending: false }).limit(100)
      ),
      "grupos:matches_encontrados"
    ),
```

Reemplazar el `select("*")` por `select("*, ally_properties(mensaje_original)")`:

```ts
    fetchSafe<MatchEncontrado>(
      mias(
        supabase.from("mandato_match_alerts").select("*, ally_properties(mensaje_original)").eq("entregado", true)
          .order("created_at", { ascending: false }).limit(100)
      ),
      "grupos:matches_encontrados"
    ),
```

- [ ] **Step 4: Extraer y mostrar el link en `MatchesEncontradosPanel`**

En `crm/components/mandatos-panel.tsx`, agregar esta función justo antes de `export function MatchesEncontradosPanel`:

```ts
// El link a la publicacion (cuando el colega lo pego) solo vive dentro del
// texto crudo que compartio en el grupo -- mandato_match_alerts.texto (el
// aviso que ya se le mando a la asesora) NUNCA lo incluye.
function extraerLink(texto: string | null): string | null {
  if (!texto) return null;
  const m = texto.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}
```

Localizar dentro de `MatchesEncontradosPanel`:

```tsx
          <p className="whitespace-pre-wrap text-slate-800">{m.texto || "(sin texto guardado)"}</p>
        </div>
      ))}
    </div>
  );
}
```

Reemplazar por:

```tsx
          <p className="whitespace-pre-wrap text-slate-800">{m.texto || "(sin texto guardado)"}</p>
          {(() => {
            const link = extraerLink(m.ally_properties?.mensaje_original ?? null);
            return link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs font-medium text-blue-700 underline"
              >
                🔗 Ver publicación original
              </a>
            ) : (
              <p className="mt-1 text-xs text-slate-400">Sin link — contactá al colega directo.</p>
            );
          })()}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Verificar**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

Run (desde `crm/`): `npm run build`
Expected: build limpio.

- [ ] **Step 6: Commit**

```bash
git add crm/app/\(dashboard\)/grupos/page.tsx crm/components/mandatos-panel.tsx
git commit -m "feat(crm): salida muestra el link a la publicacion original del colega cuando existe"
```

---

### Task 5: Grupos — acordeón horizontal plegable

**Files:**
- Modify: `crm/components/grupos-panel.tsx`

**Interfaces:**
- Produces: `GruposPanel({ grupos }: { grupos: Grupo[] })` mantiene la misma firma — el cambio es solo interno (agrega estado local, ya no es un server-renderable puro).

- [ ] **Step 1: Reemplazar el componente completo**

Leer primero `crm/components/grupos-panel.tsx` completo (28-40 líneas) para confirmar que no hay nada más en el archivo aparte de lo mostrado en el diseño (§4 del spec) — si hay algo adicional (otro export, otro helper), conservarlo tal cual y aplicar el cambio solo a `GruposPanel` y su render.

Reemplazar el contenido completo del archivo por:

```tsx
"use client";

import { useState } from "react";

export type Grupo = {
  id: string;
  jid: string;
  nombre: string | null;
  modo: "ignorar" | "sombra" | "sugerir";
  responde: boolean;
  activo: boolean;
  created_at: string;
};

// De dónde salió cada grupo. El prefijo del jid lo dice: los que se crean al
// subir un export llevan "export:", el buzón de reenvíos lleva "reenvio:", y
// los que tienen un jid real de WhatsApp vienen de una línea vinculada.
function origen(jid: string) {
  if (jid.startsWith("export:")) return { etiqueta: "export", clase: "bg-sky-50 text-sky-700" };
  if (jid.startsWith("reenvio:")) return { etiqueta: "reenvío", clase: "bg-violet-50 text-violet-700" };
  return { etiqueta: "en vivo", clase: "bg-amber-50 text-amber-700" };
}

// Acordeón plegable (Juan, 2026-09-02): "los grupos en una pestaña
// desplegable a un click y que se pueda ver de manera horizontal" -- la
// lista vertical ocupaba media pantalla para algo que casi no cambia,
// desplazando las dos tablas de match que si se revisan a diario.
export default function GruposPanel({ grupos }: { grupos: Grupo[] }) {
  const [abierto, setAbierto] = useState(false);

  if (grupos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía no cargaste ningún grupo. Subí arriba el <code>.txt</code> que exporta WhatsApp
        y aparece acá.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-slate-900">
          <span className="mr-1 text-slate-400">{abierto ? "▾" : "▸"}</span>
          Grupos — {grupos.length} cargado{grupos.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-slate-400">clic para {abierto ? "ocultar" : "ver"}</span>
      </button>
      {abierto && (
        <div className="flex gap-2 overflow-x-auto border-t border-slate-100 px-4 py-3">
          {grupos.map((g) => {
            const o = origen(g.jid);
            return (
              <div key={g.id} className="min-w-[160px] shrink-0 rounded-lg border border-slate-200 p-2.5">
                <p className="truncate text-sm font-medium text-slate-900">
                  {g.nombre || "Grupo sin nombre"}
                </p>
                <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${o.clase}`}>
                  {o.etiqueta}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

Run (desde `crm/`): `npm run build`
Expected: build limpio.

- [ ] **Step 3: Commit**

```bash
git add crm/components/grupos-panel.tsx
git commit -m "feat(crm): Grupos pasa a ser un acordeon horizontal plegable"
```

---

### Task 6: Actualización en vivo (dashboard + las dos tablas)

**Files:**
- Create: `crm/components/grupos-live-watcher.tsx`
- Modify: `crm/app/(dashboard)/grupos/page.tsx`

**Interfaces:**
- Produces: `GruposLiveWatcher` (default export, sin props) — componente cliente que se monta una vez y no renderiza nada visible propio del layout salvo el badge de estado y un toast flotante.
- Consumes: `@/lib/supabase/client` (`createClient`), ya usado en `crm/components/inbox-list.tsx` con el mismo patrón — leer ese archivo primero como referencia si algo no encaja.

- [ ] **Step 1: Crear el componente**

Leer `crm/components/inbox-list.tsx` completo primero (especialmente el `useEffect` con `supabase.channel(...)`) para confirmar el import exacto de `createClient` y el patrón de limpieza (`return () => supabase.removeChannel(channel)`).

Crear `crm/components/grupos-live-watcher.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Mismo mecanismo que InboxList (Supabase Realtime + router.refresh()) --
// Juan, 2026-09-02: "que muestre en vivo el dashboard lo que va pasando en
// el motor de busqueda". router.refresh() vuelve a correr todo el server
// component (la pagina ya es force-dynamic), asi que el dashboard, la
// tabla de mensajes por asesora, y las dos tablas de entrada/salida se
// actualizan solas -- no hace falta logica de "en vivo" separada en cada una.
export default function GruposLiveWatcher() {
  const router = useRouter();
  const [estado, setEstado] = useState<"conectando" | "en_vivo" | "reconectando">("conectando");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("grupos-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_signals" }, () => {
        setToast("🔔 Nuevo pedido de un colega");
        router.refresh();
        setTimeout(() => setToast(null), 4000);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mandato_match_alerts" }, () => {
        setToast("🔔 Nueva propiedad con match");
        router.refresh();
        setTimeout(() => setToast(null), 4000);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setEstado("en_vivo");
        else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setEstado("reconectando");
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <>
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
          estado === "en_vivo" ? "text-emerald-600" : "text-amber-600"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${estado === "en_vivo" ? "bg-emerald-500" : "bg-amber-500"}`} />
        {estado === "en_vivo" ? "en vivo" : estado === "reconectando" ? "reconectando…" : "conectando…"}
      </span>
      {toast && (
        <div className="fixed right-6 top-20 z-50 rounded-xl bg-[#0b1526] px-4 py-3 text-sm font-medium text-white shadow-xl ring-1 ring-[#c9a24b]/40">
          {toast}
        </div>
      )}
    </>
  );
}
```

**OJO:** si `crm/lib/supabase/client.ts` (o `.tsx`) no exporta `createClient` con esa firma exacta, adaptar el import al que realmente use `inbox-list.tsx` — no inventar una firma distinta.

- [ ] **Step 2: Montar el watcher junto al encabezado del dashboard**

En `crm/app/(dashboard)/grupos/page.tsx`, importar el componente nuevo:

```ts
import GruposLiveWatcher from "@/components/grupos-live-watcher";
```

Localizar:

```tsx
      <h2 className="mb-1 text-lg font-semibold text-slate-900">Dashboard de matches</h2>
      <p className="mb-2 text-sm text-slate-500">
```

Reemplazar la línea del `<h2>` por:

```tsx
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Dashboard de matches</h2>
        <GruposLiveWatcher />
      </div>
      <p className="mb-2 text-sm text-slate-500">
```

- [ ] **Step 3: Verificar**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

Run (desde `crm/`): `npm run build`
Expected: build limpio.

- [ ] **Step 4: Commit**

```bash
git add crm/components/grupos-live-watcher.tsx crm/app/\(dashboard\)/grupos/page.tsx
git commit -m "feat(crm): dashboard de matches se actualiza en vivo (Supabase Realtime)"
```

---

### Task 7: Deploy y verificación

**Files:** ninguno (push + verificación operativa)

- [ ] **Step 1: Push a main**

```bash
git push origin main
```

- [ ] **Step 2: Verificar el deploy en Vercel**

El CRM despliega a Vercel vía integración de GitHub (no vía `vercel` CLI local — el `vercel whoami`/`vercel ls` de esta máquina no muestra el proyecto Diamond, pertenece a otra cuenta/team). Verificar por alguno de estos medios:
- Pedirle a Juan que confirme visualmente en `crm.diamondinmobiliaria.com/grupos` (login de admin) — es el único checkpoint real posible, esta sesión no tiene credenciales del CRM.
- Si hay acceso al dashboard de Vercel del proyecto correcto, confirmar ahí que el deploy del commit final de este plan quedó `Ready`.

- [ ] **Step 3: Checklist de verificación manual (para quien tenga acceso al CRM)**

- Dashboard muestra 5 (o 6 si admin) KPIs, incluyendo "bot resolvió solo" y "asesora reenvió a mano" con números > 0.
- Badge "en vivo" aparece en verde junto al título del dashboard.
- Sección "Mensajes por asesora" visible solo para admin, con al menos Natalia y Catherine listadas.
- Grupos aparece plegado por defecto; un clic lo abre en una fila horizontal con scroll.
- "Match: pedidos de colegas" (entrada) muestra los links de las propiedades sin necesidad de hacer clic para expandir.
- "Match: propiedades de colegas" (salida) muestra "🔗 Ver publicación original" cuando el mensaje del colega traía un link, o "Sin link — contactá al colega directo" cuando no.
- Reportar cualquier desviación a Juan antes de dar la tarea por cerrada.

---

## Self-Review

**Cobertura del spec:** §2 dashboard (Task 1) · §3 mensajes por asesora (Task 2) · §4 grupos acordeón (Task 5) · §5 entrada con links (Task 3) · §6 salida con link (Task 4) · §7 en vivo (Task 6) · §8 "qué no cambia" (verificado: Mandatos/Sin-entregar no se tocan, `mias` se respeta en cada query nueva excepto la explícitamente admin-only de Task 2) · §9 testing (cada tarea verifica tsc+build, verificación manual en Task 7).

**Placeholders:** ninguno — cada step trae el código completo a aplicar.

**Consistencia de tipos:** `MatchEncontrado` se amplía IDÉNTICO en los dos archivos donde existe (`page.tsx` y `mandatos-panel.tsx`) en la Tarea 4 — mismo campo, mismo tipo. `MensajesPorAsesora` se define una sola vez (en el componente nuevo de la Tarea 2) y se consume con ese mismo tipo en `page.tsx`. `GruposLiveWatcher` no recibe props, consistente entre su definición y su uso en la Tarea 6.

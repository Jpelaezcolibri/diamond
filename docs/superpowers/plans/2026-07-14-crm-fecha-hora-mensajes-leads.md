# CRM: fecha y hora estilo WhatsApp (leads y mensajes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en las 4 vistas del CRM (chat, lista de conversaciones, kanban, tabla de leads) la fecha y hora de ingreso y de última actividad, con presentación tipo WhatsApp (separadores de día en el chat, tooltips de fecha completa en el resto).

**Architecture:** Solo lectura y presentación sobre datos que ya existen en Supabase (`leads.created_at`, `messages.created_at`, `conversations.last_activity_at`, todos `timestamptz`). Dos helpers nuevos de formato en `crm/lib/types.ts`; en `leads/page.tsx` y `kanban/page.tsx` se agrega una consulta a `conversations` para construir un mapa `lastActivityByLead`; los componentes de cada vista reciben ese dato y lo renderizan con `title=` para el tooltip nativo del navegador.

**Tech Stack:** Next.js 15 (App Router, server components) + React 19 + TypeScript, Supabase JS client, Tailwind 4. Sin librería de fechas — funciones nativas `Date`/`Intl` (mismo patrón que `relativeTime` existente).

## Global Constraints

- Spec de referencia: [docs/superpowers/specs/2026-07-14-crm-fecha-hora-mensajes-leads-design.md](../specs/2026-07-14-crm-fecha-hora-mensajes-leads-design.md).
- Sin cambios de schema ni migraciones — todos los timestamps ya se persisten hoy.
- Todos los comandos de este plan se ejecutan con `crm/` como working directory (proyecto Next.js separado, ver `crm/package.json`).
- `crm/` no tiene framework de tests configurado (`package.json` solo define `dev`, `build`, `start`, `lint`). La verificación de cada tarea es, en este orden: `npx tsc --noEmit` (chequeo de tipos, `typescript` ya está en `devDependencies`), luego verificación manual en el navegador con el dev server (`npm run dev`, puerto 3100), y `npm run lint` al cerrar la última tarea.
- Sin nuevas dependencias de npm.
- Todo el código nuevo en inglés (nombres) con UI en español, igual que el resto del repo.

---

### Task 1: Helpers de formato de fecha/hora

**Files:**
- Modify: `crm/lib/types.ts:160-169` (después de la función `relativeTime` existente)

**Interfaces:**
- Produces: `absoluteDateTime(iso: string): string`, `dayLabel(iso: string): string` — usadas por las Tasks 2-5.

- [ ] **Step 1: Agregar los dos helpers al final de `crm/lib/types.ts`**

Agregar este bloque al final del archivo (después de la función `relativeTime`, que termina en la línea 169):

```ts
export function absoluteDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function dayLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return "Hoy";
    if (diffDays === 1) return "Ayer";
    return d.toLocaleDateString("es-CO", {
      day: "numeric",
      month: "long",
      ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    });
  } catch {
    return "";
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores nuevos relacionados a `lib/types.ts` (el archivo no se usa todavía en ninguna vista, así que no debería haber ningún error).

- [ ] **Step 3: Commit**

```bash
git add crm/lib/types.ts
git commit -m "feat(crm): helpers de fecha absoluta y separador de día tipo WhatsApp"
```

---

### Task 2: Separadores de día y tooltip de hora en el chat

**Files:**
- Modify: `crm/components/chat-view.tsx:1-14` (imports y función `hora`)
- Modify: `crm/components/chat-view.tsx:203-237` (bloque `messages.map`)

**Interfaces:**
- Consumes: `absoluteDateTime(iso: string): string`, `dayLabel(iso: string): string` de `crm/lib/types.ts` (Task 1).

- [ ] **Step 1: Importar los helpers nuevos**

En `crm/components/chat-view.tsx:6`, reemplazar:

```ts
import { ESTADO_COLORS, ESTADO_LABELS, type Conversation, type Message } from "@/lib/types";
```

por:

```ts
import { ESTADO_COLORS, ESTADO_LABELS, absoluteDateTime, dayLabel, type Conversation, type Message } from "@/lib/types";
```

- [ ] **Step 2: Agregar el componente `DaySeparator`**

Justo después de la función `hora` (línea 14, antes de `function MediaContent`), agregar:

```tsx
function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-lg bg-white/90 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
        {label}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Insertar el separador de día y el tooltip de hora en el bloque de mensajes**

En `crm/components/chat-view.tsx`, reemplazar el bloque completo (líneas 203-237):

```tsx
        {messages.map((m) => {
          const mine = m.role === "assistant";
          const quoted = m.reply_to_id ? byId.get(m.reply_to_id) : null;
          return (
            <div key={m.id} className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`relative max-w-[78%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
                  mine ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
                }`}
              >
                {quoted && (
                  <div className="mb-1 rounded border-l-4 border-emerald-500 bg-black/5 px-2 py-1 text-xs text-slate-600">
                    <span className="font-semibold">{quoted.role === "user" ? lead?.nombre || "Cliente" : "Diamond"}: </span>
                    {(quoted.content || "").slice(0, 90)}
                  </div>
                )}
                <MediaContent m={m} />
                {m.content && !(m.type && m.type !== "text" && m.content.startsWith("[")) && (
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                )}
                <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                  {hora(m.created_at)}
                  {mine && <span className="text-sky-500">✓✓</span>}
                </div>
                <button
                  onClick={() => setReplyTo(m)}
                  title="Responder"
                  className="absolute -top-2 right-1 hidden rounded-full border border-slate-200 bg-white px-1.5 text-xs shadow group-hover:block"
                >
                  ↩
                </button>
              </div>
            </div>
          );
        })}
```

por:

```tsx
        {messages.map((m, i) => {
          const mine = m.role === "assistant";
          const quoted = m.reply_to_id ? byId.get(m.reply_to_id) : null;
          const prev = messages[i - 1];
          const showDaySeparator =
            !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
          return (
            <div key={m.id}>
              {showDaySeparator && <DaySeparator label={dayLabel(m.created_at)} />}
              <div className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`relative max-w-[78%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
                    mine ? "rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
                  }`}
                >
                  {quoted && (
                    <div className="mb-1 rounded border-l-4 border-emerald-500 bg-black/5 px-2 py-1 text-xs text-slate-600">
                      <span className="font-semibold">{quoted.role === "user" ? lead?.nombre || "Cliente" : "Diamond"}: </span>
                      {(quoted.content || "").slice(0, 90)}
                    </div>
                  )}
                  <MediaContent m={m} />
                  {m.content && !(m.type && m.type !== "text" && m.content.startsWith("[")) && (
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  )}
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span title={absoluteDateTime(m.created_at)}>{hora(m.created_at)}</span>
                    {mine && <span className="text-sky-500">✓✓</span>}
                  </div>
                  <button
                    onClick={() => setReplyTo(m)}
                    title="Responder"
                    className="absolute -top-2 right-1 hidden rounded-full border border-slate-200 bg-white px-1.5 text-xs shadow group-hover:block"
                  >
                    ↩
                  </button>
                </div>
              </div>
            </div>
          );
        })}
```

- [ ] **Step 4: Verificar tipos**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Verificación manual en el navegador**

1. Iniciar el dev server: `npm run dev` (desde `crm/`, puerto 3100).
2. Abrir `http://localhost:3100/inbox` e ingresar a una conversación con mensajes de más de un día (o enviar un mensaje de prueba hoy si todos son del mismo día, para al menos confirmar que aparece un separador "Hoy" al inicio).
3. Confirmar que aparece una etiqueta centrada ("Hoy", "Ayer" o una fecha) antes del primer mensaje de cada día distinto.
4. Pasar el mouse sobre la hora de una burbuja y confirmar que el tooltip nativo muestra fecha y hora completas.

- [ ] **Step 6: Commit**

```bash
git add crm/components/chat-view.tsx
git commit -m "feat(crm): separadores de día y tooltip de fecha completa en el chat"
```

---

### Task 3: Tooltip de fecha completa en la lista de conversaciones

**Files:**
- Modify: `crm/components/inbox-list.tsx:7` (import)
- Modify: `crm/components/inbox-list.tsx:95` (span de tiempo relativo)

**Interfaces:**
- Consumes: `absoluteDateTime(iso: string): string` de `crm/lib/types.ts` (Task 1).

- [ ] **Step 1: Importar el helper**

En `crm/components/inbox-list.tsx:7`, reemplazar:

```ts
import { ESTADO_COLORS, ESTADO_LABELS, ESTADO_DOT, relativeTime, type Conversation } from "@/lib/types";
```

por:

```ts
import { ESTADO_COLORS, ESTADO_LABELS, ESTADO_DOT, relativeTime, absoluteDateTime, type Conversation } from "@/lib/types";
```

- [ ] **Step 2: Agregar el tooltip**

En `crm/components/inbox-list.tsx:95`, reemplazar:

```tsx
                  <span className="text-xs text-slate-400">{relativeTime(c.last_activity_at)}</span>
```

por:

```tsx
                  <span className="text-xs text-slate-400" title={absoluteDateTime(c.last_activity_at)}>
                    {relativeTime(c.last_activity_at)}
                  </span>
```

- [ ] **Step 3: Verificar tipos**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Verificación manual en el navegador**

1. Con el dev server corriendo, abrir `http://localhost:3100/inbox`.
2. Pasar el mouse sobre el texto "hace X min/h/d" de cualquier conversación de la lista.
3. Confirmar que el tooltip nativo muestra la fecha y hora completas de esa conversación.

- [ ] **Step 5: Commit**

```bash
git add crm/components/inbox-list.tsx
git commit -m "feat(crm): tooltip de fecha completa en la lista de conversaciones"
```

---

### Task 4: Fecha de ingreso y última actividad en el Kanban

**Files:**
- Modify: `crm/app/(dashboard)/kanban/page.tsx` (query + prop nueva)
- Modify: `crm/components/kanban-board.tsx` (props en cascada + render en `LeadCard`)

**Interfaces:**
- Consumes: `relativeTime(iso: string): string`, `absoluteDateTime(iso: string): string` de `crm/lib/types.ts` (Task 1); `Lead.created_at` (ya existe en `crm/lib/types.ts`).
- Produces: `KanbanBoard` acepta una prop nueva `lastActivityByLead: Record<string, string>`.

- [ ] **Step 1: Ampliar la consulta y construir `lastActivityByLead` en `kanban/page.tsx`**

Reemplazar el contenido completo de `crm/app/(dashboard)/kanban/page.tsx` por:

```tsx
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getTeamRoster } from "@/lib/team";
import type { Lead } from "@/lib/types";
import KanbanBoard from "@/components/kanban-board";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);

  const [{ data: leads }, { data: convs }, roster] = await Promise.all([
    supabase.from("leads").select("*").order("updated_at", { ascending: false }).limit(500),
    supabase.from("conversations").select("id, lead_id, estado, last_activity_at"),
    getTeamRoster(),
  ]);

  const convByLead: Record<string, string> = {};
  const lastActivityByLead: Record<string, string> = {};
  (convs || []).forEach((c) => {
    if (c.estado === "activa" && !convByLead[c.lead_id]) convByLead[c.lead_id] = c.id;
    if (!lastActivityByLead[c.lead_id] || c.last_activity_at > lastActivityByLead[c.lead_id]) {
      lastActivityByLead[c.lead_id] = c.last_activity_at;
    }
  });

  return (
    <KanbanBoard
      initialLeads={(leads || []) as Lead[]}
      convByLead={convByLead}
      lastActivityByLead={lastActivityByLead}
      admin={admin}
      roster={roster}
      currentUserId={user?.id || ""}
    />
  );
}
```

Nota: se quita el filtro `.eq("estado", "activa")` de la consulta a `conversations` porque `lastActivityByLead` debe reflejar la última actividad real del lead aunque su conversación se haya marcado `cerrada` (ver `src/data/conversations.js:96`); `convByLead` (usado para el link "Ver chat") sigue construyéndose solo con conversaciones `activa`, igual que antes.

- [ ] **Step 2: Propagar las props nuevas en `kanban-board.tsx`**

En `crm/components/kanban-board.tsx`, reemplazar la firma y el cuerpo de `LeadCard` (líneas 22-75):

```tsx
function LeadCard({
  lead,
  convId,
  lastActivity,
  dragging = false,
  roster,
  currentUserId,
  admin,
}: {
  lead: Lead;
  convId?: string;
  lastActivity?: string;
  dragging?: boolean;
  roster: Record<string, TeamMember>;
  currentUserId: string;
  admin: boolean;
}) {
  const t = scoreTemperature(lead.score);
  return (
    <div
      className={`rounded-xl border border-l-4 border-slate-200 bg-white p-3 text-sm shadow-sm transition ${t.border} ${
        dragging ? "rotate-2 shadow-xl" : "hover:shadow-md"
      }`}
    >
      <div className="flex items-center gap-2">
        <Avatar name={lead.nombre} phone={lead.phone} size={28} />
        <p className="flex-1 truncate font-semibold text-slate-900">{lead.nombre || `+${lead.phone}`}</p>
        <ScoreBadge score={lead.score} />
      </div>
      <p className="mt-1.5 truncate text-xs text-slate-500">
        {[lead.property_ref_origen, lead.forma_pago, lead.urgencia].filter(Boolean).join(" · ") ||
          lead.tipo_interes ||
          "sin datos"}
      </p>
      <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
        <span title={absoluteDateTime(lead.created_at)}>Ingreso: {relativeTime(lead.created_at)}</span>
        {lastActivity && <span title={absoluteDateTime(lastActivity)}>· Act.: {relativeTime(lastActivity)}</span>}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <OwnerBadge
          leadId={lead.id}
          ownerId={lead.owner_id}
          ownerAssignedAt={lead.owner_assigned_at}
          roster={roster}
          currentUserId={currentUserId}
          admin={admin}
        />
        {convId && (
          <Link
            href={`/inbox/${convId}`}
            className="shrink-0 text-xs font-medium text-emerald-700 hover:underline"
            onPointerDown={(e) => e.stopPropagation()}
          >
            Ver chat →
          </Link>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  lead,
  convId,
  lastActivity,
  editable,
  roster,
  currentUserId,
  admin,
}: {
  lead: Lead;
  convId?: string;
  lastActivity?: string;
  editable: boolean;
  roster: Record<string, TeamMember>;
  currentUserId: string;
  admin: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, disabled: !editable });
  return (
    <div
      ref={setNodeRef}
      {...(editable ? listeners : {})}
      {...attributes}
      className={`touch-none ${editable ? "cursor-grab active:cursor-grabbing" : "cursor-default opacity-90"} ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <LeadCard lead={lead} convId={convId} lastActivity={lastActivity} roster={roster} currentUserId={currentUserId} admin={admin} />
    </div>
  );
}
```

- [ ] **Step 3: Propagar en `Column`**

En `crm/components/kanban-board.tsx`, reemplazar la firma y el cuerpo de `Column` (líneas 107-155):

```tsx
function Column({
  estado,
  leads,
  convByLead,
  lastActivityByLead,
  roster,
  currentUserId,
  admin,
}: {
  estado: string;
  leads: Lead[];
  convByLead: Record<string, string>;
  lastActivityByLead: Record<string, string>;
  roster: Record<string, TeamMember>;
  currentUserId: string;
  admin: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: estado });
  const theme = ESTADO_COLUMN_THEME[estado] || ESTADO_COLUMN_THEME.nuevo;
  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-2xl border-t-4 p-2.5 transition ${theme.border} ${
        isOver ? "bg-[#c9a24b]/10 ring-2 ring-[#c9a24b]" : theme.bg
      }`}
    >
      <p className={`mb-2 flex items-center justify-between px-1 text-xs font-bold uppercase tracking-wide ${theme.header}`}>
        {ESTADO_LABELS[estado]}
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] shadow-sm">{leads.length}</span>
      </p>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {leads.map((l) => (
          <DraggableCard
            key={l.id}
            lead={l}
            convId={convByLead[l.id]}
            lastActivity={lastActivityByLead[l.id]}
            editable={admin || !l.owner_id || l.owner_id === currentUserId}
            roster={roster}
            currentUserId={currentUserId}
            admin={admin}
          />
        ))}
        {leads.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300/70 bg-white/50 p-4 text-center text-xs text-slate-400">
            Arrastra leads aquí
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Propagar en `KanbanBoard` (firma, `Column` y `DragOverlay`)**

En `crm/components/kanban-board.tsx:157-170`, reemplazar la firma de `KanbanBoard`:

```tsx
export default function KanbanBoard({
  initialLeads,
  convByLead,
  lastActivityByLead,
  admin,
  roster,
  currentUserId,
}: {
  initialLeads: Lead[];
  convByLead: Record<string, string>;
  lastActivityByLead: Record<string, string>;
  admin: boolean;
  roster: Record<string, TeamMember>;
  currentUserId: string;
}) {
```

En el bloque `DndContext` (líneas 256-273), reemplazar:

```tsx
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          {ESTADOS.map((estado) => (
            <Column
              key={estado}
              estado={estado}
              leads={byEstado[estado] || []}
              convByLead={convByLead}
              roster={roster}
              currentUserId={currentUserId}
              admin={admin}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? <LeadCard lead={active} dragging roster={roster} currentUserId={currentUserId} admin={admin} /> : null}
        </DragOverlay>
      </DndContext>
```

por:

```tsx
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          {ESTADOS.map((estado) => (
            <Column
              key={estado}
              estado={estado}
              leads={byEstado[estado] || []}
              convByLead={convByLead}
              lastActivityByLead={lastActivityByLead}
              roster={roster}
              currentUserId={currentUserId}
              admin={admin}
            />
          ))}
        </div>
        <DragOverlay>
          {active ? (
            <LeadCard
              lead={active}
              lastActivity={lastActivityByLead[active.id]}
              dragging
              roster={roster}
              currentUserId={currentUserId}
              admin={admin}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
```

- [ ] **Step 5: Actualizar el import de helpers en `kanban-board.tsx`**

En `crm/components/kanban-board.tsx:16`, reemplazar:

```ts
import { CATEGORIAS, ESTADOS, ESTADO_LABELS, ESTADO_COLUMN_THEME, scoreTemperature, type Lead } from "@/lib/types";
```

por:

```ts
import { CATEGORIAS, ESTADOS, ESTADO_LABELS, ESTADO_COLUMN_THEME, scoreTemperature, relativeTime, absoluteDateTime, type Lead } from "@/lib/types";
```

- [ ] **Step 6: Verificar tipos**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Verificación manual en el navegador**

1. Con el dev server corriendo, abrir `http://localhost:3100/kanban`.
2. Confirmar que cada tarjeta muestra una línea "Ingreso: hace X" (y "· Act.: hace X" si el lead tiene conversación).
3. Pasar el mouse sobre esa línea y confirmar el tooltip con fecha/hora completas.
4. Arrastrar una tarjeta a otra columna y confirmar que sigue funcionando igual que antes (el drag no debe romperse por las props nuevas).

- [ ] **Step 8: Commit**

```bash
git add "crm/app/(dashboard)/kanban/page.tsx" crm/components/kanban-board.tsx
git commit -m "feat(crm): fecha de ingreso y última actividad en tarjetas del kanban"
```

---

### Task 5: Columnas de ingreso y última actividad en la tabla de Leads

**Files:**
- Modify: `crm/app/(dashboard)/leads/page.tsx`
- Modify: `crm/components/leads-table.tsx`

**Interfaces:**
- Consumes: `relativeTime(iso: string): string`, `absoluteDateTime(iso: string): string` de `crm/lib/types.ts` (Task 1); `Lead.created_at` (ya existente).
- Produces: `LeadsTable` acepta una prop nueva `lastActivityByLead: Record<string, string>`.

- [ ] **Step 1: Ampliar la consulta en `leads/page.tsx`**

Reemplazar el contenido completo de `crm/app/(dashboard)/leads/page.tsx` por:

```tsx
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { getTeamRoster } from "@/lib/team";
import { type Lead } from "@/lib/types";
import LeadsTable from "@/components/leads-table";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);

  const [{ data }, { data: convs }, roster] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .order("score", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(200),
    supabase.from("conversations").select("lead_id, last_activity_at"),
    getTeamRoster(),
  ]);

  const leads = (data || []) as Lead[];
  const lastActivityByLead: Record<string, string> = {};
  (convs || []).forEach((c) => {
    if (!lastActivityByLead[c.lead_id] || c.last_activity_at > lastActivityByLead[c.lead_id]) {
      lastActivityByLead[c.lead_id] = c.last_activity_at;
    }
  });

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Leads</h1>
      <LeadsTable
        leads={leads}
        admin={admin}
        roster={roster}
        currentUserId={user?.id || ""}
        lastActivityByLead={lastActivityByLead}
      />
    </div>
  );
}
```

- [ ] **Step 2: Importar los helpers y ampliar props en `leads-table.tsx`**

En `crm/components/leads-table.tsx:4`, reemplazar:

```ts
import { CATEGORIAS, ESTADO_COLORS, ESTADO_LABELS, type Lead } from "@/lib/types";
```

por:

```ts
import { CATEGORIAS, ESTADO_COLORS, ESTADO_LABELS, relativeTime, absoluteDateTime, type Lead } from "@/lib/types";
```

En `crm/components/leads-table.tsx:11-21`, reemplazar la firma de `LeadsTable`:

```tsx
export default function LeadsTable({
  leads,
  admin,
  roster,
  currentUserId,
}: {
  leads: Lead[];
  admin: boolean;
  roster: Record<string, TeamMember>;
  currentUserId: string;
}) {
```

por:

```tsx
export default function LeadsTable({
  leads,
  admin,
  roster,
  currentUserId,
  lastActivityByLead,
}: {
  leads: Lead[];
  admin: boolean;
  roster: Record<string, TeamMember>;
  currentUserId: string;
  lastActivityByLead: Record<string, string>;
}) {
```

- [ ] **Step 3: Agregar las columnas al encabezado**

En `crm/components/leads-table.tsx:69-77`, reemplazar:

```tsx
            <tr>
              <th className="px-3 py-3 sm:px-4">Cliente</th>
              <th className="px-3 py-3 sm:px-4">Score</th>
              <th className="px-3 py-3 sm:px-4">Estado</th>
              <th className="hidden px-4 py-3 md:table-cell">Tablero</th>
              <th className="hidden px-4 py-3 md:table-cell">Propiedad</th>
              <th className="px-3 py-3 sm:px-4">Asesor</th>
              {admin && <th className="px-4 py-3"></th>}
            </tr>
```

por:

```tsx
            <tr>
              <th className="px-3 py-3 sm:px-4">Cliente</th>
              <th className="px-3 py-3 sm:px-4">Score</th>
              <th className="px-3 py-3 sm:px-4">Estado</th>
              <th className="hidden px-4 py-3 md:table-cell">Tablero</th>
              <th className="hidden px-4 py-3 md:table-cell">Propiedad</th>
              <th className="hidden px-4 py-3 md:table-cell">Ingreso</th>
              <th className="hidden px-4 py-3 md:table-cell">Última actividad</th>
              <th className="px-3 py-3 sm:px-4">Asesor</th>
              {admin && <th className="px-4 py-3"></th>}
            </tr>
```

- [ ] **Step 4: Agregar las celdas de datos y ajustar el `colSpan` del estado vacío**

En `crm/components/leads-table.tsx:109-112`, reemplazar:

```tsx
                <td className="hidden px-4 py-3 text-slate-600 md:table-cell">
                  {CATEGORIAS.find((c) => c.key === (l.categoria || "otros"))?.label || l.categoria}
                </td>
                <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{l.property_ref_origen || "—"}</td>
```

por:

```tsx
                <td className="hidden px-4 py-3 text-slate-600 md:table-cell">
                  {CATEGORIAS.find((c) => c.key === (l.categoria || "otros"))?.label || l.categoria}
                </td>
                <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{l.property_ref_origen || "—"}</td>
                <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                  <span title={absoluteDateTime(l.created_at)}>{relativeTime(l.created_at)}</span>
                </td>
                <td className="hidden px-4 py-3 text-slate-500 md:table-cell">
                  {lastActivityByLead[l.id] ? (
                    <span title={absoluteDateTime(lastActivityByLead[l.id])}>{relativeTime(lastActivityByLead[l.id])}</span>
                  ) : (
                    "—"
                  )}
                </td>
```

En `crm/components/leads-table.tsx:132` (fila de "sin resultados"), reemplazar:

```tsx
                <td colSpan={admin ? 7 : 6} className="px-4 py-10 text-center text-slate-400">
```

por:

```tsx
                <td colSpan={admin ? 9 : 8} className="px-4 py-10 text-center text-slate-400">
```

- [ ] **Step 5: Verificar tipos**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Verificación manual en el navegador**

1. Con el dev server corriendo, abrir `http://localhost:3100/leads` en una ventana ancha (desktop, columnas `md` visibles).
2. Confirmar que aparecen las columnas "Ingreso" y "Última actividad" con texto relativo, y tooltip de fecha completa al pasar el mouse.
3. Confirmar que un lead sin conversación asociada (si existe alguno) muestra "—" en "Última actividad" sin romper el render.
4. Achicar la ventana a ancho mobile y confirmar que ambas columnas se ocultan igual que "Tablero"/"Propiedad".
5. Con la tabla vacía (filtrar por un texto que no exista en el buscador), confirmar que el mensaje "Sin resultados..." sigue ocupando todo el ancho de la tabla.

- [ ] **Step 7: Commit**

```bash
git add "crm/app/(dashboard)/leads/page.tsx" crm/components/leads-table.tsx
git commit -m "feat(crm): columnas de ingreso y última actividad en la tabla de leads"
```

---

### Task 6: Verificación final de lint

- [ ] **Step 1: Correr el linter del proyecto**

Run (desde `crm/`): `npm run lint`
Expected: sin errores (warnings preexistentes no relacionados a los archivos tocados en este plan son aceptables, pero cualquier error o warning nuevo en `chat-view.tsx`, `inbox-list.tsx`, `kanban-board.tsx`, `leads-table.tsx`, `lib/types.ts`, `leads/page.tsx` o `kanban/page.tsx` debe corregirse antes de seguir).

- [ ] **Step 2: Si hubo cambios para corregir lint, commit**

```bash
git add -A
git commit -m "fix(crm): ajustes de lint para fecha/hora estilo WhatsApp"
```

(Omitir este paso si el Step 1 no requirió cambios.)

# Calendario del equipo conectado a Sofi-Comando — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un recordatorio con fecha/hora creado por un asesor vía Sofi-Comando (chat interno del CRM) aparezca en el "Calendario del equipo", visible para todos, junto con las citas de clientes que ya se agendan desde el bot de WhatsApp — y que ese calendario se vea como una grilla mensual real, no una lista.

**Architecture:** Hoy hay dos fuentes de "citas" desconectadas: `leads.cita` (jsonb, llenada por el bot de WhatsApp cuando un cliente agenda) y `advisor_reminders` (tabla, llenada por Sofi-Comando, privada por RLS). La solución no fusiona las tablas — agrega una policy de RLS que hace visibles para todo el equipo autenticado los `advisor_reminders` que SÍ tienen `fecha_hora` (los que no tienen fecha siguen siendo notas 100% privadas), y en el CRM se unifican ambas fuentes en un tipo común `CalendarEvent` que alimenta una grilla de calendario mensual nueva.

**Tech Stack:** Node.js 22 + `node:test` (bot), Next.js 15 + React 19 + TypeScript + Supabase SSR (CRM), Postgres RLS (Supabase), Tailwind CSS 4.

## Global Constraints

- Multi-tenant desde el modelo de datos: no hardcodear nada de un tenant específico (aplica sobre todo si se toca `org_id`, aunque en este caso las queries de `calendario/page.tsx` ya no filtran por org — sigue el patrón existente de esa página, no lo cambies).
- Código (identificadores, nombres de función/archivo) en inglés; copy visible al usuario (UI, mensajes de Sofi) en español.
- Commits en español con prefijo convencional (`feat:`, `fix:`, `docs:`).
- Este repo NO tiene `db:push`: las migraciones SQL se pegan a mano en el SQL Editor de Supabase. Documentar cada migración nueva como pendiente hasta que Juan confirme que corrió.
- Sin admin en Windows: no instalar nada que requiera privilegios elevados. No hace falta ninguna dependencia nueva para este trabajo (ni en el bot ni en el CRM).
- Reusar antes de construir: no dupliques `getTeamRoster()`, `fetchSafe`, `ErrorBanner`, ni la lógica de `colorFor`/paleta por asesor ya existente en `calendario/page.tsx` — se reubican, no se reescriben desde cero.

---

## File Structure

- **Modify** `db/migrations/2026-07-24_advisor_reminders_calendario_equipo.sql` (nuevo archivo) — RLS: lectura de equipo para `advisor_reminders` con `fecha_hora`.
- **Modify** `src/agent/sofi-comando-tools.js` — descripción de la tool `crear_recordatorio` + mensaje de confirmación (visibilidad condicional).
- **Modify** `src/agent/sofi-comando-prompts.js` — copy del bloque `RECORDATORIOS PERSONALES` y la línea de `HERRAMIENTAS` que hoy dice "que solo el ve".
- **Modify** `test/command-recordatorios-tool.test.js` — test actualizado + test nuevo para la rama sin fecha.
- **Create** `crm/lib/calendar-events.ts` — tipo `CalendarEvent` + `getCalendarEvents()` (unifica `leads.cita` y `advisor_reminders`) + helper `bogotaDateKey()`.
- **Modify** `crm/app/(dashboard)/calendario/page.tsx` — reemplaza la lista agrupada por día por una grilla mensual con navegación.
- **Modify** `CLAUDE.md` — anota la migración nueva en "Migración pendiente de correr en Supabase".

---

### Task 1: Migración SQL — RLS de lectura de equipo para recordatorios con fecha

**Files:**
- Create: `db/migrations/2026-07-24_advisor_reminders_calendario_equipo.sql`

**Interfaces:**
- Produces: policy `"team read calendar reminders"` en `advisor_reminders`, que junto con la policy existente `"own reminders"` deja: dueño ve siempre las suyas (con o sin fecha); cualquier autenticado ve las que tengan `fecha_hora is not null` (Postgres compone policies de SELECT con OR).

- [ ] **Step 1: Escribir la migración**

```sql
-- Migracion: recordatorios con fecha/hora visibles en el Calendario del
-- equipo. Ejecutar en el SQL Editor de Supabase.
--
-- Decision de diseño (confirmada con el negocio 2026-07-24): un
-- advisor_reminder es una nota personal SOLO si no tiene fecha/hora. En
-- cuanto el asesor le da dia/hora a Sofi-Comando ("recuerdame la visita de
-- manana a las 3", "agendame esto"), deja de ser una nota privada y pasa a
-- ser un evento de calendario que todo el equipo debe poder ver — igual que
-- las citas de clientes en leads.cita. La columna fecha_hora ya existe
-- (migracion 2026-07-22_advisor_reminders.sql); esta migracion solo agrega
-- la politica de lectura compartida, sin tocar la tabla.
--
-- Se suma como policy adicional: Postgres compone varias policies de SELECT
-- con OR, asi que "own reminders" (el dueño siempre ve las suyas, con o sin
-- fecha) sigue activa junto a esta.

drop policy if exists "team read calendar reminders" on advisor_reminders;
create policy "team read calendar reminders" on advisor_reminders for select to authenticated
  using (fecha_hora is not null);
```

- [ ] **Step 2: Verificación manual (no hay `db:push` en este repo)**

No se puede probar con un test automatizado porque requiere una sesión Supabase real de otro usuario. Verificación diferida al Task 7 (end-to-end): después de correr esta migración a mano en el SQL Editor de Supabase, un recordatorio con fecha creado por el asesor A debe verse en el Calendario del equipo cuando lo mira el asesor B.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/2026-07-24_advisor_reminders_calendario_equipo.sql
git commit -m "feat(db): recordatorios con fecha visibles para todo el equipo (RLS)"
```

---

### Task 2: Bot — actualizar el copy de `crear_recordatorio` (ya no es 100% privado)

**Files:**
- Modify: `src/agent/sofi-comando-tools.js:146-159` (definición de la tool)
- Modify: `src/agent/sofi-comando-prompts.js:31` (línea de `HERRAMIENTAS`)
- Modify: `src/agent/sofi-comando-prompts.js:61-65` (bloque `RECORDATORIOS PERSONALES`)

**Interfaces:**
- Consumes: nada nuevo — solo cambia el texto que ve el modelo (Claude), no la forma de las tools.
- Produces: nada que otro task consuma; es un cambio de copy independiente que se puede hacer antes o después del Task 3 sin bloquear.

- [ ] **Step 1: Actualizar la descripción de la tool en `sofi-comando-tools.js`**

En `src/agent/sofi-comando-tools.js`, dentro de `COMMAND_TOOL_DEFINITIONS`, reemplazar:

```js
  {
    name: "crear_recordatorio",
    description:
      "Crea un recordatorio PERSONAL para el asesor que esta chateando ahora mismo — nunca lo ve otro asesor, ni el admin. Usala cuando pida que le recuerdes algo: una cita, una llamada, una tarea. Si menciona un cliente que existe en el CRM, se lo vincula automaticamente.",
```

por:

```js
  {
    name: "crear_recordatorio",
    description:
      "Crea un recordatorio para el asesor que esta chateando ahora mismo. Si tiene fecha/hora (una cita, visita o llamada agendada), queda visible para TODO el equipo en el Calendario del equipo del CRM; sin fecha/hora es una nota personal que solo el ve. Usala cuando pida que le recuerdes algo. Si menciona un cliente que existe en el CRM, se lo vincula automaticamente.",
```

- [ ] **Step 2: Actualizar la línea de `HERRAMIENTAS` en `sofi-comando-prompts.js`**

En `src/agent/sofi-comando-prompts.js`, reemplazar:

```
- crear_recordatorio / consultar_recordatorios / completar_recordatorio: notas personales del asesor (citas, tareas) que solo el ve.
```

por:

```
- crear_recordatorio / consultar_recordatorios / completar_recordatorio: recordatorios del asesor. Con fecha/hora quedan en el Calendario del equipo (los ve todo el mundo); sin fecha/hora son notas personales que solo el ve.
```

- [ ] **Step 3: Actualizar el bloque `RECORDATORIOS PERSONALES` en `sofi-comando-prompts.js`**

Reemplazar:

```
RECORDATORIOS PERSONALES (crear_recordatorio / consultar_recordatorios / completar_recordatorio):
- Son notas del asesor para si mismo — nunca las ve otro asesor ni el admin, ni siquiera este ultimo en el resumen del equipo (a diferencia de leads/metricas, esto NUNCA se amplia por is_admin).
- Cuando pida que le recuerdes algo, guardalo con crear_recordatorio. Si menciona dia/hora ("manana", "el jueves a las 3"), resuelvelo a fecha ISO usando la fecha actual del sistema (mas abajo).
- Cuando pregunte que tiene pendiente, usa consultar_recordatorios.
- Cuando diga que ya hizo algo pendiente, usa completar_recordatorio con la frase que mejor identifique cual era.
```

por:

```
RECORDATORIOS (crear_recordatorio / consultar_recordatorios / completar_recordatorio):
- Cuando pida que le recuerdes algo, guardalo con crear_recordatorio. Si menciona dia/hora ("manana", "el jueves a las 3"), resuelvelo a fecha ISO usando la fecha actual del sistema (mas abajo) — un recordatorio CON fecha/hora deja de ser privado: aparece en el Calendario del equipo y lo ve todo el mundo, no solo el. Si el asesor pide algo puntual sin dia/hora ("recuerdame llamar a Pedro"), queda como nota privada, solo el la ve.
- Si el asesor te pide explicitamente que algo quede en el calendario o sea una cita/visita/llamada agendada, asegurate de resolverle una fecha/hora concreta antes de guardarlo — sin fecha no entra al calendario.
- Cuando pregunte que tiene pendiente, usa consultar_recordatorios.
- Cuando diga que ya hizo algo pendiente, usa completar_recordatorio con la frase que mejor identifique cual era.
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/sofi-comando-tools.js src/agent/sofi-comando-prompts.js
git commit -m "docs(bot): actualiza el copy de crear_recordatorio a su nueva visibilidad"
```

---

### Task 3: Bot — el mensaje de confirmación refleja si quedó en el calendario

**Files:**
- Modify: `src/agent/sofi-comando-tools.js:336-348` (case `"crear_recordatorio"` en `executeCommandTool`)
- Test: `test/command-recordatorios-tool.test.js:13-32`

**Interfaces:**
- Consumes: `command.crearRecordatorio(scope, { descripcion, fechaHoraIso, leadId })` (sin cambios, ya existe en `src/data/command.js:328`) — devuelve una fila con `fecha_hora` (snake_case, tal como la persiste Supabase).
- Produces: el string de confirmación que Sofi-Comando le devuelve al asesor, ahora condicionado a `creado.fecha_hora`.

- [ ] **Step 1: Escribir el test que falla primero**

En `test/command-recordatorios-tool.test.js`, reemplazar el test `"crear_recordatorio: guarda con el scope del asesor, sin cliente vinculado si no hay match unico"` (líneas 13-32) por estos dos:

```js
test("crear_recordatorio: con fecha/hora avisa que queda en el Calendario del equipo", async (t) => {
  const created = [];
  t.mock.method(command, "crearRecordatorio", async (scope, fields) => {
    created.push({ scope, fields });
    return { id: "rec-1", descripcion: fields.descripcion, fecha_hora: fields.fechaHoraIso, lead_id: fields.leadId };
  });
  t.mock.method(command, "buscarLeads", async () => []);

  const out = await executeCommandTool(
    "crear_recordatorio",
    { descripcion: "llamar a Pedro por el credito", fecha_hora_iso: "2026-07-23T09:00:00-05:00" },
    { scope: asesorScope(), session: null }
  );

  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].scope.viewerUid, "uid-asesor-1");
  assert.strictEqual(created[0].fields.descripcion, "llamar a Pedro por el credito");
  assert.strictEqual(created[0].fields.leadId, null);
  assert.match(out, /Calendario del equipo/);
});

test("crear_recordatorio: sin fecha/hora sigue siendo una nota privada", async (t) => {
  t.mock.method(command, "crearRecordatorio", async (scope, fields) => {
    return { id: "rec-3", descripcion: fields.descripcion, fecha_hora: fields.fechaHoraIso, lead_id: fields.leadId };
  });
  t.mock.method(command, "buscarLeads", async () => []);

  const out = await executeCommandTool(
    "crear_recordatorio",
    { descripcion: "revisar contrato de arriendo" },
    { scope: asesorScope(), session: null }
  );

  assert.match(out, /Solo tu lo vas a ver/);
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `node --test test/command-recordatorios-tool.test.js`
Expected: FAIL en `"crear_recordatorio: con fecha/hora avisa que queda en el Calendario del equipo"` — el mensaje actual siempre dice "Solo tu lo vas a ver", no matchea `/Calendario del equipo/`.

- [ ] **Step 3: Implementar el cambio mínimo**

En `src/agent/sofi-comando-tools.js`, dentro de `executeCommandTool`, reemplazar:

```js
    case "crear_recordatorio": {
      let leadId = null;
      if (input?.cliente) {
        const candidatos = await command.buscarLeads(scope, input.cliente);
        if (candidatos.length === 1) leadId = candidatos[0].id;
      }
      const creado = await command.crearRecordatorio(scope, {
        descripcion: input.descripcion,
        fechaHoraIso: input?.fecha_hora_iso || null,
        leadId,
      });
      return `Recordatorio guardado${leadId ? " y vinculado al cliente" : ""}: "${creado.descripcion}". Solo tu lo vas a ver.`;
    }
```

por:

```js
    case "crear_recordatorio": {
      let leadId = null;
      if (input?.cliente) {
        const candidatos = await command.buscarLeads(scope, input.cliente);
        if (candidatos.length === 1) leadId = candidatos[0].id;
      }
      const creado = await command.crearRecordatorio(scope, {
        descripcion: input.descripcion,
        fechaHoraIso: input?.fecha_hora_iso || null,
        leadId,
      });
      const visibilidad = creado.fecha_hora
        ? "Va a aparecer en el Calendario del equipo, visible para todos."
        : "Solo tu lo vas a ver.";
      return `Recordatorio guardado${leadId ? " y vinculado al cliente" : ""}: "${creado.descripcion}". ${visibilidad}`;
    }
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `node --test test/command-recordatorios-tool.test.js`
Expected: PASS (7 tests, 0 fallos)

- [ ] **Step 5: Correr toda la suite del bot para no romper nada**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/sofi-comando-tools.js test/command-recordatorios-tool.test.js
git commit -m "feat(bot): el recordatorio con fecha avisa que queda en el calendario del equipo"
```

---

### Task 4: CRM — capa de datos que unifica citas de clientes y recordatorios con fecha

**Files:**
- Create: `crm/lib/calendar-events.ts`

**Interfaces:**
- Consumes: `getTeamRoster()` de `crm/lib/team.ts` (ya existe, devuelve `Record<string, TeamMember>` con `.nombre`); un cliente Supabase ya autenticado (el mismo que devuelve `createClient()` de `crm/lib/supabase/server.ts`).
- Produces:
  - `export type CalendarEvent = { id: string; fechaHora: string; titulo: string; advisorId: string | null; advisorNombre: string | null; clienteNombre: string | null; propertyRef: string | null; origen: "cita_cliente" | "recordatorio_equipo" }`
  - `export async function getCalendarEvents(supabase): Promise<{ events: CalendarEvent[]; hasError: boolean; message: string | null }>`
  - `export function bogotaDateKey(iso: string): string` — clave `YYYY-MM-DD` en hora de Bogotá, para agrupar eventos por celda del calendario.

- [ ] **Step 1: Crear el archivo**

```ts
// Unifica las dos fuentes de "eventos de calendario" del negocio en un solo
// tipo para el Calendario del equipo:
//  - leads.cita (jsonb): citas de CLIENTES agendadas desde el bot de WhatsApp
//    (src/agent/tools.js:agendar_cita).
//  - advisor_reminders con fecha_hora: recordatorios que un asesor le pidio a
//    Sofi-Comando y SI tienen dia/hora (los que no tienen fecha son notas
//    privadas y no entran aqui — quedan fuera por RLS ademas de por este filtro).
import { getTeamRoster } from "@/lib/team";

export type CalendarEvent = {
  id: string;
  fechaHora: string;
  titulo: string;
  advisorId: string | null;
  advisorNombre: string | null;
  clienteNombre: string | null;
  propertyRef: string | null;
  origen: "cita_cliente" | "recordatorio_equipo";
};

type Cita = {
  descripcion?: string | null;
  fecha_hora?: string | null;
  tipo?: string | null;
  advisor_id?: string | null;
};

type LeadConCita = {
  id: string;
  nombre: string | null;
  phone: string;
  property_ref_origen: string | null;
  cita: Cita | null;
};

type AdvisorReminder = {
  id: string;
  user_id: string;
  descripcion: string;
  fecha_hora: string | null;
};

const TIPO_LABEL: Record<string, string> = {
  visita: "Visita",
  llamada: "Llamada",
  asesoria: "Asesoría",
};

// Inicio del dia de HOY en hora de Bogota (UTC-5 fijo, Colombia no tiene
// horario de verano), como Date en UTC equivalente — asi el filtro "de hoy
// en adelante" no depende de en que timezone corre el servidor (Vercel corre
// en UTC).
function bogotaTodayStart(): Date {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  return new Date(`${key}T00:00:00-05:00`);
}

// Clave YYYY-MM-DD en hora de Bogota (en-CA devuelve ese formato de fabrica).
export function bogotaDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date(iso));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCalendarEvents(supabase: any): Promise<{
  events: CalendarEvent[];
  hasError: boolean;
  message: string | null;
}> {
  const [citasRes, remindersRes, roster] = await Promise.all([
    supabase.from("leads").select("id, nombre, phone, property_ref_origen, cita").not("cita", "is", null).limit(500),
    supabase
      .from("advisor_reminders")
      .select("id, user_id, descripcion, fecha_hora")
      .not("fecha_hora", "is", null)
      .eq("completado", false)
      .limit(500),
    getTeamRoster(),
  ]);

  if (citasRes.error) console.error("[calendario:leads]", citasRes.error.message);
  if (remindersRes.error) console.error("[calendario:advisor_reminders]", remindersRes.error.message);
  const mensajes = [citasRes.error?.message, remindersRes.error?.message].filter(Boolean) as string[];

  const hoyInicio = bogotaTodayStart();

  const citaEvents: CalendarEvent[] = ((citasRes.data as LeadConCita[]) || [])
    .filter((l) => l.cita?.fecha_hora && new Date(l.cita.fecha_hora) >= hoyInicio)
    .map((l) => ({
      id: `lead:${l.id}`,
      fechaHora: l.cita!.fecha_hora!,
      titulo: `${TIPO_LABEL[l.cita?.tipo || ""] || "Cita"} · ${l.nombre || `+${l.phone}`}`,
      advisorId: l.cita?.advisor_id ?? null,
      advisorNombre: l.cita?.advisor_id ? roster[l.cita.advisor_id]?.nombre ?? null : null,
      clienteNombre: l.nombre,
      propertyRef: l.property_ref_origen,
      origen: "cita_cliente" as const,
    }));

  const reminderEvents: CalendarEvent[] = ((remindersRes.data as AdvisorReminder[]) || [])
    .filter((r) => r.fecha_hora && new Date(r.fecha_hora) >= hoyInicio)
    .map((r) => ({
      id: `reminder:${r.id}`,
      fechaHora: r.fecha_hora!,
      titulo: `Recordatorio · ${r.descripcion}`,
      advisorId: r.user_id,
      advisorNombre: roster[r.user_id]?.nombre ?? null,
      clienteNombre: null,
      propertyRef: null,
      origen: "recordatorio_equipo" as const,
    }));

  const events = [...citaEvents, ...reminderEvents].sort(
    (a, b) => new Date(a.fechaHora).getTime() - new Date(b.fechaHora).getTime()
  );

  return { events, hasError: mensajes.length > 0, message: mensajes.join(" · ") || null };
}
```

- [ ] **Step 2: Verificación**

No hay test runner configurado en `crm/` (revisar `crm/package.json` — no tiene script `test`); la verificación de este archivo es de tipo (`npx tsc --noEmit` dentro de `crm/`) más la verificación visual end-to-end del Task 6.

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores en `lib/calendar-events.ts`.

- [ ] **Step 3: Commit**

```bash
git add crm/lib/calendar-events.ts
git commit -m "feat(crm): unifica citas de clientes y recordatorios con fecha en un tipo comun"
```

---

### Task 5: CRM — rediseñar "Calendario del equipo" como grilla mensual

**Files:**
- Modify: `crm/app/(dashboard)/calendario/page.tsx` (reemplazo completo)

**Interfaces:**
- Consumes: `getCalendarEvents(supabase)` y `bogotaDateKey(iso)` de `crm/lib/calendar-events.ts` (Task 4); `getTeamRoster()` ya no se llama aquí directamente (se movió dentro de `getCalendarEvents`); `createClient()` de `@/lib/supabase/server`; `ErrorBanner` de `@/components/error-banner`.
- Produces: página server-rendered en `/calendario?mes=YYYY-MM` (sin `mes` = mes actual en hora de Bogotá).

- [ ] **Step 1: Reemplazar el archivo completo**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCalendarEvents, bogotaDateKey, type CalendarEvent } from "@/lib/calendar-events";
import ErrorBanner from "@/components/error-banner";

export const dynamic = "force-dynamic";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Paleta estable por asesor: el color sale del hash del id, asi cada asesor
// mantiene su color entre renders sin guardarlo en ningun lado.
const ADVISOR_COLORS = [
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-sky-100 text-sky-800 border-sky-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-violet-100 text-violet-800 border-violet-200",
];
function colorFor(id: string | null): string {
  if (!id) return "bg-slate-100 text-slate-600 border-slate-200";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ADVISOR_COLORS[h % ADVISOR_COLORS.length];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Año/mes (mes 0-indexado) actuales en hora de Bogota — el default del
// selector cuando no viene ?mes= en la URL.
function bogotaYearMonth(): { year: number; month: number } {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m - 1 };
}

function parseMes(mes?: string): { year: number; month: number } {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  return bogotaYearMonth();
}

function mesParam(year: number, month: number): string {
  return `${year}-${pad2(month + 1)}`;
}

function isoFromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Grilla de 6 semanas x 7 dias (42 celdas), empezando en lunes, con los dias
// del mes anterior/siguiente que rellenan la primera y ultima semana.
function buildMonthGrid(year: number, month: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = (first.getUTCDay() + 6) % 7; // 0=lunes .. 6=domingo
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    const day = daysInPrevMonth - firstWeekday + 1 + i;
    cells.push({ iso: isoFromUTC(new Date(Date.UTC(year, month - 1, day))), day, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: isoFromUTC(new Date(Date.UTC(year, month, day))), day, inMonth: true });
  }
  let extraDay = 1;
  while (cells.length < 42) {
    cells.push({ iso: isoFromUTC(new Date(Date.UTC(year, month + 1, extraDay))), day: extraDay, inMonth: false });
    extraDay++;
  }
  return cells;
}

function horaBogota(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const { year, month } = parseMes(mes);

  const supabase = await createClient();
  const { events, hasError, message } = await getCalendarEvents(supabase);

  const porDia = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const key = bogotaDateKey(ev.fechaHora);
    porDia.set(key, [...(porDia.get(key) || []), ev]);
  }

  const cells = buildMonthGrid(year, month);
  const hoyKey = bogotaDateKey(new Date().toISOString());
  const prev = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
  const next = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendario del equipo</h1>
          <p className="text-sm text-slate-500">
            Visitas, llamadas y asesorías con clientes, más los recordatorios con fecha del equipo. El color indica el asesor.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`?mes=${mesParam(prev.year, prev.month)}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            ← Anterior
          </Link>
          <span className="w-40 text-center text-sm font-semibold capitalize text-slate-900">
            {MESES[month]} {year}
          </span>
          <Link
            href={`?mes=${mesParam(next.year, next.month)}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Siguiente →
          </Link>
        </div>
      </div>

      {hasError && <ErrorBanner message={message} />}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid min-w-[720px] grid-cols-7 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="px-3 py-2 text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="grid min-w-[720px] grid-cols-7">
          {cells.map((cell) => {
            const dayEvents = porDia.get(cell.iso) || [];
            const esHoy = cell.iso === hoyKey;
            return (
              <div
                key={cell.iso}
                className={`min-h-[110px] border-b border-r border-slate-100 p-1.5 last:border-r-0 ${
                  cell.inMonth ? "bg-white" : "bg-slate-50/60"
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    esHoy ? "bg-[#c9a24b] text-white" : cell.inMonth ? "text-slate-700" : "text-slate-300"
                  }`}
                >
                  {cell.day}
                </span>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.id}
                      title={`${horaBogota(ev.fechaHora)} · ${ev.titulo}${ev.advisorNombre ? ` · ${ev.advisorNombre}` : ""}`}
                      className={`truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${colorFor(ev.advisorId)}`}
                    >
                      {horaBogota(ev.fechaHora)} {ev.titulo}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="px-1.5 text-[11px] font-medium text-slate-400">+{dayEvents.length - 3} más</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificación de tipos**

Run (desde `crm/`): `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "crm/app/(dashboard)/calendario/page.tsx"
git commit -m "feat(crm): rediseña el Calendario del equipo como grilla mensual"
```

---

### Task 6: Documentar la migración pendiente en CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (sección "2. Estado actual")

**Interfaces:**
- Ninguna — es un cambio de documentación que sigue la convención ya establecida en ese archivo de listar migraciones pendientes de correr a mano.

- [ ] **Step 1: Agregar la migración a la lista de pendientes**

En `CLAUDE.md`, en la sección `## 2. Estado actual`, localizar la línea:

```
- **Migración pendiente de correr en Supabase:**
  `db/migrations/2026-07-09_dmap_default_designer.sql` (default del motor de
  creativos → designer para orgs nuevas).
```

y reemplazarla por:

```
- **Migraciones pendientes de correr en Supabase:**
  `db/migrations/2026-07-09_dmap_default_designer.sql` (default del motor de
  creativos → designer para orgs nuevas) y
  `db/migrations/2026-07-24_advisor_reminders_calendario_equipo.sql`
  (recordatorios con fecha visibles para todo el equipo en el Calendario del
  equipo).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: registra la migracion del calendario del equipo como pendiente"
```

---

### Task 7: Verificación end-to-end

**Files:** ninguno (solo verificación manual)

- [ ] **Step 1: Confirmar con Juan que corrió la migración del Task 1 en Supabase**

Sin esto, `advisor_reminders` con fecha seguirá sin verse entre asesores (aunque el asesor dueño sí las vea, por la policy `"own reminders"` que ya existía).

- [ ] **Step 2: Reiniciar el bot local con el código nuevo**

En Windows, `pkill` no mata los procesos node — hay que matar por puerto (ver [[bot-flujo-vendedor-agenda]] en memoria):

```bash
netstat -ano | grep ":3003" | grep LISTENING
```

Tomar el PID de la salida y:

```bash
taskkill //F //PID <pid>
```

Luego levantar de nuevo con `npm run dev` (puerto 3003, ya configurado en `.claude/launch.json`).

- [ ] **Step 3: Probar en el navegador (preview ya corriendo en localhost:3100)**

1. Entrar a Sofi-Comando en el CRM y pedir: "recuérdame una visita para 80 tower hoy a las 5pm, guárdala en el calendario".
2. Confirmar que Sofi responde mencionando el Calendario del equipo (no "solo tú lo vas a ver").
3. Navegar a `/calendario` y confirmar que aparece la grilla mensual (no la lista de antes) con el evento de hoy visible como chip a las 5:00 p.m.
4. Pedirle a Sofi un recordatorio SIN fecha ("recuérdame revisar el contrato de Pedro") y confirmar que Sofi dice "Solo tú lo vas a ver" y que NO aparece en `/calendario`.
5. Si hay algún lead con cita agendada por el bot de WhatsApp (`leads.cita`), confirmar que sigue apareciendo en la grilla igual que antes.
6. Navegar con "← Anterior" / "Siguiente →" y confirmar que la URL cambia a `?mes=YYYY-MM` y el mes mostrado es correcto.

- [ ] **Step 4: Screenshot de la grilla con al menos un evento, para dejar constancia**

Usar el Browser pane (`preview_start` ya activo en `diamond-crm`, puerto 3100) y `computer` → `screenshot` sobre `/calendario`.

---

## Notas para quien ejecute el plan

- Los Tasks 1-3 (bot) y 4-6 (CRM) son independientes entre sí y se pueden hacer en cualquier orden relativo, pero el Task 7 depende de que TODOS los anteriores estén hechos y la migración corrida.
- El CRM (`crm/`) no tiene suite de tests automatizada — la única verificación de tipo es `npx tsc --noEmit`; el resto es verificación visual (Task 7).
- No se creó ninguna dependencia nueva en ningún `package.json`.

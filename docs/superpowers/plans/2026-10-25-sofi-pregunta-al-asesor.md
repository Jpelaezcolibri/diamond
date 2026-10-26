# Sofi le pregunta al asesor — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Sofi registre las preguntas del colega que no puede contestar, le insista al asesor (escalera sin límite) hasta tener la respuesta, se la pase al colega, y que las visitas no se cancelen en el plazo sino a 2 h de la hora.

**Architecture:** Tabla nueva `preguntas_asesor` con su módulo de datos. Lógica pura de la escalera en `src/lib/preguntas-escalera.js`, orquestación con dependencias inyectables en `src/lib/pregunta-asesor.js` y scheduler propio. Dos tools nuevas (una para colega/cliente y otra para el asesor), filtradas por interruptor. API del bot + tarjeta en "Para atender" del CRM. Las visitas siguen en `leads.cita`: `citas-escalera` gana un final nuevo bajo `CITAS_SIN_CORTE`.

**Tech Stack:** Node.js (CommonJS), `node:test`, Supabase, Express (`src/api/crm.js`), Next.js 16 + React 19 + Tailwind 4 (CRM).

**Spec:** `docs/superpowers/specs/2026-10-25-sofi-pregunta-al-asesor-design.md`

## Global Constraints

- Interruptores apagados por defecto; solo `true`/`1`/`si`/`on` los encienden: `SOFI_PREGUNTA_ASESOR`, `CITAS_SIN_CORTE`. Apagado: ningún camino nuevo envía nada.
- Ritmo: `PREGUNTA_PASO_MIN` 60, `PREGUNTA_REAVISO_MIN` 15, `PREGUNTA_INTERVALO_MIN` 5; `CITAS_CANCELAR_HORAS_ANTES` 2. Pausa: `agenda-reglas.enPausa` (8 p. m.–8 a. m. y domingos), que NO frena el cancelar de las visitas.
- Plantillas opcionales: `SOFI_PREGUNTA_ASESOR_PLANTILLA` (`{{1}}` ref, `{{2}}` pregunta) y `SOFI_RESPUESTA_LISTA_PLANTILLA` (`{{1}}` nombre, `{{2}}` ref).
- Hacia el colega: la respuesta del asesor va **literal**, sin nombre ni celular de nadie del equipo. Tuteo, sin voseo (hay un test de tuteo en la suite).
- WhatsApp al asesor: sin nombre ni teléfono del colega.
- Comisiones: no se preguntan por esta vía ("se confirma con el asesor").
- La tabla la corre Juan. Si no existe: la tool falla cerrado con un texto honesto y el scheduler no hace nada.
- Commits en español con prefijo convencional y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `node --test test/<archivo>.test.js`; suite completa: `npm test` (hoy 2.825 en verde).

## Archivos

- Create `db/migrations/2026-10-25_preguntas_asesor.sql` — tabla, índices, RLS "team read".
- Create `src/data/preguntas-asesor.js` — CRUD con respaldo en memoria.
- Modify `src/data/memory.js` — arreglo `preguntasAsesor`.
- Create `src/lib/preguntas-escalera.js` — `pasoDePregunta` (pura).
- Create `src/lib/pregunta-asesor.js` — `activo`, `registrar`, `avisar`, `responder`, `descartar`, `textoRespuesta`, `entregarRespuesta`, `entregarPendientesDe`, `contextoAsesor`, `hayPorEntregar`.
- Modify `src/notifications/avisar-asesor.js` — motivo `pregunta`.
- Create `src/scheduler/preguntas-escalera.js` — tick; Modify `src/server.js` — arranque.
- Modify `src/agent/tools.js` — tools `preguntar_al_asesor`, `responder_pregunta`, `toolsActivas()`.
- Modify `src/agent/engine.js` — `toolsActivas()`, contexto de preguntas, `preguntaId`.
- Modify `src/agent/prompts.js` — reglas y bloques.
- Modify `src/channels/whatsapp.js` — respuesta citada y entrega pendiente.
- Modify `src/api/crm.js` — `/api/preguntas/responder`, `/api/preguntas/descartar`.
- Modify `src/scheduler/citas-escalera.js` — `CITAS_SIN_CORTE`.
- Create `docs/superpowers/mockups/2026-10-25-pregunta-pendiente.html` — mockup (aprobación de Juan antes del CRM).
- Create `crm/app/api/preguntas/route.ts`, `crm/components/pregunta-pendiente.tsx`; Modify `crm/app/(dashboard)/pendientes/page.tsx`.
- Modify `.env.example`, `CLAUDE.md`.
- Tests: `test/preguntas-asesor-data.test.js`, `test/preguntas-escalera.test.js`, `test/pregunta-asesor.test.js`, `test/preguntas-escalera-scheduler.test.js`, `test/preguntas-tools.test.js`, `test/preguntas-prompts.test.js`, `test/preguntas-endpoint.test.js`, `test/citas-sin-corte.test.js`.

---

### Task 1: Migración y módulo de datos

**Files:**
- Create: `db/migrations/2026-10-25_preguntas_asesor.sql`
- Create: `src/data/preguntas-asesor.js`
- Modify: `src/data/memory.js` (objeto `db`)
- Test: `test/preguntas-asesor-data.test.js`

**Interfaces:**
- Produces (`require("../data/preguntas-asesor")`):
  - `crear({ orgId, leadId, ref, tipo, pregunta, asesorId }) → Promise<{ pregunta: Row, nueva: boolean }>` (no duplica lead+ref+tipo abierta)
  - `pendientes() → Promise<Row[]>` (estado `pendiente`, todas las orgs)
  - `pendientesDeOrg(orgId) → Promise<Row[]>`
  - `porId(id) → Promise<Row|null>`
  - `porWamid(wamid) → Promise<Row|null>`
  - `actualizar(id, patch) → Promise<Row|null>`
  - `marcarRespondida(id, { respuesta, por, via, ahora }) → Promise<Row|null>` (solo si sigue `pendiente`)
  - `abiertasDeLead(leadId) → Promise<number>` (pendientes)
  - `porEntregarDe(leadId) → Promise<Row[]>` (`respondida` con `entrega_error='esperando_ventana'`)
  - `esTablaAusente(error) → boolean`
  - Row: `{ id, org_id, lead_id, ref, tipo, pregunta, estado, asesor_id, asignada_at, reaviso_at, wamid_aviso, respuesta, respondida_por, respondida_via, respondida_at, entregada_at, entrega_error, descartada_por, created_at }`

- [ ] **Step 1: Escribir la migración**

```sql
-- Preguntas que Sofi le hace al asesor por un colega o cliente (spec
-- 2026-10-25-sofi-pregunta-al-asesor). La escalera le insiste al asesor de
-- turno hasta que alguien conteste (CRM o WhatsApp) y Sofi se lo pasa al colega.
create table if not exists preguntas_asesor (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  ref text,
  tipo text not null default 'otro' check (tipo in ('precio','unidad','administracion','otro')),
  pregunta text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','respondida','entregada','descartada')),
  asesor_id uuid references advisors(id),
  asignada_at timestamptz not null default now(),
  reaviso_at timestamptz,
  wamid_aviso text,
  respuesta text,
  respondida_por text,
  respondida_via text check (respondida_via is null or respondida_via in ('crm','whatsapp')),
  respondida_at timestamptz,
  entregada_at timestamptz,
  entrega_error text,
  descartada_por text,
  created_at timestamptz not null default now()
);
create index if not exists preguntas_asesor_pendientes on preguntas_asesor (org_id, estado);
create index if not exists preguntas_asesor_wamid on preguntas_asesor (wamid_aviso);
create index if not exists preguntas_asesor_lead on preguntas_asesor (lead_id, estado);
alter table preguntas_asesor enable row level security;
drop policy if exists "team read" on preguntas_asesor;
create policy "team read" on preguntas_asesor for select to authenticated using (true);
```

- [ ] **Step 2: Agregar el arreglo en memoria**

En `src/data/memory.js`, dentro de `const db = { ... }`, antes de `uid,`:

```js
  // Preguntas de Sofi al asesor (ver db/migrations/2026-10-25_preguntas_asesor.sql).
  preguntasAsesor: [],
```

- [ ] **Step 3: Escribir el test que falla**

`test/preguntas-asesor-data.test.js`:

```js
// Modulo de datos de preguntas_asesor (spec 2026-10-25), en modo memoria.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const datos = require("../src/data/preguntas-asesor");

beforeEach(() => { memory.preguntasAsesor.length = 0; });

const base = { orgId: "org-1", leadId: "l1", ref: "10013037", tipo: "precio", pregunta: "¿Precio final de la ref 10013037?", asesorId: "a1" };

test("crea una pregunta pendiente con su asesor", async () => {
  const { pregunta, nueva } = await datos.crear(base);
  assert.strictEqual(nueva, true);
  assert.strictEqual(pregunta.estado, "pendiente");
  assert.strictEqual(pregunta.asesor_id, "a1");
  assert.ok(pregunta.asignada_at);
});

test("no duplica la misma ref y tipo abierta en el mismo lead", async () => {
  const a = await datos.crear(base);
  const b = await datos.crear({ ...base, pregunta: "otra forma de decirlo" });
  assert.strictEqual(b.nueva, false);
  assert.strictEqual(b.pregunta.id, a.pregunta.id);
  const c = await datos.crear({ ...base, ref: "9944723" });
  assert.strictEqual(c.nueva, true);
});

test("marcarRespondida solo cierra una pendiente, y una sola vez", async () => {
  const { pregunta } = await datos.crear(base);
  const r1 = await datos.marcarRespondida(pregunta.id, { respuesta: "450 final", por: "Daiana", via: "crm" });
  assert.strictEqual(r1.estado, "respondida");
  assert.strictEqual(r1.respuesta, "450 final");
  const r2 = await datos.marcarRespondida(pregunta.id, { respuesta: "otra", por: "Claudia", via: "whatsapp" });
  assert.strictEqual(r2, null);
});

test("porWamid, abiertasDeLead y porEntregarDe", async () => {
  const { pregunta } = await datos.crear(base);
  await datos.actualizar(pregunta.id, { wamid_aviso: "wamid.X" });
  assert.strictEqual((await datos.porWamid("wamid.X")).id, pregunta.id);
  assert.strictEqual(await datos.abiertasDeLead("l1"), 1);
  await datos.marcarRespondida(pregunta.id, { respuesta: "450", por: "Daiana", via: "crm" });
  await datos.actualizar(pregunta.id, { entrega_error: "esperando_ventana" });
  assert.strictEqual(await datos.abiertasDeLead("l1"), 0);
  assert.strictEqual((await datos.porEntregarDe("l1")).length, 1);
});

test("esTablaAusente reconoce el error de Postgres y el de PostgREST", () => {
  assert.strictEqual(datos.esTablaAusente({ code: "42P01" }), true);
  assert.strictEqual(datos.esTablaAusente({ code: "PGRST205", message: "Could not find the table" }), true);
  assert.strictEqual(datos.esTablaAusente({ code: "23505" }), false);
});
```

- [ ] **Step 4: Correrlo y ver que falla**

Run: `node --test test/preguntas-asesor-data.test.js`
Expected: FAIL con `Cannot find module '../src/data/preguntas-asesor'`

- [ ] **Step 5: Implementar el módulo**

`src/data/preguntas-asesor.js`:

```js
// Preguntas de Sofi al asesor (spec 2026-10-25-sofi-pregunta-al-asesor).
// Sin SUPABASE_URL usa src/data/memory.js, como el resto de src/data.
const supabase = require("./supabase");
const memory = require("./memory");

const ABIERTAS = ["pendiente", "respondida"];

function esTablaAusente(error) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /preguntas_asesor/.test(String(error.message || "")) && /does not exist|Could not find/i.test(String(error.message || ""));
}

async function crear({ orgId, leadId, ref = null, tipo = "otro", pregunta, asesorId = null }) {
  const refTxt = ref ? String(ref).trim() : null;
  if (!supabase) {
    const ya = memory.preguntasAsesor.find(
      (p) => p.lead_id === leadId && (p.ref || null) === refTxt && p.tipo === tipo && ABIERTAS.includes(p.estado) && !p.entregada_at
    );
    if (ya) return { pregunta: ya, nueva: false };
    const fila = {
      id: memory.uid(), org_id: orgId, lead_id: leadId, ref: refTxt, tipo, pregunta, estado: "pendiente",
      asesor_id: asesorId, asignada_at: new Date().toISOString(), reaviso_at: null, wamid_aviso: null,
      respuesta: null, respondida_por: null, respondida_via: null, respondida_at: null, entregada_at: null,
      entrega_error: null, descartada_por: null, created_at: new Date().toISOString(),
    };
    memory.preguntasAsesor.push(fila);
    return { pregunta: fila, nueva: true };
  }
  let q = supabase.from("preguntas_asesor").select("*").eq("lead_id", leadId).eq("tipo", tipo).in("estado", ABIERTAS).is("entregada_at", null);
  q = refTxt ? q.eq("ref", refTxt) : q.is("ref", null);
  const { data: ya, error: e1 } = await q.limit(1);
  if (e1) throw e1;
  if (ya && ya[0]) return { pregunta: ya[0], nueva: false };
  const { data, error } = await supabase
    .from("preguntas_asesor")
    .insert({ org_id: orgId, lead_id: leadId, ref: refTxt, tipo, pregunta, asesor_id: asesorId })
    .select("*").single();
  if (error) throw error;
  return { pregunta: data, nueva: true };
}

async function pendientes() {
  if (!supabase) return memory.preguntasAsesor.filter((p) => p.estado === "pendiente");
  const { data, error } = await supabase.from("preguntas_asesor").select("*").eq("estado", "pendiente").order("created_at").limit(200);
  if (error) throw error;
  return data || [];
}

async function pendientesDeOrg(orgId) {
  return (await pendientes()).filter((p) => p.org_id === orgId);
}

async function porId(id) {
  if (!supabase) return memory.preguntasAsesor.find((p) => p.id === id) || null;
  const { data, error } = await supabase.from("preguntas_asesor").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function porWamid(wamid) {
  if (!wamid) return null;
  if (!supabase) return memory.preguntasAsesor.find((p) => p.wamid_aviso === wamid) || null;
  const { data, error } = await supabase.from("preguntas_asesor").select("*").eq("wamid_aviso", String(wamid)).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

async function actualizar(id, patch) {
  if (!supabase) {
    const p = memory.preguntasAsesor.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  const { data, error } = await supabase.from("preguntas_asesor").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw error;
  return data || null;
}

async function marcarRespondida(id, { respuesta, por, via, ahora = new Date() }) {
  const patch = { estado: "respondida", respuesta, respondida_por: por, respondida_via: via, respondida_at: ahora.toISOString() };
  if (!supabase) {
    const p = memory.preguntasAsesor.find((x) => x.id === id && x.estado === "pendiente");
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  const { data, error } = await supabase.from("preguntas_asesor").update(patch).eq("id", id).eq("estado", "pendiente").select("*").maybeSingle();
  if (error) throw error;
  return data || null;
}

async function abiertasDeLead(leadId) {
  if (!supabase) return memory.preguntasAsesor.filter((p) => p.lead_id === leadId && p.estado === "pendiente").length;
  const { count, error } = await supabase.from("preguntas_asesor").select("id", { count: "exact", head: true }).eq("lead_id", leadId).eq("estado", "pendiente");
  if (error) throw error;
  return count || 0;
}

async function porEntregarDe(leadId) {
  if (!supabase) return memory.preguntasAsesor.filter((p) => p.lead_id === leadId && p.estado === "respondida" && p.entrega_error === "esperando_ventana");
  const { data, error } = await supabase.from("preguntas_asesor").select("*").eq("lead_id", leadId).eq("estado", "respondida").eq("entrega_error", "esperando_ventana");
  if (error) throw error;
  return data || [];
}

module.exports = { crear, pendientes, pendientesDeOrg, porId, porWamid, actualizar, marcarRespondida, abiertasDeLead, porEntregarDe, esTablaAusente };
```

- [ ] **Step 6: Correr el test**

Run: `node --test test/preguntas-asesor-data.test.js`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add db/migrations/2026-10-25_preguntas_asesor.sql src/data/preguntas-asesor.js src/data/memory.js test/preguntas-asesor-data.test.js
git commit -m "feat(preguntas): tabla y modulo de datos de preguntas al asesor"
```

---

### Task 2: La escalera de preguntas (lógica pura)

**Files:**
- Create: `src/lib/preguntas-escalera.js`
- Test: `test/preguntas-escalera.test.js`

**Interfaces:**
- Consumes: `require("./agenda-reglas").enPausa(fecha) → boolean`
- Produces: `pasoDePregunta({ pregunta, ciclo, ahora }) → { accion: "nada"|"asignar"|"rotar"|"reaviso", nuevo?: Advisor }`; constantes `PASO_MIN`, `REAVISO_MIN`.

- [ ] **Step 1: Escribir el test que falla**

`test/preguntas-escalera.test.js`:

```js
// Escalera de una pregunta al asesor (spec 2026-10-25 §5.3): reaviso a los
// 15 min, rota cada hora, sin limite; pausa de noche y domingo.
const { test } = require("node:test");
const assert = require("node:assert");
const { pasoDePregunta } = require("../src/lib/preguntas-escalera");

const A1 = { id: "a1", name: "Daiana" };
const A2 = { id: "a2", name: "Claudia" };
const A3 = { id: "a3", name: "Catherine" };
const CICLO = [A1, A2, A3];
// Jueves 2026-10-08, 9:00 a. m. Bogota = 14:00 UTC.
const p = (over = {}) => ({ id: "p1", estado: "pendiente", asesor_id: "a1", asignada_at: "2026-10-08T14:00:00Z", reaviso_at: null, ...over });
const t = (iso) => new Date(iso);

test("antes de 15 min no pasa nada", () => {
  assert.strictEqual(pasoDePregunta({ pregunta: p(), ciclo: CICLO, ahora: t("2026-10-08T14:14:00Z") }).accion, "nada");
});

test("a los 15 min se le repite, una sola vez por asignación", () => {
  assert.strictEqual(pasoDePregunta({ pregunta: p(), ciclo: CICLO, ahora: t("2026-10-08T14:15:00Z") }).accion, "reaviso");
  const ya = p({ reaviso_at: "2026-10-08T14:15:00Z" });
  assert.strictEqual(pasoDePregunta({ pregunta: ya, ciclo: CICLO, ahora: t("2026-10-08T14:40:00Z") }).accion, "nada");
});

test("a la hora rota al siguiente, y del último vuelve al primero", () => {
  const r = pasoDePregunta({ pregunta: p(), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") });
  assert.deepStrictEqual([r.accion, r.nuevo.id], ["rotar", "a2"]);
  const r3 = pasoDePregunta({ pregunta: p({ asesor_id: "a3" }), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") });
  assert.strictEqual(r3.nuevo.id, "a1");
});

test("con un solo asesor, a la hora se le vuelve a asignar a él", () => {
  const r = pasoDePregunta({ pregunta: p(), ciclo: [A1], ahora: t("2026-10-08T15:00:00Z") });
  assert.deepStrictEqual([r.accion, r.nuevo.id], ["rotar", "a1"]);
});

test("sin asesor asignado, se asigna al primero del ciclo", () => {
  const r = pasoDePregunta({ pregunta: p({ asesor_id: null }), ciclo: CICLO, ahora: t("2026-10-08T14:01:00Z") });
  assert.deepStrictEqual([r.accion, r.nuevo.id], ["asignar", "a1"]);
});

test("si su asesor ya no está en el ciclo, rota al primero", () => {
  const r = pasoDePregunta({ pregunta: p({ asesor_id: "zz" }), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") });
  assert.strictEqual(r.nuevo.id, "a1");
});

test("de noche y en domingo no pasa nada", () => {
  assert.strictEqual(pasoDePregunta({ pregunta: p(), ciclo: CICLO, ahora: t("2026-10-09T03:00:00Z") }).accion, "nada");
  // Domingo 2026-10-11, 10:00 a. m. Bogota.
  assert.strictEqual(pasoDePregunta({ pregunta: p({ asignada_at: "2026-10-10T20:00:00Z" }), ciclo: CICLO, ahora: t("2026-10-11T15:00:00Z") }).accion, "nada");
});

test("sin ciclo o pregunta cerrada, nada", () => {
  assert.strictEqual(pasoDePregunta({ pregunta: p(), ciclo: [], ahora: t("2026-10-08T15:00:00Z") }).accion, "nada");
  assert.strictEqual(pasoDePregunta({ pregunta: p({ estado: "respondida" }), ciclo: CICLO, ahora: t("2026-10-08T15:00:00Z") }).accion, "nada");
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/preguntas-escalera.test.js`
Expected: FAIL con `Cannot find module '../src/lib/preguntas-escalera'`

- [ ] **Step 3: Implementar**

`src/lib/preguntas-escalera.js`:

```js
// Que le toca a una pregunta al asesor ahora (spec 2026-10-25 §5.3). Pura:
// se prueba sin base ni WhatsApp. Mismo ritmo que la escalera de citas:
// reaviso a los 15 min, rota cada hora, sin limite; pausa de noche y domingo.
const { enPausa } = require("./agenda-reglas");

const PASO_MIN = Number(process.env.PREGUNTA_PASO_MIN || 60);
const REAVISO_MIN = Number(process.env.PREGUNTA_REAVISO_MIN || 15);
const MIN = 60 * 1000;

function siguienteDe(ciclo, actualId) {
  const i = ciclo.findIndex((a) => a.id === actualId);
  return i === -1 ? ciclo[0] : ciclo[(i + 1) % ciclo.length];
}

function pasoDePregunta({ pregunta, ciclo, ahora = new Date() }) {
  if (!pregunta || pregunta.estado !== "pendiente" || !ciclo || ciclo.length === 0) return { accion: "nada" };
  if (enPausa(ahora)) return { accion: "nada" };
  if (!pregunta.asesor_id) return { accion: "asignar", nuevo: ciclo[0] };
  const desde = new Date(pregunta.asignada_at).getTime();
  if (isNaN(desde)) return { accion: "asignar", nuevo: ciclo[0] };
  const pasaron = ahora.getTime() - desde;
  if (pasaron >= PASO_MIN * MIN) return { accion: "rotar", nuevo: siguienteDe(ciclo, pregunta.asesor_id) };
  const ya = pregunta.reaviso_at ? new Date(pregunta.reaviso_at).getTime() : NaN;
  if (pasaron >= REAVISO_MIN * MIN && !(ya >= desde)) return { accion: "reaviso" };
  return { accion: "nada" };
}

module.exports = { pasoDePregunta, PASO_MIN, REAVISO_MIN };
```

- [ ] **Step 4: Correr el test**

Run: `node --test test/preguntas-escalera.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/preguntas-escalera.js test/preguntas-escalera.test.js
git commit -m "feat(preguntas): escalera pura (reaviso 15 min, rota cada hora, sin limite)"
```

---

### Task 3: Orquestación — registrar, avisar, responder y entregar

**Files:**
- Create: `src/lib/pregunta-asesor.js`
- Modify: `src/notifications/avisar-asesor.js` (objeto `MOTIVOS`)
- Test: `test/pregunta-asesor.test.js`

**Interfaces:**
- Consumes: Task 1 (`preguntas-asesor`), `avisarAsesor({ org, advisor, motivo, lead, titulo, cuerpo })`, `enviarYRegistrar(org, telefono, texto, opts) → { ok, wamid, error }`, `VENTANA_CERRADA` (regex), `sendWhatsApp(org, to, text) → { ok, wamid, error }`, `sendWhatsAppTemplate(org, to, { name, bodyParams }) → { ok, wamid, error }`, `notificar({ orgId, advisor, tipo, titulo, cuerpo, link, leadId })`, `colegas.esSoloLlamada(orgId, { telefono })`, `rotacion.asesoresDelCiclo(orgId)`, `leads.findById(orgId, id)`, `leads.update(id, patch)`.
- Produces (`require("../lib/pregunta-asesor")`):
  - `activo() → boolean`
  - `TIPOS = ["precio","unidad","administracion","otro"]`
  - `registrar({ ctx, input, deps }) → Promise<string>` (texto para Sofi)
  - `avisar({ org, pregunta, lead, advisor, reaviso, deps }) → Promise<{ ok }>`
  - `responder({ org, preguntaId, respuesta, advisor, via, deps }) → Promise<{ ok, codigo?, error?, texto? }>`
  - `descartar({ org, preguntaId, por, deps }) → Promise<{ ok, codigo?, error? }>`
  - `textoRespuesta({ lead, pregunta }) → string`
  - `entregarRespuesta({ org, pregunta, lead, advisor, deps }) → Promise<{ ok, motivo? }>`
  - `entregarPendientesDe({ org, lead, deps }) → Promise<number>`
  - `contextoAsesor({ org, preguntaId }) → Promise<{ pendientes: Row[], citada: Row|null }>`
  - `hayPorEntregar(leadId) → Promise<boolean>`
  - deps inyectables: `{ datos, ciclo, avisarAsesor, mensaje, texto, plantilla, notificar, soloLlamada, lead, actualizarLead }`

- [ ] **Step 1: Agregar el motivo en `avisar-asesor.js`**

En `src/notifications/avisar-asesor.js`, dentro de `const MOTIVOS = { ... }`, después de `visita:`:

```js
  pregunta: { atencion: true, asigna: false, tipo: "pregunta_asesor", whatsapp: "una pregunta de un colega" },
```

- [ ] **Step 2: Escribir el test que falla**

`test/pregunta-asesor.test.js`:

```js
// Orquestacion de preguntas al asesor (spec 2026-10-25 §5).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const pa = require("../src/lib/pregunta-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const A1 = { id: "a1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true };
const A2 = { id: "a2", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true };
const LEAD = { id: "l1", org_id: "org-1", phone: "573125550000", nombre: "Andrea Strauch", source: "colega" };

let envios;
const deps = (over = {}) => ({
  ciclo: async () => [A1, A2],
  avisarAsesor: async (a) => { envios.push({ campana: a.motivo, a: a.advisor.id, titulo: a.titulo, cuerpo: a.cuerpo }); return { ok: true }; },
  mensaje: async (_o, to, texto, opts) => { envios.push({ wa: to, texto, opts }); return { ok: true, wamid: "wamid.A" }; },
  texto: async (_o, to, texto) => { envios.push({ colega: to, texto }); return { ok: true, wamid: "wamid.C" }; },
  plantilla: async (_o, to, o) => { envios.push({ plantilla: o.name, to, params: o.bodyParams }); return { ok: true }; },
  notificar: async (n) => { envios.push({ nota: n.titulo, a: n.advisor.id }); return { ok: true }; },
  soloLlamada: async () => false,
  lead: async () => ({ ...LEAD }),
  actualizarLead: async (id, patch) => { envios.push({ leadPatch: patch }); return {}; },
  ...over,
});

beforeEach(() => {
  envios = [];
  memory.preguntasAsesor.length = 0;
  delete process.env.SOFI_PREGUNTA_ASESOR_PLANTILLA;
  delete process.env.SOFI_RESPUESTA_LISTA_PLANTILLA;
});

const ctx = () => ({ org: ORG, lead: { ...LEAD }, colega: { nombre: "Andrea" } });
const input = { pregunta: "¿Precio final de la ref 10013037?", ref: "10013037", tipo: "precio" };

test("registrar crea la pregunta, avisa por la campana y por WhatsApp sin datos del colega", async () => {
  const out = await pa.registrar({ ctx: ctx(), input, deps: deps() });
  assert.match(out, /Pregunta registrada/);
  assert.match(out, /No prometas hora/);
  const p = memory.preguntasAsesor[0];
  assert.strictEqual(p.asesor_id, "a1");
  assert.strictEqual(p.wamid_aviso, "wamid.A");
  assert.ok(envios.some((e) => e.campana === "pregunta" && e.a === "a1"));
  const wa = envios.find((e) => e.wa);
  assert.strictEqual(wa.wa, A1.phone);
  assert.match(wa.texto, /Ref 10013037: ¿Precio final de la ref 10013037\?/);
  assert.doesNotMatch(wa.texto, /Andrea|573125550000/);
});

test("registrar no duplica ni vuelve a avisar", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  const out = await pa.registrar({ ctx: ctx(), input, deps: deps() });
  assert.match(out, /ya está con el asesor/);
  assert.strictEqual(envios.length, 0);
});

test("con la ventana del asesor cerrada usa la plantilla si existe; si no, queda la campana", async () => {
  const cerrada = { mensaje: async () => ({ ok: false, error: "Re-engagement message (131047)" }) };
  process.env.SOFI_PREGUNTA_ASESOR_PLANTILLA = "pregunta_asesor";
  await pa.registrar({ ctx: ctx(), input, deps: deps(cerrada) });
  assert.ok(envios.some((e) => e.plantilla === "pregunta_asesor" && e.params[0] === "10013037"));
  memory.preguntasAsesor.length = 0;
  envios = [];
  delete process.env.SOFI_PREGUNTA_ASESOR_PLANTILLA;
  await pa.registrar({ ctx: ctx(), input, deps: deps(cerrada) });
  assert.ok(!envios.some((e) => e.plantilla));
  assert.ok(envios.some((e) => e.campana === "pregunta"));
});

test("sin asesores en el ciclo la pregunta queda sin asesor y Sofi igual dice que pregunta", async () => {
  const out = await pa.registrar({ ctx: ctx(), input, deps: deps({ ciclo: async () => [] }) });
  assert.match(out, /Pregunta registrada/);
  assert.strictEqual(memory.preguntasAsesor[0].asesor_id, null);
  assert.strictEqual(envios.length, 0);
});

test("responder cierra, entrega literal al colega y la segunda respuesta no pisa", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const id = memory.preguntasAsesor[0].id;
  envios = [];
  const r = await pa.responder({ org: ORG, preguntaId: id, respuesta: "450 es el precio final, negocian poco", advisor: A1, via: "crm", deps: deps() });
  assert.strictEqual(r.ok, true);
  const msg = envios.find((e) => e.colega);
  assert.strictEqual(msg.colega, LEAD.phone);
  assert.strictEqual(msg.texto, "Hola Andrea, ya tengo la respuesta sobre la Ref 10013037:\n450 es el precio final, negocian poco");
  assert.doesNotMatch(msg.texto, /Daiana|Asesor 1|573011880668/);
  assert.strictEqual(memory.preguntasAsesor[0].estado, "entregada");
  assert.ok(envios.some((e) => e.leadPatch && e.leadPatch.atencion_pendiente === null));
  const r2 = await pa.responder({ org: ORG, preguntaId: id, respuesta: "otra", advisor: A2, via: "whatsapp", deps: deps() });
  assert.deepStrictEqual([r2.ok, r2.codigo], [false, 409]);
});

test("responder valida la respuesta y la org", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const id = memory.preguntasAsesor[0].id;
  assert.strictEqual((await pa.responder({ org: ORG, preguntaId: id, respuesta: " ", advisor: A1, via: "crm", deps: deps() })).codigo, 400);
  assert.strictEqual((await pa.responder({ org: { id: "otra" }, preguntaId: id, respuesta: "450", advisor: A1, via: "crm", deps: deps() })).codigo, 404);
});

test("ventana del colega cerrada: plantilla respuesta_lista y queda esperando; sin plantilla, campana al asesor", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const id = memory.preguntasAsesor[0].id;
  const cerrada = { texto: async () => ({ ok: false, error: "more than 24 hours" }) };
  process.env.SOFI_RESPUESTA_LISTA_PLANTILLA = "respuesta_lista";
  envios = [];
  await pa.responder({ org: ORG, preguntaId: id, respuesta: "450", advisor: A1, via: "crm", deps: deps(cerrada) });
  assert.ok(envios.some((e) => e.plantilla === "respuesta_lista" && e.params[0] === "Andrea" && e.params[1] === "10013037"));
  assert.strictEqual(memory.preguntasAsesor[0].entrega_error, "esperando_ventana");

  memory.preguntasAsesor.length = 0;
  delete process.env.SOFI_RESPUESTA_LISTA_PLANTILLA;
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  await pa.responder({ org: ORG, preguntaId: memory.preguntasAsesor[0].id, respuesta: "450", advisor: A1, via: "crm", deps: deps(cerrada) });
  assert.ok(envios.some((e) => e.nota && /No le pude pasar la respuesta/.test(e.nota)));
  assert.strictEqual(memory.preguntasAsesor[0].entrega_error, "ventana_cerrada");
});

test("colega solo llamada: no se le escribe y se le pide al asesor llamar", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  await pa.responder({ org: ORG, preguntaId: memory.preguntasAsesor[0].id, respuesta: "450", advisor: A1, via: "crm", deps: deps({ soloLlamada: async () => true }) });
  assert.ok(!envios.some((e) => e.colega));
  assert.ok(envios.some((e) => e.nota && /Llámalo/.test(e.nota)));
  assert.strictEqual(memory.preguntasAsesor[0].entrega_error, "solo_llamada");
});

test("entregarPendientesDe manda lo que esperaba la ventana", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  const id = memory.preguntasAsesor[0].id;
  Object.assign(memory.preguntasAsesor[0], { estado: "respondida", respuesta: "450", entrega_error: "esperando_ventana" });
  envios = [];
  const n = await pa.entregarPendientesDe({ org: ORG, lead: { ...LEAD }, deps: deps() });
  assert.strictEqual(n, 1);
  assert.ok(envios.some((e) => e.colega && /450/.test(e.texto)));
  assert.strictEqual(memory.preguntasAsesor.find((p) => p.id === id).estado, "entregada");
});

test("textoRespuesta sin ref y sin nombre", () => {
  assert.strictEqual(pa.textoRespuesta({ lead: { phone: "57300" }, pregunta: { respuesta: "Sí, es unidad cerrada" } }), "Hola, ya tengo la respuesta sobre lo que me preguntaste:\nSí, es unidad cerrada");
});

test("descartar cierra sin escribirle a nadie", async () => {
  await pa.registrar({ ctx: ctx(), input, deps: deps() });
  envios = [];
  const r = await pa.descartar({ org: ORG, preguntaId: memory.preguntasAsesor[0].id, por: "Juan", deps: deps() });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(memory.preguntasAsesor[0].estado, "descartada");
  assert.ok(!envios.some((e) => e.colega || e.wa));
});
```

- [ ] **Step 3: Correrlo y ver que falla**

Run: `node --test test/pregunta-asesor.test.js`
Expected: FAIL con `Cannot find module '../src/lib/pregunta-asesor'`

- [ ] **Step 4: Implementar**

`src/lib/pregunta-asesor.js`:

```js
// Sofi le pregunta al asesor hasta tener la respuesta (Juan, 2026-10-25;
// spec docs/superpowers/specs/2026-10-25-sofi-pregunta-al-asesor-design.md).
// Registra la pregunta, avisa al asesor de turno (campana + WhatsApp con la
// pregunta para que pueda contestar citandolo), cierra con la primera
// respuesta (CRM o WhatsApp) y se la pasa LITERAL al colega.
const { VENTANA_CERRADA } = require("./mensaje-asesor");

const TIPOS = ["precio", "unidad", "administracion", "otro"];
const PRENDIDO = /^(true|1|si|sí|on)$/i;

function activo() {
  return PRENDIDO.test(String(process.env.SOFI_PREGUNTA_ASESOR || ""));
}

function depsPorDefecto() {
  return {
    datos: require("../data/preguntas-asesor"),
    ciclo: (orgId) => require("../data/rotacion-citas").asesoresDelCiclo(orgId),
    avisarAsesor: (...a) => require("../notifications/avisar-asesor").avisarAsesor(...a),
    mensaje: (...a) => require("./mensaje-asesor").enviarYRegistrar(...a),
    texto: (...a) => require("../channels/whatsapp").sendWhatsApp(...a),
    plantilla: (...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a),
    notificar: (...a) => require("../notifications/notificar").notificar(...a),
    soloLlamada: (orgId, tel) => require("../data/colegas").esSoloLlamada(orgId, { telefono: tel }),
    lead: (orgId, id) => require("../data/leads").findById(orgId, id),
    actualizarLead: (id, patch) => require("../data/leads").update(id, patch),
  };
}
const conDeps = (deps) => ({ ...depsPorDefecto(), ...(deps || {}) });

const primerNombre = (lead) => String((lead && lead.nombre) || "").trim().split(/\s+/)[0] || "";
const quienDe = (lead) => (lead && (lead.nombre || `+${lead.phone}`)) || "alguien";

function textoParaAsesor(p) {
  return `Pregunta de un colega${p.ref ? ` — Ref ${p.ref}` : ""}: ${p.pregunta}\nRespóndeme este mensaje con el dato y se lo paso.`;
}

function textoRespuesta({ lead, pregunta }) {
  const nombre = primerNombre(lead);
  const sobre = pregunta.ref ? `la Ref ${pregunta.ref}` : "lo que me preguntaste";
  return `Hola${nombre ? ` ${nombre}` : ""}, ya tengo la respuesta sobre ${sobre}:\n${pregunta.respuesta}`;
}

async function avisar({ org, pregunta, lead, advisor, reaviso = false, deps }) {
  const d = conDeps(deps);
  if (!advisor) return { ok: false };
  const titulo = `${reaviso ? "Sigue pendiente: pregunta" : "Pregunta"} de ${quienDe(lead)}${pregunta.ref ? ` · Ref ${pregunta.ref}` : ""}`;
  await d.avisarAsesor({ org, advisor, motivo: "pregunta", lead, titulo, cuerpo: pregunta.pregunta }).catch((e) => console.warn("[preguntas] campana:", e.message));
  let r = await d.mensaje(org, advisor.phone, textoParaAsesor(pregunta), { permitirRepetido: reaviso }).catch((e) => ({ ok: false, error: e.message }));
  const nombrePlantilla = process.env.SOFI_PREGUNTA_ASESOR_PLANTILLA;
  if (!(r && r.ok) && nombrePlantilla && VENTANA_CERRADA.test((r && r.error) || "")) {
    r = await d
      .plantilla(org, advisor.phone, { name: nombrePlantilla, bodyParams: [pregunta.ref || "sin ref", pregunta.pregunta] })
      .catch((e) => ({ ok: false, error: e.message }));
  }
  if (r && r.wamid) await d.datos.actualizar(pregunta.id, { wamid_aviso: r.wamid }).catch(() => {});
  if (r && r.wamid) pregunta.wamid_aviso = r.wamid;
  return { ok: Boolean(r && r.ok) };
}

async function registrar({ ctx, input, deps }) {
  const d = conDeps(deps);
  const texto = String((input && input.pregunta) || "").trim();
  if (texto.length < 3) return "Falta la pregunta: escríbela corta, ej \"¿Precio final de la ref 10013037?\".";
  const tipo = TIPOS.includes(input.tipo) ? input.tipo : "otro";
  const ciclo = await d.ciclo(ctx.org.id).catch(() => []);
  const asesor = ciclo[0] || null;
  let creada;
  try {
    creada = await d.datos.crear({ orgId: ctx.org.id, leadId: ctx.lead.id, ref: input.ref || null, tipo, pregunta: texto, asesorId: asesor ? asesor.id : null });
  } catch (e) {
    if (d.datos.esTablaAusente && d.datos.esTablaAusente(e)) console.error("[preguntas] tabla preguntas_asesor no existe");
    else console.error("[preguntas] no se pudo registrar:", e.message);
    return "No pude registrar la pregunta. Dile que lo consultas con el equipo y le escribes, sin prometer hora.";
  }
  if (!creada.nueva) return "Esa pregunta ya está con el asesor. Dile que sigues esperando la respuesta y le escribes apenas llegue. No prometas hora.";
  if (asesor) await avisar({ org: ctx.org, pregunta: creada.pregunta, lead: ctx.lead, advisor: asesor, deps: d });
  else console.warn(`[preguntas] sin asesor en el ciclo — pregunta ${creada.pregunta.id} queda sin asignar`);
  return `Pregunta registrada (${creada.pregunta.id.slice(0, 8)}). Dile que le preguntas al asesor y le escribes apenas responda. No prometas hora. No le des nombres ni números del equipo.`;
}

async function limpiarAtencion({ pregunta, lead, d }) {
  const quedan = await d.datos.abiertasDeLead(pregunta.lead_id).catch(() => 1);
  if (quedan === 0 && lead && lead.atencion_pendiente !== "visita") {
    await d.actualizarLead(pregunta.lead_id, { atencion_pendiente: null, atencion_desde: null }).catch(() => {});
  }
}

async function entregarRespuesta({ org, pregunta, lead, advisor, deps }) {
  const d = conDeps(deps);
  const avisarFallo = async (titulo) => {
    if (!advisor) return;
    await d.notificar({ orgId: org.id, advisor, tipo: "pregunta_asesor", titulo, cuerpo: `Ref ${pregunta.ref || "sin ref"}: ${pregunta.respuesta}`, leadId: pregunta.lead_id }).catch(() => {});
  };
  if (lead.source === "colega") {
    const solo = await d.soloLlamada(org.id, lead.phone).catch(() => null);
    if (solo !== false) {
      await d.datos.actualizar(pregunta.id, { entrega_error: "solo_llamada" });
      await avisarFallo(`${quienDe(lead)} pidió solo llamada: Llámalo y dale la respuesta`);
      return { ok: false, motivo: "solo_llamada" };
    }
  }
  const r = await d.texto(org, lead.phone, textoRespuesta({ lead, pregunta })).catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok) {
    await d.datos.actualizar(pregunta.id, { estado: "entregada", entregada_at: new Date().toISOString(), entrega_error: null });
    return { ok: true };
  }
  const ventana = VENTANA_CERRADA.test((r && r.error) || "");
  const nombrePlantilla = process.env.SOFI_RESPUESTA_LISTA_PLANTILLA;
  if (ventana && nombrePlantilla) {
    const r2 = await d
      .plantilla(org, lead.phone, { name: nombrePlantilla, bodyParams: [primerNombre(lead) || "hola", pregunta.ref || "tu consulta"] })
      .catch((e) => ({ ok: false, error: e.message }));
    if (r2 && r2.ok) {
      await d.datos.actualizar(pregunta.id, { entrega_error: "esperando_ventana" });
      return { ok: false, motivo: "esperando_ventana" };
    }
  }
  const motivo = ventana ? "ventana_cerrada" : String((r && r.error) || "error").slice(0, 200);
  await d.datos.actualizar(pregunta.id, { entrega_error: motivo });
  await avisarFallo(`No le pude pasar la respuesta a ${quienDe(lead)}: escríbele desde el chat`);
  return { ok: false, motivo };
}

async function responder({ org, preguntaId, respuesta, advisor, via, deps }) {
  const d = conDeps(deps);
  const texto = String(respuesta || "").trim();
  if (texto.length < 2) return { ok: false, codigo: 400, error: "La respuesta está vacía." };
  const p = await d.datos.porId(preguntaId);
  if (!p || p.org_id !== org.id) return { ok: false, codigo: 404, error: "No encontré esa pregunta." };
  if (p.estado !== "pendiente") {
    const quien = p.respondida_por ? ` (la respondió ${p.respondida_por})` : "";
    return { ok: false, codigo: 409, error: `Esa pregunta ya está cerrada${quien}.` };
  }
  const cerrada = await d.datos.marcarRespondida(p.id, { respuesta: texto, por: advisor.name, via });
  if (!cerrada) return { ok: false, codigo: 409, error: "Esa pregunta ya la respondió otra persona." };
  const lead = await d.lead(org.id, p.lead_id);
  if (!lead) return { ok: true, texto: "Quedó guardada, pero no encontré el chat del colega." };
  await limpiarAtencion({ pregunta: cerrada, lead, d });
  const ent = await entregarRespuesta({ org, pregunta: cerrada, lead, advisor, deps: d });
  if (ent.ok) return { ok: true, texto: "Listo: ya le pasé la respuesta." };
  if (ent.motivo === "esperando_ventana") return { ok: true, texto: "Le avisé que ya tengo la respuesta; se la paso apenas conteste." };
  if (ent.motivo === "solo_llamada") return { ok: true, texto: "Quedó guardada. Pidió solo llamada: llámalo y dale la respuesta." };
  return { ok: true, texto: "Quedó guardada, pero no se la pude pasar. Escríbele desde el chat." };
}

async function descartar({ org, preguntaId, por, deps }) {
  const d = conDeps(deps);
  const p = await d.datos.porId(preguntaId);
  if (!p || p.org_id !== org.id) return { ok: false, codigo: 404, error: "No encontré esa pregunta." };
  if (p.estado !== "pendiente") return { ok: false, codigo: 409, error: "Esa pregunta ya está cerrada." };
  await d.datos.actualizar(p.id, { estado: "descartada", descartada_por: por });
  const lead = await d.lead(org.id, p.lead_id).catch(() => null);
  await limpiarAtencion({ pregunta: p, lead, d });
  return { ok: true };
}

async function entregarPendientesDe({ org, lead, deps }) {
  const d = conDeps(deps);
  const filas = await d.datos.porEntregarDe(lead.id).catch(() => []);
  let n = 0;
  for (const p of filas) {
    const r = await d.texto(org, lead.phone, textoRespuesta({ lead, pregunta: p })).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) {
      await d.datos.actualizar(p.id, { estado: "entregada", entregada_at: new Date().toISOString(), entrega_error: null });
      n++;
    }
  }
  return n;
}

async function contextoAsesor({ org, preguntaId = null }) {
  const datos = require("../data/preguntas-asesor");
  const pendientes = await datos.pendientesDeOrg(org.id);
  const citada = preguntaId ? pendientes.find((p) => p.id === preguntaId) || null : null;
  return { pendientes, citada };
}

async function hayPorEntregar(leadId) {
  const filas = await require("../data/preguntas-asesor").porEntregarDe(leadId);
  return filas.length > 0;
}

module.exports = { activo, TIPOS, registrar, avisar, responder, descartar, textoRespuesta, entregarRespuesta, entregarPendientesDe, contextoAsesor, hayPorEntregar };
```

- [ ] **Step 5: Correr el test**

Run: `node --test test/pregunta-asesor.test.js`
Expected: PASS (11 tests). Si el test de `avisar-asesor` existente compara la lista de motivos, correr también `node --test test/avisar-asesor*.test.js` y ajustarlo agregando `pregunta`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pregunta-asesor.js src/notifications/avisar-asesor.js test/pregunta-asesor.test.js
git commit -m "feat(preguntas): registrar, avisar, responder y entregar la respuesta al colega"
```

---

### Task 4: Scheduler de la escalera de preguntas

**Files:**
- Create: `src/scheduler/preguntas-escalera.js`
- Modify: `src/server.js:156` (después de la línea de `citas-escalera`)
- Test: `test/preguntas-escalera-scheduler.test.js`

**Interfaces:**
- Consumes: Task 1 `datos.pendientes()`, `datos.actualizar()`; Task 2 `pasoDePregunta`; Task 3 `avisar({ org, pregunta, lead, advisor, reaviso, deps })`, `activo()`.
- Produces: `runOnce({ ahora, deps }) → Promise<{ asignadas, rotadas, reavisadas }>`, `start()`, `stop()`. deps: `{ datos, org, ciclo, lead, avisar, notificar }`.

- [ ] **Step 1: Escribir el test que falla**

`test/preguntas-escalera-scheduler.test.js`:

```js
// Tick de la escalera de preguntas (spec 2026-10-25 §5.3).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const datos = require("../src/data/preguntas-asesor");
const sched = require("../src/scheduler/preguntas-escalera");

const A1 = { id: "a1", name: "Daiana", phone: "1" };
const A2 = { id: "a2", name: "Claudia", phone: "2" };
let log;
const deps = (over = {}) => ({
  datos,
  org: async () => ({ id: "org-1", name: "Diamond" }),
  ciclo: async () => [A1, A2],
  lead: async () => ({ id: "l1", phone: "57300", nombre: "Andrea", source: "colega" }),
  avisar: async ({ advisor, reaviso }) => { log.push({ avisar: advisor.id, reaviso: Boolean(reaviso) }); return { ok: true }; },
  notificar: async (n) => { log.push({ nota: n.advisor.id, titulo: n.titulo }); return { ok: true }; },
  ...over,
});

beforeEach(() => { log = []; memory.preguntasAsesor.length = 0; });

const crear = async (over = {}) => {
  const { pregunta } = await datos.crear({ orgId: "org-1", leadId: "l1", ref: "1", tipo: "precio", pregunta: "¿precio?", asesorId: "a1" });
  Object.assign(pregunta, { asignada_at: "2026-10-08T14:00:00Z", ...over });
  return pregunta;
};

test("a la hora rota, avisa al nuevo y le cuenta al anterior por la campana", async () => {
  const p = await crear();
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps() });
  assert.strictEqual(r.rotadas, 1);
  assert.strictEqual(p.asesor_id, "a2");
  assert.strictEqual(p.asignada_at, "2026-10-08T15:00:00.000Z");
  assert.strictEqual(p.reaviso_at, null);
  assert.deepStrictEqual(log.find((x) => x.avisar), { avisar: "a2", reaviso: false });
  assert.ok(log.some((x) => x.nota === "a1" && /pasó a Claudia/.test(x.titulo)));
});

test("a los 15 min repite el aviso al mismo asesor y marca reaviso_at", async () => {
  const p = await crear();
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T14:20:00Z"), deps: deps() });
  assert.strictEqual(r.reavisadas, 1);
  assert.deepStrictEqual(log, [{ avisar: "a1", reaviso: true }]);
  assert.strictEqual(p.reaviso_at, "2026-10-08T14:20:00.000Z");
});

test("una sin asesor se asigna al primero", async () => {
  const p = await crear({ asesor_id: null });
  const r = await sched.runOnce({ ahora: new Date("2026-10-08T14:01:00Z"), deps: deps() });
  assert.strictEqual(r.asignadas, 1);
  assert.strictEqual(p.asesor_id, "a1");
});

test("rotar a sí mismo (ciclo de uno) no le manda la nota de reasignación", async () => {
  await crear();
  await sched.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps: deps({ ciclo: async () => [A1] }) });
  assert.ok(log.some((x) => x.avisar === "a1"));
  assert.ok(!log.some((x) => x.nota));
});

test("de noche no hace nada", async () => {
  await crear();
  const r = await sched.runOnce({ ahora: new Date("2026-10-09T03:00:00Z"), deps: deps() });
  assert.deepStrictEqual(r, { asignadas: 0, rotadas: 0, reavisadas: 0 });
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/preguntas-escalera-scheduler.test.js`
Expected: FAIL con `Cannot find module '../src/scheduler/preguntas-escalera'`

- [ ] **Step 3: Implementar**

`src/scheduler/preguntas-escalera.js`:

```js
// La escalera de las preguntas al asesor (spec 2026-10-25 §5.3). Cada tick
// mira las pendientes: sin asesor -> se asigna; 15 min sin respuesta -> se le
// repite; 60 min -> pasa al siguiente del ciclo. Sin limite: sigue hasta que
// alguien conteste o la descarten en el CRM. Pausa de noche y domingo.
const { pasoDePregunta } = require("../lib/preguntas-escalera");
const pa = require("../lib/pregunta-asesor");

const INTERVALO_MIN = Number(process.env.PREGUNTA_INTERVALO_MIN || 5);
const MAX_ACCIONES = 20;

function canal(deps) {
  return {
    datos: deps.datos || require("../data/preguntas-asesor"),
    org: deps.org || ((id) => require("../data/organizations").findById(id)),
    ciclo: deps.ciclo || ((orgId) => require("../data/rotacion-citas").asesoresDelCiclo(orgId)),
    lead: deps.lead || ((orgId, id) => require("../data/leads").findById(orgId, id)),
    avisar: deps.avisar || ((args) => pa.avisar(args)),
    notificar: deps.notificar || ((...a) => require("../notifications/notificar").notificar(...a)),
  };
}

let corriendo = false;
async function runOnce({ ahora = new Date(), deps = {} } = {}) {
  const res = { asignadas: 0, rotadas: 0, reavisadas: 0 };
  if (corriendo) return res;
  corriendo = true;
  const c = canal(deps);
  try {
    const pendientes = await c.datos.pendientes().catch((e) => {
      console.error("[preguntas-escalera] no se pudieron leer las preguntas:", e.message);
      return [];
    });
    const porOrg = new Map();
    let acciones = 0;
    for (const p of pendientes) {
      if (acciones >= MAX_ACCIONES) break;
      try {
        if (!porOrg.has(p.org_id)) {
          const org = await c.org(p.org_id).catch(() => null);
          const ciclo = org ? await c.ciclo(org.id).catch(() => []) : [];
          porOrg.set(p.org_id, { org, ciclo });
        }
        const { org, ciclo } = porOrg.get(p.org_id);
        if (!org) continue;
        const paso = pasoDePregunta({ pregunta: p, ciclo, ahora });
        if (paso.accion === "nada") continue;
        acciones++;
        const lead = await c.lead(org.id, p.lead_id).catch(() => null);
        if (paso.accion === "reaviso") {
          await c.datos.actualizar(p.id, { reaviso_at: ahora.toISOString() });
          p.reaviso_at = ahora.toISOString();
          const actual = ciclo.find((a) => a.id === p.asesor_id);
          await c.avisar({ org, pregunta: p, lead, advisor: actual, reaviso: true });
          res.reavisadas++;
          continue;
        }
        const anterior = ciclo.find((a) => a.id === p.asesor_id) || null;
        const patch = { asesor_id: paso.nuevo.id, asignada_at: ahora.toISOString(), reaviso_at: null, wamid_aviso: null };
        await c.datos.actualizar(p.id, patch);
        Object.assign(p, patch);
        await c.avisar({ org, pregunta: p, lead, advisor: paso.nuevo, reaviso: false });
        if (paso.accion === "asignar") res.asignadas++;
        else res.rotadas++;
        if (anterior && anterior.id !== paso.nuevo.id) {
          await c.notificar({
            orgId: org.id, advisor: anterior, tipo: "pregunta_asesor",
            titulo: `La pregunta pasó a ${paso.nuevo.name}`, cuerpo: p.pregunta, leadId: p.lead_id,
          }).catch(() => {});
        }
      } catch (e) {
        console.error("[preguntas-escalera] error con pregunta", p.id, e.message);
      }
    }
    return res;
  } finally {
    corriendo = false;
  }
}

let timer = null;
function start() {
  if (!pa.activo()) {
    console.log("[preguntas-escalera] apagada (SOFI_PREGUNTA_ASESOR)");
    return null;
  }
  const tick = () => runOnce().catch((e) => console.error("[preguntas-escalera] runOnce:", e.message));
  setTimeout(tick, 60 * 1000);
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  console.log(`[preguntas-escalera] activa — cada ${INTERVALO_MIN} min`);
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runOnce, start, stop };
```

- [ ] **Step 4: Arrancarlo en `src/server.js`**

Justo después de la línea `if (config.supabaseUrl) require("./scheduler/citas-escalera").start();`:

```js
  if (config.supabaseUrl) require("./scheduler/preguntas-escalera").start();
```

- [ ] **Step 5: Correr el test**

Run: `node --test test/preguntas-escalera-scheduler.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/scheduler/preguntas-escalera.js src/server.js test/preguntas-escalera-scheduler.test.js
git commit -m "feat(preguntas): scheduler de la escalera de preguntas al asesor"
```

---

### Task 5: Tools y filtro por interruptor

**Files:**
- Modify: `src/agent/tools.js` (`TOOL_DEFINITIONS`, `executeTool`, `module.exports`)
- Modify: `src/agent/engine.js` (las 4 apariciones de `tools: TOOL_DEFINITIONS` y el import)
- Test: `test/preguntas-tools.test.js`

**Interfaces:**
- Consumes: Task 3 `registrar`, `responder`, `activo`.
- Produces: tools `preguntar_al_asesor({ pregunta, ref?, tipo })` y `responder_pregunta({ pregunta_id, respuesta })`; `toolsActivas() → ToolDefinition[]`. `ctx.preguntaId` (opcional) = pregunta citada.

- [ ] **Step 1: Escribir el test que falla**

`test/preguntas-tools.test.js`:

```js
// Tools de preguntas al asesor (spec 2026-10-25 §5.1 y §5.4).
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const { executeTool, toolsActivas } = require("../src/agent/tools");

const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", activo: true, recibe_citas: true, orden_citas: 1 };
beforeEach(() => {
  memory.preguntasAsesor.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push({ ...A1 });
  memory.leads.length = 0;
  memory.leads.push({ id: "l1", org_id: "org-1", phone: "573125550000", nombre: "Andrea", source: "colega" });
});
afterEach(() => { delete process.env.SOFI_PREGUNTA_ASESOR; });

const nombres = () => toolsActivas().map((t) => t.name);

test("apagado: las tools no existen para el modelo", () => {
  assert.ok(!nombres().includes("preguntar_al_asesor"));
  assert.ok(!nombres().includes("responder_pregunta"));
});

test("encendido: aparecen las dos", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  assert.ok(nombres().includes("preguntar_al_asesor"));
  assert.ok(nombres().includes("responder_pregunta"));
});

test("apagado: executeTool no registra nada aunque el modelo la llame", async () => {
  const out = await executeTool("preguntar_al_asesor", { pregunta: "¿precio final?", ref: "1", tipo: "precio" }, { org: { id: "org-1" }, lead: memory.leads[0] });
  assert.match(out, /apagada/);
  assert.strictEqual(memory.preguntasAsesor.length, 0);
});

test("un asesor no puede usar preguntar_al_asesor, y un colega no puede responder", async () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  const a = await executeTool("preguntar_al_asesor", { pregunta: "¿x?", tipo: "otro" }, { org: { id: "org-1" }, lead: memory.leads[0], advisor: A1 });
  assert.match(a, /para colegas y clientes/);
  const b = await executeTool("responder_pregunta", { pregunta_id: "x", respuesta: "y" }, { org: { id: "org-1" }, lead: memory.leads[0] });
  assert.match(b, /solo para un asesor/);
});

test("responder_pregunta usa la pregunta citada si no viene id", async () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  memory.preguntasAsesor.push({ id: "p1", org_id: "org-1", lead_id: "l1", ref: "1", tipo: "precio", pregunta: "¿precio?", estado: "pendiente", asesor_id: "a1" });
  const out = await executeTool("responder_pregunta", { respuesta: "450 final" }, { org: { id: "org-1" }, lead: { id: "la" }, advisor: A1, preguntaId: "p1" });
  assert.match(out, /Listo|guardada|avisé/);
  assert.strictEqual(memory.preguntasAsesor[0].respuesta, "450 final");
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/preguntas-tools.test.js`
Expected: FAIL con `toolsActivas is not a function`

- [ ] **Step 3: Agregar las definiciones**

En `src/agent/tools.js`, al final del arreglo `TOOL_DEFINITIONS` (antes del `];` que lo cierra, después de `horarios_disponibles`):

```js
  {
    name: "preguntar_al_asesor",
    description:
      "Para colegas y clientes. Usala cuando te pregunten un dato de una propiedad que NO está en la ficha ni en tus herramientas (precio final o si negocian, nombre de la unidad o si es unidad cerrada, administración, otro dato de la propiedad). Registra la pregunta y el equipo le insiste al asesor hasta tener la respuesta; cuando llega, se la pasamos a la persona. NO la uses para comisiones ni condiciones: eso se confirma con el asesor.",
    input_schema: {
      type: "object",
      properties: {
        pregunta: { type: "string", description: "La pregunta corta y concreta, con la ref si la hay. Ej: \"¿Precio final de la ref 10013037?\"" },
        ref: { type: "string", description: "Ref de la propiedad, si la pregunta es por una." },
        tipo: { type: "string", enum: ["precio", "unidad", "administracion", "otro"] },
      },
      required: ["pregunta", "tipo"],
    },
  },
  {
    name: "responder_pregunta",
    description:
      "SOLO para un asesor de la casa (ctx.advisor) contestando una pregunta pendiente de un colega o cliente. En respuesta van LAS PALABRAS DEL ASESOR, tal cual, sin reescribirlas ni completarlas: se le pasan literal a la persona.",
    input_schema: {
      type: "object",
      properties: {
        pregunta_id: { type: "string", description: "El id de la pregunta, de PREGUNTAS PENDIENTES. Si el asesor citó el aviso, puede omitirse." },
        respuesta: { type: "string", description: "Lo que dijo el asesor, literal." },
      },
      required: ["respuesta"],
    },
  },
```

- [ ] **Step 4: Agregar `toolsActivas` y el despacho**

En `src/agent/tools.js`, justo después del `];` que cierra `TOOL_DEFINITIONS`:

```js
// Las tools de preguntas al asesor solo existen con SOFI_PREGUNTA_ASESOR
// (interruptor sin excepciones: apagado, el modelo ni las ve).
const TOOLS_PREGUNTA = ["preguntar_al_asesor", "responder_pregunta"];
function toolsActivas() {
  if (require("../lib/pregunta-asesor").activo()) return TOOL_DEFINITIONS;
  return TOOL_DEFINITIONS.filter((t) => !TOOLS_PREGUNTA.includes(t.name));
}
```

Dentro de `executeTool`, junto a `if (name === "horarios_disponibles") return horariosDisponibles(input || {}, ctx);`:

```js
  if (name === "preguntar_al_asesor" || name === "responder_pregunta") {
    const pa = require("../lib/pregunta-asesor");
    if (!pa.activo()) return "Esta herramienta está apagada. Si no tienes el dato, dile que lo consultas con el equipo, sin prometer hora.";
    if (name === "preguntar_al_asesor") {
      if (ctx.advisor) return "Esta herramienta es para colegas y clientes, no para un asesor de la casa.";
      return pa.registrar({ ctx, input: input || {} });
    }
    if (!ctx.advisor) return "Esta herramienta es solo para un asesor de la casa.";
    const preguntaId = (input && input.pregunta_id) || ctx.preguntaId || null;
    if (!preguntaId) return "No sé a qué pregunta responde. Pregúntale cuál de las PREGUNTAS PENDIENTES es.";
    const r = await pa.responder({ org: ctx.org, preguntaId, respuesta: input && input.respuesta, advisor: ctx.advisor, via: "whatsapp" });
    return r.ok ? r.texto : r.error;
  }
```

En `module.exports` de `src/agent/tools.js`, agregar `toolsActivas` a la lista.

- [ ] **Step 5: Usar `toolsActivas()` en el engine**

En `src/agent/engine.js`, cambiar el import de la línea 9:

```js
const { TOOL_DEFINITIONS, executeTool, maybeCaptadorAlert, toolsActivas } = require("./tools");
```

y reemplazar las 4 apariciones de `tools: TOOL_DEFINITIONS` por `tools: toolsActivas()` (líneas ~356, ~392, ~410, ~428). Si `TOOL_DEFINITIONS` queda sin uso en el engine, quitarlo del import.

- [ ] **Step 6: Correr los tests**

Run: `node --test test/preguntas-tools.test.js`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools.js src/agent/engine.js test/preguntas-tools.test.js
git commit -m "feat(preguntas): tools preguntar_al_asesor y responder_pregunta, con interruptor"
```

---

### Task 6: Prompts, contexto del engine y respuesta citada por WhatsApp

**Files:**
- Modify: `src/agent/prompts.js` (`promptAsesor`, `promptColega`, cliente en `buildSystemPrompt`)
- Modify: `src/agent/engine.js` (`procesarMensaje` y la llamada a `buildSystemPrompt`)
- Modify: `src/channels/whatsapp.js` (bloque `message.context?.id` y después del envío de la respuesta)
- Test: `test/preguntas-prompts.test.js`

**Interfaces:**
- Consumes: Task 3 `activo()`, `contextoAsesor({ org, preguntaId })`, `hayPorEntregar(leadId)`, `entregarPendientesDe({ org, lead })`; Task 1 `porWamid(wamid)`.
- Produces: `buildSystemPrompt({ ..., preguntas = null, respuestaPorEntregar = false })`; `procesarMensaje({ ..., preguntaId = null })`; `ctx.preguntaId`.

- [ ] **Step 1: Escribir el test que falla**

`test/preguntas-prompts.test.js`:

```js
// Reglas de preguntas al asesor en los prompts (spec 2026-10-25 §5.1, §5.4).
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const ORG = { id: "org-1", name: "Diamond" };
const texto = (bloques) => bloques.map((b) => b.text).join("\n");
const cliente = () => texto(buildSystemPrompt({ org: ORG, lead: { id: "l1" }, qualified: false }));
const colega = (extra = {}) => texto(buildSystemPrompt({ org: ORG, lead: { id: "l1" }, colega: { nombre: "Andrea" }, ...extra }));
const asesor = (preguntas) => texto(buildSystemPrompt({ org: ORG, lead: { id: "l1" }, advisor: { name: "Daiana Zea" }, preguntas }));
afterEach(() => { delete process.env.SOFI_PREGUNTA_ASESOR; });

test("apagado: ningún prompt habla de preguntar_al_asesor", () => {
  for (const p of [cliente(), colega(), asesor({ pendientes: [], citada: null })]) assert.doesNotMatch(p, /preguntar_al_asesor|responder_pregunta/);
});

test("encendido: colega y cliente tienen la regla, sin voseo", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  for (const p of [cliente(), colega()]) {
    assert.match(p, /llama preguntar_al_asesor/);
    assert.match(p, /Le pregunto al asesor y apenas me responda te escribo/);
    assert.match(p, /Nunca prometas una hora/);
  }
});

test("colega con respuesta por entregar: se le avisa a Sofi", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  assert.match(colega({ respuestaPorEntregar: true }), /RESPUESTA DEL ASESOR LISTA/);
  assert.doesNotMatch(colega(), /RESPUESTA DEL ASESOR LISTA/);
});

test("asesor: lista las pendientes con su id y marca la citada", () => {
  process.env.SOFI_PREGUNTA_ASESOR = "true";
  const p1 = { id: "11111111-aaaa", ref: "10013037", pregunta: "¿Precio final?" };
  const p2 = { id: "22222222-bbbb", ref: null, pregunta: "¿Es unidad cerrada?" };
  const sin = asesor({ pendientes: [p1, p2], citada: null });
  assert.match(sin, /PREGUNTAS PENDIENTES/);
  assert.match(sin, /11111111-aaaa · Ref 10013037 · ¿Precio final\?/);
  assert.match(sin, /responder_pregunta/);
  const con = asesor({ pendientes: [p1, p2], citada: p1 });
  assert.match(con, /EL ASESOR CITÓ LA PREGUNTA 11111111-aaaa/);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/preguntas-prompts.test.js`
Expected: FAIL en "encendido: colega y cliente tienen la regla"

- [ ] **Step 3: Agregar las reglas en `src/agent/prompts.js`**

Arriba de `function promptAsesor`, agregar:

```js
// Preguntas al asesor (spec 2026-10-25). Solo con SOFI_PREGUNTA_ASESOR.
function preguntasActivas() {
  return require("../lib/pregunta-asesor").activo();
}
function reglaPreguntaAsesor() {
  if (!preguntasActivas()) return "";
  return `

DATO QUE NO TIENES: si te preguntan un dato de una propiedad que no está en la ficha ni en tus herramientas (precio final o si negocian, nombre de la unidad o si es unidad cerrada, administración u otro dato de la propiedad), NO lo inventes ni lo deduzcas: llama preguntar_al_asesor y dile "Le pregunto al asesor y apenas me responda te escribo." Nunca prometas una hora. Si es sobre comisión o condiciones, la respuesta sigue siendo que eso se confirma con el asesor; no uses la herramienta.`;
}
function bloquePreguntasAsesor(preguntas) {
  if (!preguntasActivas() || !preguntas) return "";
  const lista = (preguntas.pendientes || []).map((p) => `- ${p.id} · ${p.ref ? `Ref ${p.ref}` : "sin ref"} · ${p.pregunta}`).join("\n");
  const citada = preguntas.citada ? `\n\nEL ASESOR CITÓ LA PREGUNTA ${preguntas.citada.id}: lo que escribe es la respuesta a esa. Llama responder_pregunta con su texto literal.` : "";
  if (!lista && !citada) return "";
  return `\n\nPREGUNTAS PENDIENTES (de colegas y clientes, esperando dato del equipo):\n${lista || "- ninguna"}${citada}\nSi el asesor te da un dato que contesta una de estas, llama responder_pregunta con su id y sus palabras literales. Si hay varias y no sabes a cuál responde, pregúntale cuál antes de registrar.`;
}
```

En `promptAsesor({ org, advisor, now })`, cambiar la firma a `promptAsesor({ org, advisor, now, preguntas = null })` y la línea de `contexto` a:

```js
  const contexto = `${now ? `FECHA Y HORA ACTUAL EN COLOMBIA: ${now.legible} (referencia ISO: ${now.iso}).\n\n` : ""}ASESOR: ${advisor.name}${advisor.especialidad ? ` — especialidad ${advisor.especialidad}` : ""}.${bloquePreguntasAsesor(preguntas)}`;
```

En `promptColega`, agregar `respuestaPorEntregar = false` a los parámetros desestructurados; en su `return`, cambiar `stable + REGLAS_COMUNES` por `stable + REGLAS_COMUNES + reglaPreguntaAsesor()` y el `contexto` agrega al final:

```js
${respuestaPorEntregar && preguntasActivas() ? "\n\nRESPUESTA DEL ASESOR LISTA: el sistema le manda la respuesta a su pregunta justo después de tu mensaje. No la repitas ni digas que todavía no la tienes." : ""}
```

(concatenado al final del template literal de `contexto`, después de `${bloqueHistorial(historial, lead)}`).

En `buildSystemPrompt`, cambiar la firma para recibir `preguntas = null, respuestaPorEntregar = false`, pasar `preguntas` a `promptAsesor({ org, advisor, now, preguntas })` y `respuestaPorEntregar` a `promptColega({ ..., respuestaPorEntregar })`. En el `return` del cliente, cambiar `stable + REGLAS_COMUNES` por `stable + REGLAS_COMUNES + reglaPreguntaAsesor()` y agregar al final del `contexto` del cliente la misma línea condicional de `RESPUESTA DEL ASESOR LISTA`.

- [ ] **Step 4: Pasar el contexto desde el engine**

En `src/agent/engine.js`:
1. Firma: `async function procesarMensaje({ ..., radarSignalId = null, preguntaId = null })`.
2. En `const ctx = { ... }`, debajo de `radarSignalId,`: `preguntaId,`.
3. Justo antes de `const system = buildSystemPrompt({` (línea ~343):

```js
  // Preguntas al asesor (spec 2026-10-25): al asesor se le muestran las
  // pendientes; al colega/cliente, si tiene una respuesta lista por entregar.
  let preguntas = null;
  let respuestaPorEntregar = false;
  const pa = require("../lib/pregunta-asesor");
  if (pa.activo()) {
    if (advisor) preguntas = await pa.contextoAsesor({ org, preguntaId }).catch(() => null);
    else respuestaPorEntregar = await pa.hayPorEntregar(lead.id).catch(() => false);
  }
```

4. Agregar `preguntas, respuestaPorEntregar,` al objeto que recibe `buildSystemPrompt({ ... })`.

- [ ] **Step 5: Respuesta citada y entrega pendiente en `src/channels/whatsapp.js`**

En el bloque `if (message.context?.id) { ... }` (línea ~389), declarar antes del bloque `let preguntaId = null;` y, dentro, después de resolver `radarSignalId`:

```js
        if (!replyToId && !radarSignalId && require("../lib/pregunta-asesor").activo()) {
          const p = await require("../data/preguntas-asesor").porWamid(message.context.id).catch(() => null);
          preguntaId = p?.id || null;
        }
```

En la llamada `engine.procesarMensaje({ ... })` agregar `preguntaId,`.

Después de enviar la respuesta (dentro de `if (reply) { ... }`, luego del `sendWhatsApp` y su registro), agregar:

```js
        if (ok && leadAtendido && leadAtendido.source !== "asesor" && require("../lib/pregunta-asesor").activo()) {
          await require("../lib/pregunta-asesor").entregarPendientesDe({ org, lead: leadAtendido }).catch((e) => console.warn("[preguntas] entrega pendiente:", e.message));
        }
```

- [ ] **Step 6: Correr los tests y la suite de prompts**

Run: `node --test test/preguntas-prompts.test.js`
Expected: PASS (4 tests)
Run: `npm test`
Expected: todo en verde (incluye el test de tuteo/voseo).

- [ ] **Step 7: Commit**

```bash
git add src/agent/prompts.js src/agent/engine.js src/channels/whatsapp.js test/preguntas-prompts.test.js
git commit -m "feat(preguntas): reglas de Sofi, pendientes del asesor y respuesta citada por WhatsApp"
```

---

### Task 7: API del bot para el CRM

**Files:**
- Modify: `src/api/crm.js` (después de `/api/citas/accion`)
- Test: `test/preguntas-endpoint.test.js`

**Interfaces:**
- Consumes: Task 3 `responder`, `descartar`; `advisors.findByAuthUserId(orgId, authUserId)`; `organizations.getDefault()`.
- Produces: `POST /api/preguntas/responder { preguntaId, respuesta, authUserId }` → `{ ok, texto }` | error; `POST /api/preguntas/descartar { preguntaId, authUserId, esAdmin }` → `{ ok }` | error.

- [ ] **Step 1: Escribir el test que falla**

`test/preguntas-endpoint.test.js`:

```js
// POST /api/preguntas/responder y /descartar (spec 2026-10-25 §5.4).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const supabasePath = require.resolve("../src/data/supabase");
delete require.cache[supabasePath];
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: null };

const memory = require("../src/data/memory");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const pa = require("../src/lib/pregunta-asesor");
const router = require("../src/api/crm");

const ORG = { id: "org-1", name: "Diamond" };
function rutaDe(path) {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods.post);
  assert.ok(capa, `No existe POST ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}
function respuestaFalsa() {
  const r = { codigo: 200, cuerpo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
}
const llamar = async (path, body) => { const res = respuestaFalsa(); await rutaDe(path)({ body }, res); return res; };

let llamadas;
beforeEach(() => {
  llamadas = [];
  organizations.getDefault = async () => ORG;
  advisors.findByAuthUserId = async (_o, id) => (id === "u1" ? { id: "a1", name: "Daiana Zea", activo: true } : null);
  pa.responder = async (a) => { llamadas.push(["responder", a.preguntaId, a.respuesta, a.via]); return { ok: true, texto: "Listo: ya le pasé la respuesta." }; };
  pa.descartar = async (a) => { llamadas.push(["descartar", a.preguntaId, a.por]); return { ok: true }; };
});

test("responder: faltan datos 400, sin asesor 403, ok pasa por el bot", async () => {
  assert.strictEqual((await llamar("/api/preguntas/responder", { preguntaId: "p1" })).codigo, 400);
  assert.strictEqual((await llamar("/api/preguntas/responder", { preguntaId: "p1", respuesta: "450", authUserId: "zz" })).codigo, 403);
  const ok = await llamar("/api/preguntas/responder", { preguntaId: "p1", respuesta: "450", authUserId: "u1" });
  assert.strictEqual(ok.codigo, 200);
  assert.deepStrictEqual(llamadas[0], ["responder", "p1", "450", "crm"]);
});

test("responder: el código de error del módulo llega al CRM", async () => {
  pa.responder = async () => ({ ok: false, codigo: 409, error: "Esa pregunta ya está cerrada." });
  const r = await llamar("/api/preguntas/responder", { preguntaId: "p1", respuesta: "450", authUserId: "u1" });
  assert.deepStrictEqual([r.codigo, r.cuerpo.error], [409, "Esa pregunta ya está cerrada."]);
});

test("descartar: lo puede hacer un admin sin fila de asesor", async () => {
  assert.strictEqual((await llamar("/api/preguntas/descartar", { preguntaId: "p1", authUserId: "zz" })).codigo, 403);
  const r = await llamar("/api/preguntas/descartar", { preguntaId: "p1", authUserId: "zz", esAdmin: true });
  assert.strictEqual(r.codigo, 200);
  assert.deepStrictEqual(llamadas[0], ["descartar", "p1", "admin"]);
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/preguntas-endpoint.test.js`
Expected: FAIL con `No existe POST /api/preguntas/responder`

- [ ] **Step 3: Implementar las rutas**

En `src/api/crm.js`, después del cierre de `router.post("/api/citas/accion", ...)`:

```js
// Preguntas de Sofi al asesor (spec 2026-10-25 §5.4): "Responder a Sofi" y
// "Descartar" desde "Para atender" del CRM. Mismo criterio que citas/accion:
// responder exige un asesor activo; descartar tambien lo puede hacer un admin.
router.post("/api/preguntas/responder", async (req, res) => {
  try {
    const { preguntaId, respuesta, authUserId } = req.body || {};
    if (!preguntaId || !respuesta || !authUserId) return res.status(400).json({ error: "faltan preguntaId, respuesta o authUserId" });
    const org = await organizations.getDefault();
    const advisor = await require("../data/advisors").findByAuthUserId(org.id, authUserId);
    if (!advisor || advisor.activo === false) return res.status(403).json({ error: "tu usuario no está ligado a un asesor activo" });
    const r = await require("../lib/pregunta-asesor").responder({ org, preguntaId, respuesta, advisor, via: "crm" });
    if (!r.ok) return res.status(r.codigo || 500).json({ error: r.error });
    res.json({ ok: true, texto: r.texto });
  } catch (e) {
    console.error("[api] Error en preguntas/responder:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/preguntas/descartar", async (req, res) => {
  try {
    const { preguntaId, authUserId, esAdmin } = req.body || {};
    if (!preguntaId || !authUserId) return res.status(400).json({ error: "faltan preguntaId o authUserId" });
    const org = await organizations.getDefault();
    const advisor = await require("../data/advisors").findByAuthUserId(org.id, authUserId);
    const asesorActivo = advisor && advisor.activo !== false;
    if (!asesorActivo && esAdmin !== true) return res.status(403).json({ error: "tu usuario no está ligado a un asesor activo" });
    const r = await require("../lib/pregunta-asesor").descartar({ org, preguntaId, por: asesorActivo ? advisor.name : "admin" });
    if (!r.ok) return res.status(r.codigo || 500).json({ error: r.error });
    res.json({ ok: true });
  } catch (e) {
    console.error("[api] Error en preguntas/descartar:", e);
    res.status(500).json({ error: e.message });
  }
});
```

Nota: el test reemplaza `pa.responder`/`pa.descartar` en el objeto del módulo; por eso las rutas llaman `require("../lib/pregunta-asesor").responder(...)` en cada request y no lo destructuran.

- [ ] **Step 4: Correr el test**

Run: `node --test test/preguntas-endpoint.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/crm.js test/preguntas-endpoint.test.js
git commit -m "feat(preguntas): API del bot para responder y descartar desde el CRM"
```

---

### Task 8: Visitas — el nuevo final de la escalera (`CITAS_SIN_CORTE`)

**Files:**
- Modify: `src/scheduler/citas-escalera.js` (`pasoDeEscalera`, `tocaReaviso`, `canal`, `runOnce`, nueva `avisarEspera`)
- Test: `test/citas-sin-corte.test.js`

**Interfaces:**
- Produces: `pasoDeEscalera` puede devolver `{ accion: "extender", nuevoCorte: ISO }` con `CITAS_SIN_CORTE` encendido. `citasSinCorte() → boolean` exportada.

Diseño de la implementación: al llegar `corte_at` por primera vez, en vez de cortar se **extiende**: `corte_original_at = corte_at`, `corte_at = visita − CITAS_CANCELAR_HORAS_ANTES`, `aviso_espera_at = ahora`, y Sofi le avisa una vez al colega. Así el CRM sigue mostrando "Confírmala antes de {corte_at} o se cancela" con la hora correcta, y el corte existente (que no respeta la pausa) cancela a 2 h de la visita.

- [ ] **Step 1: Escribir el test que falla**

`test/citas-sin-corte.test.js`:

```js
// CITAS_SIN_CORTE (spec 2026-10-25 §6): en el plazo no se cancela, se avisa
// una vez "seguimos confirmando" y el corte pasa a 2 h antes de la visita.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const escalera = require("../src/scheduler/citas-escalera");
const { pasoDeEscalera } = escalera;

const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", org_id: "org-1", name: "Daiana", phone: "1", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, horario: H };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia", phone: "2", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, horario: H };
// Visita viernes 2026-10-09 3:00 p. m. Bogota (20:00Z); corte 11:00 a. m. (16:00Z).
const cita = (over = {}) => ({ estado: "propuesta", fecha_hora: "2026-10-09T20:00:00Z", corte_at: "2026-10-09T16:00:00Z", creada_at: "2026-10-07T15:00:00Z", asignada_at: "2026-10-09T15:30:00Z", asesor_id: "a1", ref: "10013037", historial: [], ...over });
const lead = (over = {}) => ({ id: "l1", org_id: "org-1", nombre: "Andrea", phone: "573125550000", source: "colega", cita: cita(over) });

beforeEach(() => { process.env.CITAS_SIN_CORTE = "true"; });
afterEach(() => { delete process.env.CITAS_SIN_CORTE; });

test("apagado: en el corte se cancela como siempre", () => {
  delete process.env.CITAS_SIN_CORTE;
  assert.strictEqual(pasoDeEscalera({ lead: lead(), ciclo: [A1, A2], citasOrg: [], ahora: new Date("2026-10-09T16:00:00Z") }).accion, "cortar");
});

test("encendido: en el corte se extiende hasta 2 h antes de la visita", () => {
  const p = pasoDeEscalera({ lead: lead(), ciclo: [A1, A2], citasOrg: [], ahora: new Date("2026-10-09T16:00:00Z") });
  assert.deepStrictEqual(p, { accion: "extender", nuevoCorte: "2026-10-09T18:00:00.000Z" });
});

test("ya extendida: en el nuevo corte se cancela, aunque sea de noche", () => {
  const l = lead({ aviso_espera_at: "2026-10-09T16:00:00Z", corte_at: "2026-10-10T03:00:00Z", fecha_hora: "2026-10-10T05:00:00Z" });
  assert.strictEqual(pasoDeEscalera({ lead: l, ciclo: [A1, A2], citasOrg: [], ahora: new Date("2026-10-10T03:00:00Z") }).accion, "cortar");
});

test("si 2 h antes ya pasó cuando llega el corte, se cancela directo", () => {
  const l = lead({ corte_at: "2026-10-09T19:00:00Z" });
  assert.strictEqual(pasoDeEscalera({ lead: l, ciclo: [A1, A2], citasOrg: [], ahora: new Date("2026-10-09T19:00:00Z") }).accion, "cortar");
});

test("runOnce: extiende, avisa una sola vez al colega y no cancela", async () => {
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push({ ...A1 }, { ...A2 });
  const l = lead();
  memory.leads.push(l);
  const enviados = [];
  const deps = {
    aviso: async () => ({ ok: true }),
    texto: async (_o, to, t) => { enviados.push({ to, t }); return { ok: true }; },
    plantilla: async (_o, to, o) => { enviados.push({ to, plantilla: o.name }); return { ok: true }; },
    org: async () => ({ id: "org-1", name: "Diamond" }),
    notificar: async () => ({ ok: true }),
    reaviso: async () => ({ ok: true }),
    vencidas: async () => ({ vencidas: 0 }),
    soloLlamada: async () => false,
  };
  await escalera.runOnce({ ahora: new Date("2026-10-09T16:00:00Z"), deps });
  assert.strictEqual(memory.leads[0].cita.estado, "propuesta");
  assert.strictEqual(memory.leads[0].cita.corte_at, "2026-10-09T18:00:00.000Z");
  assert.strictEqual(memory.leads[0].cita.corte_original_at, "2026-10-09T16:00:00Z");
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].t, /^Seguimos confirmando tu visita del .+ con el asesor\. Te aviso apenas la confirme\.$/);
  assert.ok(!enviados.some((e) => e.plantilla));
  await escalera.runOnce({ ahora: new Date("2026-10-09T16:05:00Z"), deps });
  assert.strictEqual(enviados.length, 1, "el aviso de espera sale una sola vez");
});
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `node --test test/citas-sin-corte.test.js`
Expected: FAIL en "encendido: en el corte se extiende…" (devuelve `cortar`)

- [ ] **Step 3: Implementar en `src/scheduler/citas-escalera.js`**

Debajo de `const INTERVALO_MIN = ...`:

```js
// Nuevo final (Juan, 2026-10-25; spec 2026-10-25-sofi-pregunta-al-asesor §6):
// en el plazo ya no se cancela; se avisa una vez "seguimos confirmando" y el
// corte pasa a CITAS_CANCELAR_HORAS_ANTES (2) antes de la visita.
const CANCELAR_HORAS_ANTES = Number(process.env.CITAS_CANCELAR_HORAS_ANTES || 2);
function citasSinCorte() {
  return /^(true|1|si|sí|on)$/i.test(String(process.env.CITAS_SIN_CORTE || ""));
}
```

En `pasoDeEscalera`, reemplazar la línea
`if (c.corte_at && ahora.getTime() >= new Date(c.corte_at).getTime()) return { accion: "cortar" };`
por:

```js
  if (c.corte_at && ahora.getTime() >= new Date(c.corte_at).getTime()) {
    if (citasSinCorte() && !c.aviso_espera_at) {
      const limite = new Date(c.fecha_hora).getTime() - CANCELAR_HORAS_ANTES * 3600 * 1000;
      if (!isNaN(limite) && limite > ahora.getTime()) return { accion: "extender", nuevoCorte: new Date(limite).toISOString() };
    }
    return { accion: "cortar" };
  }
```

En `canal(deps)`, agregar:

```js
    soloLlamada: deps.soloLlamada || ((orgId, tel) => require("../data/colegas").esSoloLlamada(orgId, { telefono: tel })),
```

Después de la función `cortar`, agregar:

```js
async function extender({ org, lead, nuevoCorte, ahora, c }) {
  const cita = { ...lead.cita, corte_original_at: lead.cita.corte_at, corte_at: nuevoCorte, aviso_espera_at: ahora.toISOString() };
  await leads.update(lead.id, { cita });
  lead.cita = cita;
  const solo = lead.source === "colega" ? await c.soloLlamada(org.id, lead.phone).catch(() => null) : false;
  if (solo === false) {
    // Con la ventana cerrada no sale nada: no hay plantilla para esto (spec §6).
    await c
      .texto(org, lead.phone, `Seguimos confirmando tu visita ${cuandoDe(cita)} con el asesor. Te aviso apenas la confirme.`)
      .catch((e) => console.warn("[citas-escalera] aviso de espera:", e.message));
  }
  console.log(`[citas-escalera] lead ${lead.id}: plazo extendido hasta ${nuevoCorte}`);
}
```

En `runOnce`, dentro del `if/else if` de `paso.accion`, agregar antes de `} else if (paso.accion === "cortar") {`:

```js
        } else if (paso.accion === "extender") {
          await extender({ org, lead, nuevoCorte: paso.nuevoCorte, ahora, c });
```

En `module.exports`, agregar `citasSinCorte`.

- [ ] **Step 4: Correr los tests de la escalera**

Run: `node --test test/citas-sin-corte.test.js test/citas-escalera.test.js`
Expected: PASS (los de `citas-escalera.test.js` siguen en verde: con el interruptor apagado no cambia nada)

- [ ] **Step 5: Commit**

```bash
git add src/scheduler/citas-escalera.js test/citas-sin-corte.test.js
git commit -m "feat(citas): con CITAS_SIN_CORTE la visita no se cancela en el plazo sino 2 h antes"
```

---

### Task 9: Mockup de la tarjeta del CRM (compuerta: aprobación de Juan)

**Files:**
- Create: `docs/superpowers/mockups/2026-10-25-pregunta-pendiente.html`

Regla de Juan: los cambios visuales del CRM se aprueban sobre un mockup HTML antes del código (tema claro, KPIs de color sólido, una sola isla oscura navy/dorado).

- [ ] **Step 1: Escribir el mockup**

HTML autocontenido (Tailwind por CDN `https://cdn.tailwindcss.com`) que muestre la página "Para atender" con:
1. Sección **"Preguntas de colegas (2)"** arriba de "Visitas por confirmar", con dos tarjetas (`rounded-xl border border-sky-200 bg-sky-50 p-4`):
   - Tarjeta 1, pendiente: "Andrea Strauch (colega) · Ref 10013037" con link "ver ficha", la pregunta "¿Precio final de la ref 10013037? Tiene 2 clientes.", "Espera hace 1 h 20 min · la tiene Claudia", un `textarea` "Responder a Sofi" (placeholder "Escribe el dato tal cual: se lo pasamos literal al colega"), botón primario "Enviar respuesta" y botón secundario "Descartar".
   - Tarjeta 2, "Sin entregar": borde ámbar, "Ya respondida por Daiana: «Es unidad cerrada, Mirador de La Manuela». No le pude pasar la respuesta: escríbele desde el chat", con link "Abrir chat".
2. Debajo, la tarjeta existente de "Visitas por confirmar" tal como está hoy, para contexto.
3. Vista de 375 px de ancho (celular de Daiana) además de escritorio.

- [ ] **Step 2: Mostrárselo a Juan y esperar el OK**

Publicarlo o enviarlo como archivo. **No seguir con la Task 10 sin su aprobación;** si pide cambios, ajustar el mockup.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/mockups/2026-10-25-pregunta-pendiente.html
git commit -m "docs: mockup de la tarjeta de preguntas en Para atender"
```

---

### Task 10: CRM — tarjeta "Preguntas de colegas"

**Files:**
- Create: `crm/app/api/preguntas/route.ts`
- Create: `crm/components/pregunta-pendiente.tsx`
- Modify: `crm/app/(dashboard)/pendientes/page.tsx`

**Interfaces:**
- Consumes: Task 7 (`/api/preguntas/responder`, `/api/preguntas/descartar` del bot); `callBot` de `crm/lib/bot.ts`; `isAdmin` de `crm/lib/auth`; RLS "team read" de la Task 1.
- Produces: `POST /api/preguntas` del CRM con `{ accion: "responder"|"descartar", preguntaId, respuesta? }`.

- [ ] **Step 1: Ruta del CRM**

`crm/app/api/preguntas/route.ts`:

```ts
// "Responder a Sofi" y "Descartar" de una pregunta de colega (spec
// 2026-10-25 §5.4). Igual que /api/citas/accion: la escritura la hace el bot
// (src/api/crm.js), que verifica que sea del equipo.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";
import { isAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { accion, preguntaId, respuesta } = (await request.json().catch(() => ({}))) as {
    accion?: string;
    preguntaId?: string;
    respuesta?: string;
  };
  if (!preguntaId || (accion !== "responder" && accion !== "descartar")) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  if (accion === "responder" && !String(respuesta || "").trim()) return NextResponse.json({ error: "Escribe la respuesta" }, { status: 400 });

  const r =
    accion === "responder"
      ? await callBot<{ ok: boolean; texto?: string }>("/api/preguntas/responder", { preguntaId, respuesta, authUserId: user.id })
      : await callBot<{ ok: boolean }>("/api/preguntas/descartar", { preguntaId, authUserId: user.id, esAdmin: isAdmin(user) });
  if (!r.ok) {
    const status = [400, 403, 404, 409].includes(r.status) ? r.status : 502;
    return NextResponse.json({ error: r.timeout ? "El bot tardó en responder: revisa en un momento si quedó." : r.error || "El bot no respondió" }, { status });
  }
  return NextResponse.json({ ok: true, texto: (r.data as { texto?: string })?.texto || "Listo." });
}
```

- [ ] **Step 2: Componente**

`crm/components/pregunta-pendiente.tsx`:

```tsx
"use client";

// Tarjeta de una pregunta de colega en "Para atender" (spec 2026-10-25 §5.4).
// Lo que se escribe se le pasa LITERAL al colega por Sofi.
import { useState } from "react";
import { useRouter } from "next/navigation";

export type Pregunta = {
  id: string;
  ref: string | null;
  pregunta: string;
  estado: string;
  asignada_at: string;
  created_at: string;
  respuesta: string | null;
  respondida_por: string | null;
  entrega_error: string | null;
  lead: { id: string; nombre: string | null; phone: string; source: string | null } | null;
  asesor: string | null;
};

function haceCuanto(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

export default function PreguntaPendiente({ p }: { p: Pregunta }) {
  const router = useRouter();
  const [respuesta, setRespuesta] = useState("");
  const [enviando, setEnviando] = useState<"responder" | "descartar" | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const quien = p.lead ? p.lead.nombre || `+${p.lead.phone}` : "Alguien";

  async function enviar(accion: "responder" | "descartar") {
    setEnviando(accion);
    setError(null);
    const r = await fetch("/api/preguntas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion, preguntaId: p.id, respuesta }),
    });
    const body = await r.json().catch(() => ({}));
    setEnviando(null);
    if (r.ok) {
      setMensaje(body.texto || "Listo.");
      router.refresh();
    } else setError(body.error || "No se pudo, intenta de nuevo.");
  }

  if (p.estado === "respondida") {
    return (
      <li className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="font-medium text-slate-900">
          {quien} {p.lead?.source === "colega" && <span className="text-xs text-slate-500">(colega)</span>}
          {p.ref && <span className="text-sm text-slate-600"> · Ref {p.ref}</span>}
        </div>
        <div className="mt-1 text-sm text-slate-700">
          Ya respondida por {p.respondida_por}: «{p.respuesta}»
        </div>
        <div className="mt-1 text-xs text-amber-800">
          {p.entrega_error === "solo_llamada" ? "Pidió solo llamada: llámalo y dale la respuesta." : "No le pude pasar la respuesta: escríbele desde el chat."}
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-sky-200 bg-sky-50 p-4">
      <div className="font-medium text-slate-900">
        {quien} {p.lead?.source === "colega" && <span className="text-xs text-slate-500">(colega)</span>}
        {p.ref && <span className="text-sm text-slate-600"> · Ref {p.ref}</span>}
      </div>
      <div className="mt-1 text-sm text-slate-800">{p.pregunta}</div>
      <div className="mt-1 text-xs text-slate-500">
        Espera hace {haceCuanto(p.created_at)}
        {p.asesor ? ` · la tiene ${p.asesor}` : " · sin asesor asignado"}
      </div>
      {mensaje ? (
        <div className="mt-2 text-sm text-emerald-700">{mensaje}</div>
      ) : (
        <>
          <textarea
            value={respuesta}
            onChange={(e) => setRespuesta(e.target.value)}
            rows={2}
            placeholder="Escribe el dato tal cual: se lo pasamos literal al colega"
            className="mt-3 w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-sky-400 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              disabled={enviando !== null || !respuesta.trim()}
              onClick={() => enviar("responder")}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {enviando === "responder" ? "Enviando…" : "Enviar respuesta"}
            </button>
            <button
              disabled={enviando !== null}
              onClick={() => enviar("descartar")}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {enviando === "descartar" ? "Descartando…" : "Descartar"}
            </button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </>
      )}
    </li>
  );
}
```

(Ajustar clases a lo que Juan apruebe en el mockup de la Task 9.)

- [ ] **Step 3: Cargar las preguntas en la página**

En `crm/app/(dashboard)/pendientes/page.tsx`:
1. Import: `import PreguntaPendiente, { type Pregunta } from "@/components/pregunta-pendiente";`
2. Después de la consulta `conCita`, agregar:

```tsx
  // Preguntas de colegas al asesor (spec 2026-10-25): pendientes, y las
  // respondidas que no se pudieron entregar (menos las que esperan la ventana).
  const { data: filasPreguntas } = await supabase
    .from("preguntas_asesor")
    .select("id, ref, pregunta, estado, asignada_at, created_at, respuesta, respondida_por, entrega_error, asesor_id, lead:leads(id, nombre, phone, source)")
    .or("estado.eq.pendiente,and(estado.eq.respondida,entrega_error.neq.esperando_ventana)")
    .order("created_at", { ascending: true })
    .limit(50);
  const { data: asesoresTodos } = await supabase.from("advisors").select("id, name");
  const nombreAsesor = new Map(((asesoresTodos as { id: string; name: string }[]) || []).map((a) => [a.id, a.name]));
  const preguntas: Pregunta[] = ((filasPreguntas as (Omit<Pregunta, "asesor"> & { asesor_id: string | null })[]) || []).map((f) => ({
    ...f,
    asesor: f.asesor_id ? nombreAsesor.get(f.asesor_id) || null : null,
  }));
```

(Si la tabla no existe, `filasPreguntas` llega `null` y la sección no se pinta.)

3. Antes de `{porConfirmar.length > 0 && (`, agregar:

```tsx
      {preguntas.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Preguntas de colegas ({preguntas.length})</h2>
          <ul className="space-y-2">
            {preguntas.map((p) => (
              <PreguntaPendiente key={p.id} p={p} />
            ))}
          </ul>
        </section>
      )}
```

4. Si la página calcula un "no hay nada pendiente" que oculta el contenido, sumar `preguntas.length` a esa condición.

- [ ] **Step 4: Verificar tipos y build del CRM**

Run: `cd crm && npx tsc --noEmit -p .`
Expected: sin errores
Run: `cd crm && npm run lint`
Expected: sin errores nuevos

- [ ] **Step 5: Verificación en el navegador**

Levantar el CRM local (`node node_modules/next/dist/bin/next dev -p 3000` dentro de `crm/` si `npm run dev` falla) y abrir `/pendientes`. Sin la tabla en la base, la página debe cargar igual (sin sección). Comparar contra el mockup aprobado.

- [ ] **Step 6: Commit**

```bash
git add crm/app/api/preguntas/route.ts crm/components/pregunta-pendiente.tsx "crm/app/(dashboard)/pendientes/page.tsx"
git commit -m "feat(crm): preguntas de colegas en Para atender con Responder a Sofi"
```

---

### Task 11: Configuración, documentación y suite completa

**Files:**
- Modify: `.env.example` (raíz)
- Modify: `CLAUDE.md` (sección 2)

- [ ] **Step 1: Variables en `.env.example`**

Agregar al final:

```bash
# Sofi le pregunta al asesor hasta tener la respuesta (spec 2026-10-25).
SOFI_PREGUNTA_ASESOR=false
SOFI_PREGUNTA_ASESOR_PLANTILLA=
SOFI_RESPUESTA_LISTA_PLANTILLA=
PREGUNTA_PASO_MIN=60
PREGUNTA_REAVISO_MIN=15
PREGUNTA_INTERVALO_MIN=5
# Visitas: no cancelar en el plazo sino CITAS_CANCELAR_HORAS_ANTES antes de la visita.
CITAS_SIN_CORTE=false
CITAS_CANCELAR_HORAS_ANTES=2
```

- [ ] **Step 2: Estado en `CLAUDE.md`**

En el bloque "Preparación para las primeras visitas (2026-10-25)", reemplazar el punto "Diseño pendiente de aprobar" por:

```markdown
  - **Sofi le pregunta al asesor (rama `sofi-pregunta-al-asesor`, SIN desplegar).**
    Spec `docs/superpowers/specs/2026-10-25-sofi-pregunta-al-asesor-design.md`,
    plan en `docs/superpowers/plans/`. Tabla `preguntas_asesor` (migración
    `2026-10-25_preguntas_asesor.sql`, **pendiente: Juan**), escalera sin límite
    (15 min / 60 min, pausa noche y domingo), respuesta por CRM o WhatsApp
    citando el aviso, entrega literal al colega. Interruptores apagados:
    `SOFI_PREGUNTA_ASESOR`, `CITAS_SIN_CORTE`. Plantillas por crear en Meta:
    `pregunta_asesor` y `respuesta_lista`.
```

- [ ] **Step 3: Suite completa y tipos**

Run: `npm test`
Expected: todo en verde (2.825 + los nuevos)
Run: `cd crm && npx tsc --noEmit -p .`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: interruptores y estado de Sofi pregunta al asesor"
```

- [ ] **Step 5: Antes de desplegar (no lo hace el agente)**

1. Juan corre `db/migrations/2026-10-25_preguntas_asesor.sql`; verificar por REST: `select id from preguntas_asesor limit 1` responde `[]`, no `42P01`/`PGRST205`.
2. Merge a `main` y push con los interruptores apagados.
3. Encender `SOFI_PREGUNTA_ASESOR` en Railway, hacer una pregunta real y mirar `[preguntas]` y `[preguntas-escalera]` en el log.
4. Encender `CITAS_SIN_CORTE`.
5. Cuando Meta apruebe las plantillas, poner sus nombres en Railway.

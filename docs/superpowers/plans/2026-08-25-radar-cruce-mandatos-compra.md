# Radar: cruce de mandatos de compra — Plan de implementación

> **Para quien ejecute esto (humano o agente):** SUB-SKILL REQUERIDA — usar
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> checkbox (`- [ ]`) para llevar la cuenta.

**Spec:** [2026-08-25-radar-cruce-mandatos-compra-design.md](../specs/2026-08-25-radar-cruce-mandatos-compra-design.md)
(aprobado por Juan el 2026-08-25)

**Goal:** Que cada oferta que un colega publica en un grupo gremial se cruce contra
una lista curada de mandatos de compra, y que cada match le llegue por WhatsApp al
asesor dueño del mandato con el teléfono del colega, la ficha, el grupo y qué falta
verificar.

**Architecture:** Se reutiliza el motor de puntaje del radar (`evaluarCandidata`), el
clasificador, el directorio LID→teléfono y el canal de WhatsApp. Lo nuevo son dos
tablas, un módulo de cruce puro, un módulo de redacción del aviso y una tool para
cargar mandatos. El enganche es un solo punto en `src/groups/vivo.js`.

**Tech Stack:** Node.js + Express, Supabase (REST, sin ORM), Anthropic SDK
(`claude-haiku-4-5` para clasificar), `node --test` como runner.

## Constraints globales

- **Nada se publica en ningún grupo.** El permiso `responde` de cada grupo se queda
  en `false`. Ninguna tarea de este plan escribe en un grupo.
- **En el carril de compra, Sofi no le escribe al colega.** El aviso va solo al asesor.
- **Multi-tenant siempre:** todo se resuelve por `org_id`. Nada de datos de Diamond
  hardcodeados.
- **Código en inglés, textos de usuario en español (Colombia). Commits en español**
  con prefijo convencional.
- **Sin `db:push`:** cada migración es un `.sql` idempotente que Juan corre a mano.
- **El código tiene que degradar limpio sin la migración corrida.** Patrón ya
  establecido en `src/data/group-signals.js` (`esColumnaFaltante` / `columnaDelError`):
  si falta una columna, se reintenta el insert sin ella. Una columna nueva que el CRM
  lee sin la migración corrida rompe la pantalla.
- **Margen de precio:** `RADAR_MANDATO_MARGEN_PRECIO`, default `0.15` (15%).
- **Tope diario por mandato:** `RADAR_MANDATO_MAX_DIA`, default `0` = sin límite.
- **Plantilla Meta:** `radar_match_mandato`, idioma `es`, 3 parámetros de body.
- **Runner de tests:** `npm test` = `node --test test/`. Un test por archivo nuevo,
  mismo estilo que `test/group-cruce-leads.test.js` (mock por reasignación del módulo,
  nunca destructurando).

---

## Dos hallazgos que cambian el plan (leer antes de empezar)

### Hallazgo 1: el radar en vivo hoy DESCARTA las ofertas

`src/groups/vivo.js:108` — `if (c.clase === "oferta") return { resultado: "oferta_ignorada" };`

Juan las apagó el 2026-08-20: *"apaguemos las ofertas no las leamos solo quiero que
lea los pedidos, las ofertas nos están saturando"* — 438 señales en 2 días, 402 de
ellas ofertas. Las 329 ofertas que se analizaron el 2026-08-25 **no vinieron del vivo**:
vinieron del import de export `.txt` (`importar-export.js`), que es otro camino.

Por eso "reactivar el ingreso de las ofertas" es literalmente deshacer ese `return`.
Y el motivo por el que se apagaron —saturaban sin aportar— es exactamente lo que este
cruce arregla.

### Hallazgo 2: hay que decidir qué se persiste, y es una desviación del spec

El spec §4.4 dice `oferta → guardarOferta() (ally_properties, como hoy) → cruce`.
Si se persiste **toda** oferta que entra, vuelve la saturación que hizo que Juan las
apagara: ~150 ofertas/día contra 4 mandatos, con una tasa de cruce medida del 3-4%.

**Este plan invierte el orden: cruza primero en memoria, y persiste solo si hay al
menos un match.** Preserva la razón por la que se apagaron y es reversible con una
línea. La Tarea 6 lo implementa así y deja el comentario explicando por qué.

**Confirmar con Juan antes de cerrar la Tarea 6.** Si él prefiere persistir todo, es
mover dos líneas — pero entonces hay que aceptar que `group_signals` vuelve a crecer
con ofertas que nadie mira.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `db/migrations/2026-08-25_mandatos_compra.sql` | Las dos tablas nuevas | 1 |
| `src/data/mandatos.js` | Acceso a `mandatos_compra` y `mandato_match_alerts`. Nada de negocio | 2 |
| `src/groups/cruce-mandatos.js` | Evaluación pura: ¿esta oferta sirve para este mandato? Qué cumple, qué falta | 3 |
| `src/notifications/mandato-aviso.js` | Redacta el aviso al asesor. Puro, sin I/O | 4 |
| `src/groups/avisar-mandato.js` | Orquesta: dedup, teléfono, envío, plantilla, escalado | 5 |
| `src/groups/vivo.js` | Enganche: reactiva ofertas y llama al cruce | 6 |
| `src/agent/tools.js` | Tool `registrar_mandato_compra` (WhatsApp) | 7 |
| `src/agent/sofi-comando-tools.js` | La misma tool en el chat del CRM | 7 |
| `crm/app/api/grupos/radar/route.ts` | Expone mandatos y matches pendientes | 8 |
| `.env.example`, `CLAUDE.md`, `docs/radar-vivo.md` | Documentación y variables | 9 |

Se separan `cruce-mandatos.js` (decide) de `avisar-mandato.js` (actúa) a propósito:
el primero es puro y se prueba sin base ni red, que es donde está toda la lógica de
negocio delicada. Es el mismo corte que ya existe entre `politica.js` y `vivo.js`.

---

### Task 1: Migración de las dos tablas

**Files:**
- Create: `db/migrations/2026-08-25_mandatos_compra.sql`

**Interfaces:**
- Consumes: nada.
- Produces: tablas `mandatos_compra` y `mandato_match_alerts`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Mandatos de compra: los clientes que Diamond tiene BUSCANDO, contra los que se
-- cruza cada oferta que un colega publica en un grupo gremial.
--
-- POR QUE ESTE SHAPE. Es una copia deliberada del shape de un pedido del radar
-- (group_signals): un mandato ES un pedido, solo que nuestro. Asi lo consume
-- evaluarCandidata (src/groups/match.js) sin traducir nada — y traducir es
-- exactamente el bug que documenta filtrosInventario cuando dos modulos le ponen
-- nombres distintos a lo mismo (precio_max vs precioMax: el filtro se ignoraba en
-- silencio y TODO parecia matchear).
--
-- Correr a mano en Supabase. Idempotente.

create table if not exists mandatos_compra (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  cliente_nombre text not null,
  cliente_telefono text,

  -- A QUIEN se le avisa. Explicito y no derivado de quien lo cargo: un mandato
  -- puede pasar a otro asesor sin reescribir quien lo registro.
  advisor_id uuid references advisors(id) on delete set null,
  registrado_por uuid references auth.users(id) on delete set null,

  operacion text,                       -- venta | arriendo
  tipo text,                            -- apartamento | casa | consultorio | ...
  zonas jsonb not null default '[]'::jsonb,
  zonas_excluidas jsonb not null default '[]'::jsonb,
  ciudad text,
  precio_min bigint,
  precio_max bigint,
  habitaciones int,
  flexible_habitaciones boolean not null default false,
  area_min int,
  banos int,
  garajes int,
  estrato int,

  -- Exigencias que ningun campo numerico captura: "balcon", "gym", "lavadora y
  -- secadora", "moderna", "zonas sociales". No filtran (no se pueden verificar
  -- contra un texto de WhatsApp): salen listadas en el aviso como lo que el
  -- asesor tiene que preguntarle al colega.
  exigencias jsonb not null default '[]'::jsonb,
  plazo text,                           -- "3 a 6 meses" (arriendo temporal)

  -- El brief tal como llego. NO es adorno: es lo que permitio detectar el
  -- 2026-08-24 que el clasificador venia recortando pedidos (migracion
  -- group_signals_exigencias). Un mandato mal leido filtra mal para siempre y
  -- no se queja.
  texto_original text,
  notas text,

  estado text not null default 'activo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mandatos_compra_estado_valido') then
    alter table mandatos_compra add constraint mandatos_compra_estado_valido
      check (estado in ('activo', 'pausado', 'cerrado'));
  end if;
end $$;

create index if not exists idx_mandatos_org_estado on mandatos_compra(org_id, estado);

-- Dedup + auditoria del aviso. Mismo patron que ally_property_alerts: un aviso
-- por (mandato, propiedad) y nunca mas. Hace falta de verdad — el 2026-08-25 la
-- casa del Mall Tesoro aparecia DOS veces en la captura, publicada dos veces por
-- la misma persona.
create table if not exists mandato_match_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  mandato_id uuid not null references mandatos_compra(id) on delete cascade,
  ally_property_id uuid not null references ally_properties(id) on delete cascade,

  advisor_id uuid references advisors(id) on delete set null,
  puntaje int,
  entregado boolean not null default false,
  entregado_at timestamptz,
  via text,                             -- texto_libre | plantilla
  error text,
  escalado_a text,                      -- telefono al que se escalo, si aplico
  escalado_at timestamptz,
  created_at timestamptz not null default now(),

  unique (mandato_id, ally_property_id)
);

create index if not exists idx_mandato_alerts_org on mandato_match_alerts(org_id, entregado);

-- RLS: mismo patron que ally_properties — lectura para el equipo autenticado, las
-- escrituras (bot) pasan por service_role.
alter table mandatos_compra enable row level security;
drop policy if exists "team read" on mandatos_compra;
create policy "team read" on mandatos_compra for select to authenticated using (true);

alter table mandato_match_alerts enable row level security;
drop policy if exists "team read" on mandato_match_alerts;
create policy "team read" on mandato_match_alerts for select to authenticated using (true);

comment on table mandatos_compra is
  'Clientes compradores de Diamond, contra los que el radar cruza cada oferta de colega. Un mandato es un pedido, con el mismo shape que group_signals.';
comment on column mandatos_compra.exigencias is
  'Requisitos de texto libre que no se pueden verificar contra la publicacion del colega. No filtran: se listan en el aviso como lo que hay que preguntar.';
comment on column mandato_match_alerts.escalado_a is
  'Telefono al que se escalo el aviso cuando no se pudo entregar al dueño del mandato. Null = nunca hizo falta.';
```

- [ ] **Step 2: Verificar que el SQL parsea**

Run: `node -e "const s=require('fs').readFileSync('db/migrations/2026-08-25_mandatos_compra.sql','utf8'); if(!/create table if not exists mandatos_compra/.test(s)||!/unique \(mandato_id, ally_property_id\)/.test(s)) throw new Error('migracion incompleta'); console.log('ok', s.length, 'bytes')"`

Expected: `ok <n> bytes`

No se corre contra Supabase acá: la corre Juan a mano (§7 del spec). El código de
las tareas siguientes degrada limpio si no está corrida.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/2026-08-25_mandatos_compra.sql
git commit -m "feat(radar): tablas de mandatos de compra y dedup de avisos"
```

---

### Task 2: Capa de datos `src/data/mandatos.js`

**Files:**
- Create: `src/data/mandatos.js`
- Test: `test/mandatos-data.test.js`

**Interfaces:**
- Consumes: `src/data/supabase.js` (export `supabase`, puede ser `null` en tests).
- Produces:
  - `crear(orgId, fields) -> Promise<row|null>`
  - `listarActivos(orgId) -> Promise<row[]>`
  - `findById(orgId, id) -> Promise<row|null>`
  - `actualizarEstado(orgId, id, estado) -> Promise<row|null>`
  - `registrarAlerta(orgId, {mandatoId, allyPropertyId, advisorId, puntaje}) -> Promise<{esNuevo:boolean, id:string|null}>`
  - `marcarEntrega(orgId, alertaId, {entregado, via, error}) -> Promise<void>`
  - `marcarEscalado(orgId, alertaId, telefono) -> Promise<void>`
  - `pendientes(orgId, {limite}) -> Promise<row[]>`

- [ ] **Step 1: Escribir el test que falla**

```javascript
// test/mandatos-data.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const mandatos = require("../src/data/mandatos");

const ORG = "org-1";

test("crear guarda las zonas y exigencias como arrays, no como texto", async () => {
  const row = await mandatos.crear(ORG, {
    cliente_nombre: "Marcela Restrepo",
    operacion: "venta",
    tipo: "apartamento",
    zonas: ["El Poblado", "Las Palmas"],
    exigencias: ["balcón", "vista", "moderna"],
    precio_max: 2200000000,
    habitaciones: 4,
    area_min: 150,
    texto_original: "Mi cliente subió presupuesto...",
  });
  assert.ok(row.id, "debe devolver la fila creada");
  assert.deepStrictEqual(row.zonas, ["El Poblado", "Las Palmas"]);
  assert.deepStrictEqual(row.exigencias, ["balcón", "vista", "moderna"]);
  assert.strictEqual(row.estado, "activo");
});

test("un mandato sin precio NO queda con precio_max 0", async () => {
  // precio_max = 0 en el motor significa "sin tope" y matchearia cualquier cosa;
  // null significa "no se sabe". La diferencia decide si el filtro sirve.
  const row = await mandatos.crear(ORG, { cliente_nombre: "Sin precio" });
  assert.strictEqual(row.precio_max, null);
});

test("listarActivos no devuelve pausados ni cerrados", async () => {
  const a = await mandatos.crear(ORG, { cliente_nombre: "Activo" });
  const b = await mandatos.crear(ORG, { cliente_nombre: "Cerrado" });
  await mandatos.actualizarEstado(ORG, b.id, "cerrado");
  const lista = await mandatos.listarActivos(ORG);
  const nombres = lista.map((m) => m.cliente_nombre);
  assert.ok(nombres.includes("Activo"));
  assert.ok(!nombres.includes("Cerrado"));
});

test("listarActivos no cruza organizaciones", async () => {
  await mandatos.crear("org-2", { cliente_nombre: "De otra org" });
  const lista = await mandatos.listarActivos(ORG);
  assert.ok(!lista.some((m) => m.cliente_nombre === "De otra org"));
});

test("registrarAlerta es idempotente por (mandato, propiedad)", async () => {
  const m = await mandatos.crear(ORG, { cliente_nombre: "Dedup" });
  const primera = await mandatos.registrarAlerta(ORG, {
    mandatoId: m.id, allyPropertyId: "ally-1", advisorId: "adv-1", puntaje: 88,
  });
  const segunda = await mandatos.registrarAlerta(ORG, {
    mandatoId: m.id, allyPropertyId: "ally-1", advisorId: "adv-1", puntaje: 88,
  });
  assert.strictEqual(primera.esNuevo, true);
  assert.strictEqual(segunda.esNuevo, false, "el repost del colega no debe generar un segundo aviso");
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/mandatos-data.test.js`
Expected: FAIL — `Cannot find module '../src/data/mandatos'`

- [ ] **Step 3: Implementar el módulo**

```javascript
// src/data/mandatos.js
//
// Acceso a mandatos_compra: los clientes que Diamond tiene BUSCANDO. Solo I/O —
// la decision de si una oferta le sirve a un mandato vive en
// src/groups/cruce-mandatos.js, y el aviso en src/groups/avisar-mandato.js.
//
// Sin supabase (tests, dev sin credenciales) guarda en memoria con el mismo
// contrato, igual que src/data/command.js.
// OJO: src/data/supabase.js hace `module.exports = client` — exporta el cliente
// DIRECTO, no un objeto. Destructurar `{ supabase }` da undefined y este modulo
// nunca escribiria en la base real: caeria SIEMPRE en la rama de memoria, en
// silencio y tambien en produccion. Se importa igual que los 10 modulos
// hermanos de src/data/.
const supabase = require("./supabase");

const memory = { mandatos: [], alertas: [] };
let seq = 0;
const nuevoId = (p) => `${p}-${++seq}`;

// Campos que el insert puede mandar. Se lista explicito para que un campo nuevo
// del clasificador no viaje sin que alguien lo piense (y para que el reintento
// por columna faltante sepa que sacar).
const CAMPOS = [
  "cliente_nombre", "cliente_telefono", "advisor_id", "registrado_por",
  "operacion", "tipo", "zonas", "zonas_excluidas", "ciudad",
  "precio_min", "precio_max", "habitaciones", "flexible_habitaciones",
  "area_min", "banos", "garajes", "estrato",
  "exigencias", "plazo", "texto_original", "notas",
];

// null y 0 no son lo mismo acá: precio_max = 0 significaria "sin tope" para el
// motor de cruce y matchearia media ciudad; null significa "no se sabe". El
// clasificador devuelve 0 cuando no encuentra el dato, asi que se traduce.
function nadaEsCero(v) {
  return v === 0 || v === "" || v === undefined ? null : v;
}

function normalizar(fields) {
  const row = {};
  for (const c of CAMPOS) {
    if (c === "zonas" || c === "zonas_excluidas" || c === "exigencias") {
      row[c] = Array.isArray(fields[c]) ? fields[c] : [];
    } else if (c === "flexible_habitaciones") {
      row[c] = Boolean(fields[c]);
    } else if (c === "cliente_nombre") {
      row[c] = String(fields[c] || "").trim() || null;
    } else {
      row[c] = nadaEsCero(fields[c]) ?? null;
    }
  }
  return row;
}

async function crear(orgId, fields) {
  const row = { org_id: orgId, estado: "activo", ...normalizar(fields) };
  if (!row.cliente_nombre) throw new Error("Un mandato necesita cliente_nombre");

  if (!supabase) {
    const guardado = { id: nuevoId("mandato"), created_at: new Date().toISOString(), ...row };
    memory.mandatos.push(guardado);
    return guardado;
  }
  const { data, error } = await supabase.from("mandatos_compra").insert(row).select().single();
  if (error) throw error;
  return data;
}

async function listarActivos(orgId) {
  if (!supabase) {
    return memory.mandatos.filter((m) => m.org_id === orgId && m.estado === "activo");
  }
  const { data, error } = await supabase
    .from("mandatos_compra")
    .select("*")
    .eq("org_id", orgId)
    .eq("estado", "activo")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data || [];
}

async function findById(orgId, id) {
  if (!supabase) return memory.mandatos.find((m) => m.id === id && m.org_id === orgId) || null;
  const { data, error } = await supabase
    .from("mandatos_compra").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function actualizarEstado(orgId, id, estado) {
  if (!supabase) {
    const m = memory.mandatos.find((x) => x.id === id && x.org_id === orgId);
    if (m) m.estado = estado;
    return m || null;
  }
  const { data, error } = await supabase
    .from("mandatos_compra")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("id", id).select().maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Reserva el aviso ANTES de mandarlo. Devuelve {esNuevo:false} si ya existia:
 * un colega que republica la misma propiedad no genera un segundo WhatsApp.
 * Mismo criterio que allyProperties.registerAlert.
 */
async function registrarAlerta(orgId, { mandatoId, allyPropertyId, advisorId = null, puntaje = null }) {
  if (!supabase) {
    const ya = memory.alertas.find(
      (a) => a.org_id === orgId && a.mandato_id === mandatoId && a.ally_property_id === allyPropertyId
    );
    if (ya) return { esNuevo: false, id: ya.id };
    const a = {
      id: nuevoId("alerta"), org_id: orgId, mandato_id: mandatoId,
      ally_property_id: allyPropertyId, advisor_id: advisorId, puntaje,
      entregado: false, created_at: new Date().toISOString(),
    };
    memory.alertas.push(a);
    return { esNuevo: true, id: a.id };
  }
  const { data, error } = await supabase
    .from("mandato_match_alerts")
    .insert({ org_id: orgId, mandato_id: mandatoId, ally_property_id: allyPropertyId, advisor_id: advisorId, puntaje })
    .select("id")
    .single();
  // 23505 = unique_violation: ya se aviso de este par. No es un error.
  if (error && error.code === "23505") return { esNuevo: false, id: null };
  if (error) throw error;
  return { esNuevo: true, id: data.id };
}

async function marcarEntrega(orgId, alertaId, { entregado, via = null, error = null }) {
  if (!alertaId) return;
  const campos = {
    entregado: Boolean(entregado),
    entregado_at: entregado ? new Date().toISOString() : null,
    via, error,
  };
  if (!supabase) {
    const a = memory.alertas.find((x) => x.id === alertaId);
    if (a) Object.assign(a, campos);
    return;
  }
  const { error: e } = await supabase
    .from("mandato_match_alerts").update(campos).eq("org_id", orgId).eq("id", alertaId);
  if (e) console.warn("[mandatos] no se pudo marcar la entrega:", e.message);
}

async function marcarEscalado(orgId, alertaId, telefono) {
  if (!alertaId) return;
  const campos = { escalado_a: telefono, escalado_at: new Date().toISOString() };
  if (!supabase) {
    const a = memory.alertas.find((x) => x.id === alertaId);
    if (a) Object.assign(a, campos);
    return;
  }
  const { error } = await supabase
    .from("mandato_match_alerts").update(campos).eq("org_id", orgId).eq("id", alertaId);
  if (error) console.warn("[mandatos] no se pudo marcar el escalado:", error.message);
}

async function pendientes(orgId, { limite = 50 } = {}) {
  if (!supabase) return memory.alertas.filter((a) => a.org_id === orgId && !a.entregado);
  const { data, error } = await supabase
    .from("mandato_match_alerts")
    .select("*")
    .eq("org_id", orgId)
    .eq("entregado", false)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw error;
  return data || [];
}

function _reset() {
  memory.mandatos = [];
  memory.alertas = [];
  seq = 0;
}

module.exports = {
  crear, listarActivos, findById, actualizarEstado,
  registrarAlerta, marcarEntrega, marcarEscalado, pendientes, CAMPOS, _reset,
};
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test test/mandatos-data.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/data/mandatos.js test/mandatos-data.test.js
git commit -m "feat(radar): capa de datos de mandatos de compra"
```

---

### Task 3: El cruce puro `src/groups/cruce-mandatos.js`

**Files:**
- Create: `src/groups/cruce-mandatos.js`
- Test: `test/group-cruce-mandatos.test.js`

**Interfaces:**
- Consumes: `evaluarCandidata` de `src/groups/match.js`
  (firma: `evaluarCandidata(propiedad, criterio, fuente) -> match|null`, donde el
  match trae `{fuente, zona, precio, habitaciones, area, banos, garajes, estrato,
  puntaje, ubicacion, razones}`).
- Produces:
  - `criterioDeMandato(mandato) -> criterio` (el shape que espera `evaluarCandidata`)
  - `evaluarOferta(oferta, mandato, {margenPrecio}) -> {sirve, puntaje, ubicacion, cumple:string[], salvedades:string[]} | null`
  - `MARGEN_PRECIO_DEFAULT = 0.15`

- [ ] **Step 1: Escribir el test que falla**

```javascript
// test/group-cruce-mandatos.test.js
//
// El piso del filtro. Decision de producto de Juan (2026-08-25): filo bajo,
// salvedades escritas — Natalia decide que sirve, el sistema no descarta por
// ella. Pero un aviso que aprende a ignorar es peor que no mandarlo, y de eso
// se ocupan los tres cortes duros de aca: operacion, zona y precio.
const { test } = require("node:test");
const assert = require("node:assert");
const { evaluarOferta, criterioDeMandato } = require("../src/groups/cruce-mandatos");

const MANDATO = {
  id: "m-2",
  cliente_nombre: "Marcela Restrepo",
  operacion: "venta",
  tipo: "apartamento",
  zonas: ["El Poblado"],
  zonas_excluidas: [],
  precio_max: 2200000000,
  habitaciones: 4,
  flexible_habitaciones: false,
  area_min: 150,
  exigencias: ["balcón", "vista", "moderna"],
};

// Shape de una oferta ya normalizada a ally_properties (ver ofertas.js).
const OFERTA = {
  tipo: "Apartamento",
  operacion: "Venta",
  zona: "El Poblado",
  precio: "$1.580.000.000",
  habitaciones: 4,
  area: 246,
};

test("una oferta de arriendo NO sirve para un mandato de compra", () => {
  const r = evaluarOferta({ ...OFERTA, operacion: "Arriendo" }, MANDATO);
  assert.strictEqual(r, null, "cruzar operaciones distintas es el error mas caro: rompe la confianza en el aviso");
});

test("una oferta fuera de la zona pedida y sin vecindad NO sirve", () => {
  const r = evaluarOferta({ ...OFERTA, zona: "Bello" }, MANDATO);
  assert.strictEqual(r, null);
});

test("una oferta 14% arriba del tope SI sirve, con la salvedad escrita", () => {
  const r = evaluarOferta({ ...OFERTA, precio: "$2.508.000.000" }, MANDATO);
  assert.ok(r, "14% esta dentro del margen del 15%");
  assert.ok(r.salvedades.some((s) => /precio|tope/i.test(s)), `las salvedades deben nombrar el precio: ${JSON.stringify(r.salvedades)}`);
});

test("una oferta 20% arriba del tope NO sirve", () => {
  const r = evaluarOferta({ ...OFERTA, precio: "$2.640.000.000" }, MANDATO);
  assert.strictEqual(r, null);
});

test("cumple todo: sin salvedades de habitaciones ni area", () => {
  const r = evaluarOferta(OFERTA, MANDATO);
  assert.ok(r.sirve);
  assert.ok(r.cumple.length > 0, "debe decir que cumple");
  assert.ok(!r.salvedades.some((s) => /habitacion|alcoba/i.test(s)));
  assert.ok(!r.salvedades.some((s) => /m²|area/i.test(s)));
});

test("le falta area: sirve, y la salvedad dice cuanto le falta", () => {
  const r = evaluarOferta({ ...OFERTA, area: 145 }, MANDATO);
  assert.ok(r.sirve, "quedarse corto en area no descalifica — lo decide el asesor");
  assert.ok(
    r.salvedades.some((s) => s.includes("145") && s.includes("150")),
    `la salvedad debe ser accionable, no un puntaje: ${JSON.stringify(r.salvedades)}`
  );
});

test("le falta una habitacion: sirve, con la salvedad", () => {
  const r = evaluarOferta({ ...OFERTA, habitaciones: 3 }, MANDATO);
  assert.ok(r.sirve);
  assert.ok(r.salvedades.some((s) => /3 de las 4/.test(s)), JSON.stringify(r.salvedades));
});

test("las exigencias de texto libre SIEMPRE salen como sin verificar", () => {
  // No se pueden comprobar contra una publicacion de WhatsApp. Callarlas seria
  // dejar que el asesor asuma que estan verificadas.
  const r = evaluarOferta(OFERTA, MANDATO);
  const texto = r.salvedades.join(" ");
  for (const e of MANDATO.exigencias) assert.ok(texto.includes(e), `falta la exigencia "${e}"`);
});

test("un dato que la oferta no trae no inventa que cumple", () => {
  const r = evaluarOferta({ ...OFERTA, area: null }, MANDATO);
  assert.ok(!r.cumple.some((c) => /m²/.test(c)), "sin area, no se puede afirmar que cumple el area");
});

test("criterioDeMandato traduce al shape que espera evaluarCandidata", () => {
  const c = criterioDeMandato(MANDATO);
  assert.deepStrictEqual(c.zonas, ["El Poblado"]);
  assert.strictEqual(c.precio_max, 2200000000);
  assert.strictEqual(c.habitaciones, 4);
  assert.strictEqual(c.area_min, 150);
  assert.strictEqual(c.operacion, "venta");
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/group-cruce-mandatos.test.js`
Expected: FAIL — `Cannot find module '../src/groups/cruce-mandatos'`

- [ ] **Step 3: Implementar el módulo**

```javascript
// src/groups/cruce-mandatos.js
//
// ¿Esta oferta que publico un colega le sirve a este mandato de compra? Codigo
// PURO: cero base, cero red, cero tokens. Toda la logica delicada del carril de
// compra vive aca, y por eso se puede probar entera.
//
// LA DECISION DE PRODUCTO QUE ORDENA ESTE ARCHIVO (Juan, 2026-08-25): filo bajo,
// salvedades escritas. El sistema no descarta por el asesor — le manda lo que se
// acerca y le dice exactamente que falta. El motivo es que los falsos negativos
// son invisibles por definicion y son los caros: una propiedad que nunca se
// mostro no deja rastro de la comision que no se cobro.
//
// Pero hay un piso, porque un aviso que el asesor aprende a ignorar es peor que
// no mandarlo. Tres cortes duros, y nada mas:
//   1. Operacion — mandarle un arriendo a quien compra rompe la confianza entera.
//   2. Zona — pedida o vecina, con la graduacion que ya tiene ubicacionCoincide.
//   3. Precio — hasta 15% arriba del tope. Mas que eso no es "se acerca".
// Todo lo demas (habitaciones, area, baños, garajes, estrato, exigencias) es
// blando: se manda, con la salvedad escrita.
const match = require("./match");
const formato = require("../lib/formato");

const MARGEN_PRECIO_DEFAULT = Number(process.env.RADAR_MANDATO_MARGEN_PRECIO || 0.15);

const lista = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/**
 * Traduce un mandato al shape de criterio que espera evaluarCandidata.
 *
 * Es una traduccion de nombres, no de semantica: la tabla se diseño copiando
 * group_signals justamente para que esto sea trivial. Si algun dia deja de ser
 * trivial, el que se movio de lugar es el shape de la tabla.
 */
function criterioDeMandato(m) {
  return {
    operacion: (m.operacion || "").toLowerCase(),
    tipo: m.tipo || "",
    zonas: lista(m.zonas),
    zona: lista(m.zonas)[0] || "",
    zonas_excluidas: lista(m.zonas_excluidas),
    ciudad: m.ciudad || "",
    precio_min: num(m.precio_min),
    precio_max: num(m.precio_max),
    habitaciones: num(m.habitaciones),
    flexible_habitaciones: Boolean(m.flexible_habitaciones),
    area_min: num(m.area_min),
    banos: num(m.banos),
    garajes: num(m.garajes),
    estrato: num(m.estrato),
  };
}

// El precio de una oferta de grupo es TEXTO ("$1.580.000.000"): ally_properties
// lo guarda asi por el flujo historico. parsearPrecio ya resuelve los formatos
// que aparecen en la practica.
function precioDe(oferta) {
  if (typeof oferta.precio === "number") return oferta.precio;
  return formato.parsearPrecio(oferta.precio) || 0;
}

function fmtPesos(n) {
  return `$${Number(n).toLocaleString("es-CO")}`;
}

/**
 * @param oferta   propiedad del colega, ya normalizada al shape de ally_properties
 * @param mandato  fila de mandatos_compra
 * @returns null si no pasa el piso; si pasa:
 *   { sirve, puntaje, ubicacion, cumple: string[], salvedades: string[] }
 *
 * `cumple` y `salvedades` son frases para leer, no un puntaje. Un "87%" no le
 * dice al asesor que preguntarle al colega; "sin verificar: vista y balcon" si.
 */
function evaluarOferta(oferta, mandato, { margenPrecio = MARGEN_PRECIO_DEFAULT } = {}) {
  const c = criterioDeMandato(mandato);

  // Corte 1 y 2 (operacion y zona) los hace el motor que ya existe: devuelve
  // null si la operacion no calza, si el tipo no calza o si la ubicacion no
  // coincide ni de vecina. No se reimplementa nada de eso aca.
  const m = match.evaluarCandidata({ ...oferta, area: oferta.area, garaje: oferta.garajes }, c, "aliado");
  if (!m) return null;

  const precio = precioDe(oferta);
  const cumple = [];
  const salvedades = [];

  // Corte 3: precio. Se evalua aca y no en el motor porque el motor castiga el
  // precio con puntaje, y aca hace falta un corte duro con un margen explicito.
  if (c.precio_max > 0 && precio > 0) {
    const techo = c.precio_max * (1 + margenPrecio);
    if (precio > techo) return null;
    if (precio > c.precio_max) {
      salvedades.push(`Se pasa ${fmtPesos(precio - c.precio_max)} del tope de ${fmtPesos(c.precio_max)}`);
    } else {
      const holgura = c.precio_max - precio;
      cumple.push(holgura > 0 ? `presupuesto (${fmtPesos(holgura)} por debajo del tope)` : "presupuesto");
    }
  }

  // Ubicacion: se dice el grado, no se esconde. "vecina" no es "exacta" y el
  // asesor tiene que poder verlo antes de llamar.
  if (m.ubicacion === "exacta") cumple.push(`sector (${oferta.zona})`);
  else salvedades.push(`La zona es ${oferta.zona} — no es exactamente lo pedido (${lista(mandato.zonas).join(", ")})`);

  // Habitaciones, area, baños, garajes, estrato: blandos. Un dato ausente NO se
  // reporta como cumplido — es la diferencia entre "no lo sabemos" y "lo tiene",
  // y confundirlas es lo que hace que un asesor descubra el problema recien
  // frente al cliente.
  // Las tres frases de cada blando son explicitas y no se derivan una de otra con
  // regex: cada una la va a leer una persona que tiene que decidir si llama al
  // colega, y "No dice (246 m² de 150 pedidos)" no es una frase.
  const blandos = [
    {
      pedido: c.habitaciones, tiene: num(oferta.habitaciones),
      cumple: (v) => `${v} habitaciones`,
      corto: (v, p) => `Tiene ${v} de las ${p} habitaciones pedidas`,
      sinDato: (p) => `No dice cuántas habitaciones tiene (se pidieron ${p})`,
    },
    {
      pedido: c.area_min, tiene: num(oferta.area),
      cumple: (v) => `área (${v} m² de ${c.area_min} pedidos)`,
      corto: (v, p) => `Tiene ${v} m² de los ${p} pedidos`,
      sinDato: (p) => `No dice el área (se pidieron ${p} m²)`,
    },
    {
      pedido: c.banos, tiene: num(oferta.banos),
      cumple: (v) => `${v} baños`,
      corto: (v, p) => `Tiene ${v} de los ${p} baños pedidos`,
      sinDato: (p) => `No dice cuántos baños tiene (se pidieron ${p})`,
    },
    {
      pedido: c.garajes, tiene: num(oferta.garajes),
      cumple: (v) => `${v} garajes`,
      corto: (v, p) => `Tiene ${v} de los ${p} garajes pedidos`,
      sinDato: (p) => `No dice cuántos garajes tiene (se pidieron ${p})`,
    },
  ];
  for (const b of blandos) {
    if (b.pedido <= 0) continue;
    if (b.tiene <= 0) salvedades.push(b.sinDato(b.pedido));
    else if (b.tiene >= b.pedido) cumple.push(b.cumple(b.tiene));
    else salvedades.push(b.corto(b.tiene, b.pedido));
  }

  // Exigencias de texto libre: NUNCA se pueden verificar contra la publicacion
  // de un colega en un grupo. Salen siempre como pendiente de preguntar. Callarlas
  // dejaria que el asesor asuma que estan confirmadas.
  const exigencias = lista(mandato.exigencias);
  if (exigencias.length) salvedades.push(`Sin verificar: ${exigencias.join(", ")}`);

  return { sirve: true, puntaje: m.puntaje, ubicacion: m.ubicacion, cumple, salvedades };
}

module.exports = { evaluarOferta, criterioDeMandato, MARGEN_PRECIO_DEFAULT };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test test/group-cruce-mandatos.test.js`
Expected: PASS — 10 tests

- [ ] **Step 5: Verificar que no se rompió el carril de venta**

Run: `node --test test/group-match.test.js test/group-politica.test.js test/group-publicable.test.js`
Expected: PASS — sin cambios respecto a antes de esta tarea

- [ ] **Step 6: Commit**

```bash
git add src/groups/cruce-mandatos.js test/group-cruce-mandatos.test.js
git commit -m "feat(radar): decidir si una oferta de colega le sirve a un mandato"
```

---

### Task 4: El texto del aviso `src/notifications/mandato-aviso.js`

**Files:**
- Create: `src/notifications/mandato-aviso.js`
- Test: `test/mandato-aviso.test.js`

**Interfaces:**
- Consumes: `tocarNombreEnGrupo` de `src/lib/contacto.js`.
- Produces:
  - `buildMandatoMatchAlert({mandato, oferta, evaluacion, colega, grupo, vistoEnIso}) -> string`
  - `paramsPlantilla({mandato, oferta}) -> [string, string, string]`

- [ ] **Step 1: Escribir el test que falla**

```javascript
// test/mandato-aviso.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { buildMandatoMatchAlert, paramsPlantilla } = require("../src/notifications/mandato-aviso");

const BASE = {
  mandato: { cliente_nombre: "Marcela Restrepo" },
  oferta: {
    tipo: "Apartamento", operacion: "Venta", zona: "Loma del Tesoro",
    precio: "$1.580.000.000", habitaciones: 4, banos: 3, area: 246, garajes: 2,
    estrato: 6, mensaje_original: "Apartamento dúplex en venta Loma del Tesoro",
    link: "https://glovi.co/inmueble/9829914",
  },
  evaluacion: {
    puntaje: 92, ubicacion: "exacta",
    cumple: ["sector (Loma del Tesoro)", "presupuesto ($620.000.000 por debajo del tope)", "4 habitaciones"],
    salvedades: ["Sin verificar: balcón, vista, moderna"],
  },
  colega: { nombre: "Glovi l Propiedad raíz", telefono: "573244151819" },
  grupo: "SOLO VIVIENDA >$1000 MLLS",
  vistoEnIso: "2026-08-25T15:42:00-05:00",
};

test("el aviso trae cliente, propiedad, colega, grupo y ficha", () => {
  const t = buildMandatoMatchAlert(BASE);
  assert.ok(t.includes("Marcela Restrepo"));
  assert.ok(t.includes("Loma del Tesoro"));
  assert.ok(t.includes("573244151819"));
  assert.ok(t.includes("SOLO VIVIENDA >$1000 MLLS"));
  assert.ok(t.includes("https://glovi.co/inmueble/9829914"));
});

test("dice que cumple y que falta verificar, y NUNCA un puntaje", () => {
  const t = buildMandatoMatchAlert(BASE);
  assert.ok(t.includes("4 habitaciones"));
  assert.ok(/balcón/.test(t));
  assert.ok(!/92/.test(t), "un puntaje no le dice al asesor que preguntarle al colega");
});

test("nunca afirma que la propiedad esta disponible, y pide confirmar", () => {
  const t = buildMandatoMatchAlert(BASE);
  assert.ok(!/est[áa] disponible/i.test(t));
  assert.ok(/confirm/i.test(t), "tiene que pedir confirmar disponibilidad");
});

test("sin telefono, da la salida real: tocar el nombre en el grupo", () => {
  const t = buildMandatoMatchAlert({ ...BASE, colega: { nombre: "Patricia Vivares", telefono: null } });
  assert.ok(!/\+null|undefined/.test(t));
  assert.ok(/Patricia Vivares/.test(t));
  assert.ok(/toc/i.test(t), "debe explicar como abrir el chat sin el numero");
  assert.ok(/SOLO VIVIENDA/.test(t), "y en que grupo tocarlo");
});

test("recuerda que la comision se comparte", () => {
  assert.ok(/comisi[óo]n se comparte/i.test(buildMandatoMatchAlert(BASE)));
});

test("pide una respuesta corta (cierra el circuito y renueva la ventana de 24h)", () => {
  assert.ok(/respuesta corta|cont[áa]me/i.test(buildMandatoMatchAlert(BASE)));
});

test("paramsPlantilla devuelve exactamente 3 strings no vacios", () => {
  const p = paramsPlantilla(BASE);
  assert.strictEqual(p.length, 3);
  for (const v of p) {
    assert.strictEqual(typeof v, "string");
    assert.ok(v.trim().length > 0, "Meta rechaza un parametro vacio");
  }
  assert.ok(p[0].includes("Marcela"));
});

test("paramsPlantilla no manda saltos de linea (Meta los rechaza)", () => {
  for (const v of paramsPlantilla(BASE)) assert.ok(!/\n/.test(v));
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/mandato-aviso.test.js`
Expected: FAIL — `Cannot find module '../src/notifications/mandato-aviso'`

- [ ] **Step 3: Implementar el módulo**

```javascript
// src/notifications/mandato-aviso.js
//
// El aviso que recibe el asesor cuando una oferta de un colega cruza con uno de
// sus mandatos de compra. Puro: recibe hechos, devuelve texto.
//
// TRES REGLAS QUE NO SE NEGOCIAN, cada una por un caso real:
//
// 1. NUNCA se dice que la propiedad esta disponible. El radar leyo un mensaje en
//    un grupo; no verifico nada. Una oferta recomendada como disponible cuando no
//    lo esta es el daño de reputacion que la caducidad de ally_properties existe
//    para evitar.
// 2. NUNCA se manda un puntaje. Un "92%" no le dice al asesor que preguntarle al
//    colega; "sin verificar: vista y balcon" si. Misma leccion que las salvedades
//    del carril de venta.
// 3. Sin telefono marcable NO se inventa un numero ni se muestra el LID crudo
//    (14-17 digitos, ver src/lib/contacto.js). Se da la salida que si funciona
//    desde el celular: tocar el nombre del colega en el grupo. Es la politica de
//    Juan del 2026-08-22, que nacio de links muertos y avisos que decian "no hay
//    telefono" cuando el numero nunca se habia intentado resolver.
const { tocarNombreEnGrupo } = require("../lib/contacto");

function fichaDe(oferta) {
  const partes = [
    oferta.precio || null,
    oferta.area ? `${oferta.area} m²` : null,
    oferta.habitaciones ? `${oferta.habitaciones} alcobas` : null,
    oferta.banos ? `${oferta.banos} baños` : null,
    oferta.garajes ? `${oferta.garajes} garajes` : null,
    oferta.estrato ? `estrato ${oferta.estrato}` : null,
  ].filter(Boolean);
  return partes.join(" · ");
}

function horaBogota(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("es-CO", {
      timeZone: "America/Bogota", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function buildMandatoMatchAlert({ mandato, oferta, evaluacion, colega = {}, grupo = null, vistoEnIso = null }) {
  const cliente = mandato.cliente_nombre || "un cliente tuyo";
  const tipo = oferta.tipo || "Propiedad";
  const operacion = oferta.operacion ? ` en ${String(oferta.operacion).toLowerCase()}` : "";
  const zona = oferta.zona ? ` — ${oferta.zona}` : "";

  const quien = colega.nombre || "Un colega";
  const contacto = colega.telefono
    ? `Teléfono: +${colega.telefono}`
    // tocarNombreEnGrupo ya devuelve la frase completa y YA dice "en el grupo"
    // (src/lib/contacto.js). Concatenarle " en el grupo X" produce "...en el grupo
    // para abrirle el chat directo ... en el grupo SOLO POBLADO". El nombre del
    // grupo lo da la linea "Visto en:" de mas abajo, que ya existe.
    : `El colega no dejó número visible — ${tocarNombreEnGrupo(quien)}.`;

  const visto = [grupo ? `Visto en: ${grupo}` : null, horaBogota(vistoEnIso) || null]
    .filter(Boolean).join(" · ");

  const lineas = [
    `🎯 Oferta nueva que le sirve a ${cliente}`,
    "",
    `${tipo}${operacion}${zona}`,
    fichaDe(oferta),
  ];
  if (oferta.link) lineas.push(`Ficha: ${oferta.link}`);
  lineas.push("", `Colega: ${quien}`, contacto);
  if (visto) lineas.push(visto);
  lineas.push("");
  if (evaluacion.cumple.length) lineas.push(`Cumple: ${evaluacion.cumple.join(", ")}.`);
  if (evaluacion.salvedades.length) lineas.push(`Ojo: ${evaluacion.salvedades.join(". ")}.`);
  lineas.push(
    "",
    "Confirmá disponibilidad y precio con el colega antes de mostrárselo al cliente.",
    // Regla de negocio de Juan: el sistema no reparte comisiones.
    "La comisión se comparte: quien tiene el cliente y quien tiene la propiedad se ponen de acuerdo.",
    "",
    // Doble trabajo: registra que paso con la oportunidad Y renueva la ventana de
    // 24h de Meta, que es lo unico que mantiene el canal abierto para el proximo
    // match (los mensajes de Sofi NO la renuevan, solo los del asesor).
    "Contame cómo te fue con una respuesta corta."
  );
  return lineas.filter((l) => l !== undefined).join("\n");
}

/**
 * Los {{1}} {{2}} {{3}} de la plantilla `radar_match_mandato`. Meta rechaza
 * parametros vacios y con saltos de linea, asi que los tres van garantizados
 * con contenido y en una sola linea.
 *
 * La plantilla NO lleva link ni telefono a proposito: el detalle sale por texto
 * libre una vez que el asesor responde y abre la ventana.
 */
function paramsPlantilla({ mandato, oferta }) {
  const limpiar = (s, fallback) => String(s || "").replace(/\s+/g, " ").trim() || fallback;
  return [
    limpiar(mandato.cliente_nombre, "un cliente tuyo"),
    limpiar([oferta.tipo, oferta.precio].filter(Boolean).join(" "), "una propiedad"),
    limpiar(oferta.zona || oferta.ciudad, "Medellín"),
  ];
}

module.exports = { buildMandatoMatchAlert, paramsPlantilla };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test test/mandato-aviso.test.js`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/notifications/mandato-aviso.js test/mandato-aviso.test.js
git commit -m "feat(radar): redaccion del aviso de match de mandato al asesor"
```

---

### Task 5: Orquestación y envío `src/groups/avisar-mandato.js`

**Files:**
- Create: `src/groups/avisar-mandato.js`
- Modify: `src/lib/mensaje-asesor.js` (exportar `VENTANA_CERRADA`)
- Test: `test/group-avisar-mandato.test.js`

**Interfaces:**
- Consumes: `evaluarOferta` (Task 3), `buildMandatoMatchAlert` y `paramsPlantilla`
  (Task 4), `mandatos` (Task 2), `directorio.telefonoDe(orgId, lid, {sesion, jid})`,
  `mensajeAsesor.enviarYRegistrar(org, telefono, texto) -> {ok, wamid, error}`,
  `canalWhatsapp.sendWhatsAppTemplate(org, to, {name, language, bodyParams}) -> {ok, wamid, error}`,
  `advisors.findById(orgId, id)`.
- Produces:
  - `cruzarOfertaConMandatos(org, oferta, {allyPropertyId, colega, grupo, vistoEnIso, sesion, jid}) -> {resultado, avisados:[], matches:number}`

- [ ] **Step 1: Exportar la deteccion de ventana cerrada**

En `src/lib/mensaje-asesor.js`, cambiar la última línea:

```javascript
// Se exporta VENTANA_CERRADA porque el carril de compra necesita distinguir
// "Meta rechazo por ventana cerrada" (donde la plantilla SI sirve) de cualquier
// otro fallo (donde no sirve de nada reintentar con plantilla).
module.exports = { enviarYRegistrar, VENTANA_CERRADA };
```

- [ ] **Step 2: Escribir el test que falla**

```javascript
// test/group-avisar-mandato.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const mandatosData = require("../src/data/mandatos");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const canalWhatsapp = require("../src/channels/whatsapp");
const advisors = require("../src/data/advisors");
const directorio = require("../src/groups/directorio");
const { cruzarOfertaConMandatos } = require("../src/groups/avisar-mandato");

const ORG = { id: "org-1" };
const OFERTA = {
  tipo: "Apartamento", operacion: "Venta", zona: "El Poblado",
  precio: "$1.580.000.000", habitaciones: 4, area: 246, banos: 3, garajes: 2,
};

let enviados, plantillas;

beforeEach(() => {
  mandatosData._reset();
  enviados = [];
  plantillas = [];
  mensajeAsesor.enviarYRegistrar = async (org, tel, texto) => {
    enviados.push({ tel, texto });
    return { ok: true, wamid: "wamid-1" };
  };
  canalWhatsapp.sendWhatsAppTemplate = async (org, tel, opts) => {
    plantillas.push({ tel, opts });
    return { ok: true, wamid: "wamid-tpl" };
  };
  advisors.findById = async () => ({ id: "adv-nat", name: "Natalia Velez", phone: "573001878024" });
  directorio.telefonoDe = async () => "573244151819";
  process.env.RADAR_ESCALADO_PHONE = "573028536489"; // Catherine
});

async function unMandato(extra = {}) {
  return mandatosData.crear(ORG.id, {
    cliente_nombre: "Marcela Restrepo", advisor_id: "adv-nat",
    operacion: "venta", tipo: "apartamento", zonas: ["El Poblado"],
    precio_max: 2200000000, habitaciones: 4, area_min: 150,
    exigencias: ["balcón"], ...extra,
  });
}

test("el aviso va al advisor_id del mandato, no a un asesor cualquiera", async () => {
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(r.avisados.length, 1);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].tel, "573001878024");
});

test("el aviso lleva el telefono del colega resuelto por el directorio", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1", colega: { lid: "129781211373754", nombre: "Glovi" } });
  assert.ok(enviados[0].texto.includes("573244151819"));
});

test("sin telefono resuelto NO aparece el lid como si fuera un numero", async () => {
  directorio.telefonoDe = async () => null;
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, {
    allyPropertyId: "ally-1", colega: { lid: "129781211373754", nombre: "Patricia Vivares" }, grupo: "SOLO POBLADO",
  });
  assert.ok(!enviados[0].texto.includes("129781211373754"), "el LID no es un telefono marcable");
  assert.ok(/Patricia Vivares/.test(enviados[0].texto));
});

test("el mismo par (mandato, propiedad) no avisa dos veces", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(enviados.length, 1, "un repost del colega no genera un segundo WhatsApp");
});

test("una oferta que no cruza ningun mandato no manda nada", async () => {
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, { ...OFERTA, operacion: "Arriendo" }, { allyPropertyId: "ally-2" });
  assert.strictEqual(r.matches, 0);
  assert.strictEqual(enviados.length, 0);
});

test("ventana cerrada: cae a la plantilla y NO escala a Catherine", async () => {
  mensajeAsesor.enviarYRegistrar = async () => ({ ok: false, error: "(#131047) Message failed to send because more than 24 hours have passed" });
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(plantillas.length, 1);
  assert.strictEqual(plantillas[0].opts.name, "radar_match_mandato");
  assert.strictEqual(plantillas[0].opts.bodyParams.length, 3);
  assert.strictEqual(r.resultado, "plantilla");
});

test("si tambien falla la plantilla, escala a Catherine", async () => {
  mensajeAsesor.enviarYRegistrar = async (org, tel) => {
    enviados.push({ tel });
    return { ok: false, error: "131047 more than 24 hours" };
  };
  canalWhatsapp.sendWhatsAppTemplate = async () => ({ ok: false, error: "template not approved" });
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(r.resultado, "escalado");
  assert.ok(enviados.some((e) => e.tel === "573028536489"), "Catherine tiene que recibirlo");
});

test("entregado bien: NO escala a Catherine", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.ok(!enviados.some((e) => e.tel === "573028536489"), "el mandato tiene dueño: si llego, es asunto de el");
});

test("un fallo que NO es de ventana cerrada escala sin gastar una plantilla", async () => {
  mensajeAsesor.enviarYRegistrar = async () => ({ ok: false, error: "invalid phone number" });
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(plantillas.length, 0, "la plantilla no arregla un numero invalido");
  assert.strictEqual(r.resultado, "escalado");
});

test("un mandato sin advisor_id no revienta: escala", async () => {
  advisors.findById = async () => null;
  await unMandato({ advisor_id: null });
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(r.resultado, "escalado");
});
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `node --test test/group-avisar-mandato.test.js`
Expected: FAIL — `Cannot find module '../src/groups/avisar-mandato'`

- [ ] **Step 4: Implementar el módulo**

```javascript
// src/groups/avisar-mandato.js
//
// Orquesta el carril de COMPRA: una oferta que un colega publico en un grupo se
// cruza contra los mandatos activos, y cada match se le manda al asesor dueño del
// mandato. Sofi NO le escribe al colega en este carril.
//
// POR QUE NO SE LE ESCRIBE AL COLEGA (Juan, 2026-08-25). Cuando VENDEMOS, el
// colega pidio: un DM es la conducta que espera, y se le ofrece lo nuestro. Acá
// el colega publico una oferta al grupo y no nos pidio nada — un DM automatico es
// un mensaje frio sobre una propiedad ajena, que es el patron que mas reportes de
// baneo tiene (ver src/lib/waha.js). Y negociar la propiedad de otro con reparto
// de comision lo tiene que hacer una persona.
//
// NINGUN MATCH MUERE EN SILENCIO. Es el principio heredado del carril de venta
// (Juan, 2026-08-20): los limites desvian, no descartan.
//
// Los modulos de envio se requieren COMPLETOS y no destructurados: destructurar
// congela la referencia y deja los tests sin forma de mockear el envio (mismo
// criterio que src/groups/vivo.js).
const mandatosData = require("../data/mandatos");
const advisors = require("../data/advisors");
const directorio = require("./directorio");
const mensajeAsesor = require("../lib/mensaje-asesor");
const canalWhatsapp = require("../channels/whatsapp");
const { evaluarOferta } = require("./cruce-mandatos");
const { buildMandatoMatchAlert, paramsPlantilla } = require("../notifications/mandato-aviso");

const PLANTILLA = process.env.RADAR_MANDATO_TEMPLATE || "radar_match_mandato";
// A quien se le escala un aviso que no se pudo entregar. Catherine atiende las dos
// lineas (ver el spec del 2026-08-22 §4.4), asi que es el mismo destino que ya usa
// el carril de venta cuando no puede responder solo.
const ESCALADO_TO = () => process.env.RADAR_ESCALADO_PHONE || process.env.RADAR_REVISOR_PHONE || "";

/**
 * @param oferta   propiedad del colega, shape de ally_properties
 * @param opts.allyPropertyId  id de la fila persistida (clave del dedup)
 * @param opts.colega  { lid, nombre, telefono? }
 * @returns { resultado, avisados, matches }
 *   resultado: 'sin_mandatos' | 'sin_match' | 'enviado' | 'plantilla' | 'escalado'
 */
async function cruzarOfertaConMandatos(org, oferta, opts = {}) {
  const { allyPropertyId = null, colega = {}, grupo = null, vistoEnIso = null, sesion = null, jid = null } = opts;
  if (!allyPropertyId) return { resultado: "sin_oferta", avisados: [], matches: 0 };

  const activos = await mandatosData.listarActivos(org.id);
  if (activos.length === 0) return { resultado: "sin_mandatos", avisados: [], matches: 0 };

  const cruces = [];
  for (const mandato of activos) {
    const evaluacion = evaluarOferta(oferta, mandato);
    if (evaluacion && evaluacion.sirve) cruces.push({ mandato, evaluacion });
  }
  if (cruces.length === 0) return { resultado: "sin_match", avisados: [], matches: 0 };

  // El telefono del colega se resuelve UNA vez por oferta, no una por mandato:
  // refrescar el padron de un grupo puede ser un HTTP de cientos de participantes.
  //
  // Se rompe aca a proposito la decision de ofertas.js de no tocar el directorio
  // (ese modulo solo archiva y no debe cargar con esa dependencia). Sin telefono,
  // el aviso pierde la mitad de su valor.
  let telefonoColega = colega.telefono || null;
  if (!telefonoColega && colega.lid) {
    telefonoColega = await directorio
      .telefonoDe(org.id, colega.lid, { sesion, jid })
      .catch((e) => {
        console.warn("[radar] no se pudo resolver el telefono del colega:", e.message);
        return null;
      });
  }

  const avisados = [];
  let ultimoResultado = "sin_match";
  for (const { mandato, evaluacion } of cruces) {
    // Se RESERVA antes de mandar: si el envio falla, el par queda registrado con
    // su error en vez de reintentarse en loop en cada repost del colega.
    const { esNuevo, id: alertaId } = await mandatosData.registrarAlerta(org.id, {
      mandatoId: mandato.id, allyPropertyId, advisorId: mandato.advisor_id, puntaje: evaluacion.puntaje,
    });
    if (!esNuevo) continue;

    const texto = buildMandatoMatchAlert({
      mandato, oferta, evaluacion,
      colega: { nombre: colega.nombre || oferta.contacto_nombre || null, telefono: telefonoColega },
      grupo, vistoEnIso,
    });

    const advisor = mandato.advisor_id ? await advisors.findById(org.id, mandato.advisor_id).catch(() => null) : null;
    const entrega = advisor && advisor.phone
      ? await entregar(org, advisor.phone, texto, { mandato, oferta })
      : { ok: false, via: null, error: "mandato sin asesor con telefono" };

    await mandatosData.marcarEntrega(org.id, alertaId, {
      entregado: entrega.ok, via: entrega.via, error: entrega.error,
    });

    if (entrega.ok) {
      avisados.push({ mandatoId: mandato.id, advisorPhone: advisor.phone, via: entrega.via });
      ultimoResultado = entrega.via === "plantilla" ? "plantilla" : "enviado";
      continue;
    }

    // Escalado a Catherine: SOLO si no se pudo entregar (Juan, 2026-08-25). Si
    // llego y el asesor no contesto, es asunto de el — el mandato tiene dueño.
    const escalado = await escalar(org, { texto, mandato, motivo: entrega.error, alertaId });
    ultimoResultado = escalado ? "escalado" : "no_entregado";
  }

  return { resultado: ultimoResultado, avisados, matches: cruces.length };
}

// Texto libre primero; si Meta lo rechaza porque la ventana de 24h esta cerrada,
// la plantilla. La plantilla no arregla ningun otro tipo de fallo, asi que no se
// gasta una en un numero invalido o en un error de credenciales.
async function entregar(org, telefono, texto, { mandato, oferta }) {
  const libre = await mensajeAsesor.enviarYRegistrar(org, telefono, texto).catch((e) => ({ ok: false, error: e.message }));
  if (libre && libre.ok) return { ok: true, via: "texto_libre", error: null };

  const error = (libre && libre.error) || "sin_respuesta";
  if (!mensajeAsesor.VENTANA_CERRADA.test(error)) return { ok: false, via: null, error };

  const tpl = await canalWhatsapp
    .sendWhatsAppTemplate(org, telefono, {
      name: PLANTILLA, language: "es", bodyParams: paramsPlantilla({ mandato, oferta }),
    })
    .catch((e) => ({ ok: false, error: e.message }));
  if (tpl && tpl.ok) return { ok: true, via: "plantilla", error: null };
  return { ok: false, via: null, error: `${error} | plantilla: ${(tpl && tpl.error) || "sin_respuesta"}` };
}

async function escalar(org, { texto, mandato, motivo, alertaId }) {
  const to = ESCALADO_TO();
  if (!to) {
    console.error("[radar] match sin entregar y sin RADAR_ESCALADO_PHONE configurado:", mandato.id);
    return false;
  }
  const aviso = [
    `⚠️ Este match no se le pudo entregar al asesor del mandato de ${mandato.cliente_nombre || "un cliente"}.`,
    `Motivo: ${motivo || "sin detalle"}.`,
    "",
    texto,
  ].join("\n");
  const r = await mensajeAsesor.enviarYRegistrar(org, to, aviso).catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok) await mandatosData.marcarEscalado(org.id, alertaId, to);
  else console.error("[radar] tampoco se pudo escalar el match:", r && r.error);
  return Boolean(r && r.ok);
}

module.exports = { cruzarOfertaConMandatos, PLANTILLA };
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `node --test test/group-avisar-mandato.test.js`
Expected: PASS — 10 tests

- [ ] **Step 6: Implementar el tope diario por mandato (spec §4.5)**

Agregar en `src/data/mandatos.js`:

```javascript
// Cuantos avisos se generaron HOY para un mandato. Alimenta el tope diario
// (RADAR_MANDATO_MAX_DIA). Se cuenta sobre las alertas creadas, no sobre las
// entregadas: el tope existe para no ahogar al asesor, y un aviso que salio y
// fallo igual le llego el intento.
async function avisosHoy(orgId, mandatoId) {
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  if (!supabase) {
    return memory.alertas.filter(
      (a) => a.org_id === orgId && a.mandato_id === mandatoId && a.created_at >= desde.toISOString()
    ).length;
  }
  const { count, error } = await supabase
    .from("mandato_match_alerts")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("mandato_id", mandatoId)
    .gte("created_at", desde.toISOString());
  // Ante la duda NO se frena: este tope nace apagado (default 0 = sin limite) y
  // su proposito es aliviar, no descartar oportunidades. Si no se pudo contar,
  // se deja pasar — al contrario del criterio de politica.js, donde callar es
  // gratis porque el riesgo es publicar ante 80 competidores.
  if (error) {
    console.warn("[mandatos] no se pudo contar los avisos de hoy:", error.message);
    return 0;
  }
  return count || 0;
}
```

Agregarla al `module.exports` de `src/data/mandatos.js` y usarla en
`cruzarOfertaConMandatos`, dentro del `for` y **antes** de `registrarAlerta`:

```javascript
    const tope = Number(process.env.RADAR_MANDATO_MAX_DIA || 0);
    if (tope > 0 && (await mandatosData.avisosHoy(org.id, mandato.id)) >= tope) {
      console.log(`[radar] mandato ${mandato.id} llego al tope diario de ${tope} avisos`);
      continue;
    }
```

Y el test, en `test/group-avisar-mandato.test.js`:

```javascript
test("con tope diario en 1, el segundo match del dia no se manda", async () => {
  process.env.RADAR_MANDATO_MAX_DIA = "1";
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-2" });
  process.env.RADAR_MANDATO_MAX_DIA = "0";
  assert.strictEqual(enviados.length, 1);
});

test("sin tope configurado no se limita nada (default de producto)", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-2" });
  assert.strictEqual(enviados.length, 2);
});
```

Run: `node --test test/group-avisar-mandato.test.js`
Expected: PASS — 12 tests

- [ ] **Step 7: Commit**

```bash
git add src/groups/avisar-mandato.js src/data/mandatos.js src/lib/mensaje-asesor.js test/group-avisar-mandato.test.js
git commit -m "feat(radar): avisar al asesor del match, con plantilla, tope diario y escalado si no entrega"
```

---

### Task 6: Reactivar las ofertas en vivo

**Files:**
- Modify: `src/groups/vivo.js:96-108` (el bloque `oferta_ignorada`)
- Test: `test/group-vivo-ofertas.test.js`

**Interfaces:**
- Consumes: `cruzarOfertaConMandatos` (Task 5), `guardarOferta` de `src/groups/ofertas.js`
  (firma: `guardarOferta(org, oferta, {vistoEn}) -> Promise<allyPropertyRow|null>`),
  `evaluarOferta` (Task 3), `mandatosData.listarActivos` (Task 2).
- Produces: `procesarMensaje` devuelve `{resultado: "oferta_sin_match"}` u
  `{resultado: "oferta_cruzada", matches}` en vez de `"oferta_ignorada"`.

**Antes de empezar:** leer el Hallazgo 2 arriba. Esta tarea implementa
"cruzar primero, persistir solo si hay match" y eso es una desviación del spec §4.4.
Confirmar con Juan al cerrar la tarea.

- [ ] **Step 1: Escribir el test que falla**

```javascript
// test/group-vivo-ofertas.test.js
//
// Las ofertas volvieron a la escucha en vivo (Juan, 2026-08-25), pero NO como
// estaban antes del 2026-08-20: entonces se persistian todas y saturaban
// group_signals (402 ofertas de 438 señales en 2 dias) sin aportar nada. Ahora
// se cruzan en memoria contra los mandatos y solo se persiste lo que cruza.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const mandatosData = require("../src/data/mandatos");
const ofertas = require("../src/groups/ofertas");
const avisar = require("../src/groups/avisar-mandato");

let guardadas, cruces;

beforeEach(() => {
  mandatosData._reset();
  guardadas = [];
  cruces = [];
  ofertas.guardarOferta = async (org, o) => {
    guardadas.push(o);
    return { id: "ally-nueva" };
  };
  avisar.cruzarOfertaConMandatos = async (org, o, opts) => {
    cruces.push({ o, opts });
    return { resultado: "enviado", avisados: [{}], matches: 1 };
  };
});

test("sin mandatos activos, una oferta no se persiste ni se cruza", async () => {
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta({ id: "org-1" }, { clase: "oferta", tipo: "apartamento", zonas: ["El Poblado"], precio_max: 900000000 }, {});
  assert.strictEqual(r.resultado, "oferta_sin_mandatos");
  assert.strictEqual(guardadas.length, 0, "sin nadie esperando, guardarla es la saturacion que Juan apago");
  assert.strictEqual(cruces.length, 0);
});

test("una oferta que no le sirve a ningun mandato no se persiste", async () => {
  await mandatosData.crear("org-1", {
    cliente_nombre: "Marcela", operacion: "venta", tipo: "apartamento",
    zonas: ["El Poblado"], precio_max: 2200000000, habitaciones: 4, area_min: 150,
  });
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta(
    { id: "org-1" },
    { clase: "oferta", operacion: "arriendo", tipo: "apartamento", zonas: ["Bello"], precio_max: 3000000 },
    {}
  );
  assert.strictEqual(r.resultado, "oferta_sin_match");
  assert.strictEqual(guardadas.length, 0);
});

test("una oferta que cruza SI se persiste y se avisa", async () => {
  await mandatosData.crear("org-1", {
    cliente_nombre: "Marcela", advisor_id: "adv-nat", operacion: "venta", tipo: "apartamento",
    zonas: ["El Poblado"], precio_max: 2200000000, habitaciones: 4, area_min: 150,
  });
  const { manejarOferta } = require("../src/groups/vivo");
  const r = await manejarOferta(
    { id: "org-1" },
    {
      clase: "oferta", operacion: "venta", tipo: "apartamento", zonas: ["El Poblado"],
      precio_max: 1580000000, habitaciones: 4, area_min: 246,
      mensaje: { autor: "Glovi", autorTelefono: "129781211373754", groupId: "g-1", texto: "Dúplex Loma del Tesoro" },
    },
    { nombre: "SOLO VIVIENDA >$1000 MLLS" }
  );
  assert.strictEqual(r.resultado, "oferta_cruzada");
  assert.strictEqual(guardadas.length, 1, "una oferta que le sirve a alguien SI vale persistirla");
  assert.strictEqual(cruces.length, 1);
  assert.strictEqual(cruces[0].opts.allyPropertyId, "ally-nueva");
  assert.strictEqual(cruces[0].opts.grupo, "SOLO VIVIENDA >$1000 MLLS");
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/group-vivo-ofertas.test.js`
Expected: FAIL — `manejarOferta is not a function`

- [ ] **Step 3: Implementar `manejarOferta` y reemplazar el `return` de la línea 108**

En `src/groups/vivo.js`, agregar los requires arriba (junto a los que ya están):

```javascript
const ofertas = require("./ofertas");
const avisarMandato = require("./avisar-mandato");
const mandatosData = require("../data/mandatos");
const { evaluarOferta } = require("./cruce-mandatos");
```

Reemplazar el bloque completo de `// Ofertas de colegas: apagadas...` hasta
`if (c.clase === "oferta") return { resultado: "oferta_ignorada" };` por:

```javascript
  // Ofertas de colegas: VOLVIERON a la escucha en vivo el 2026-08-25, pero no
  // como estaban antes.
  //
  // HISTORIA, porque el motivo importa. Juan las apago el 2026-08-20 ("apaguemos
  // las ofertas no las leamos solo quiero que lea los pedidos, las ofertas nos
  // estan saturando"): se persistian TODAS y eran el grueso de group_signals
  // (402 de 438 señales en dos dias), inflando cada consulta del radar sin
  // aportar lo que el negocio necesitaba. El problema nunca fue leerlas: fue
  // guardar cientos que nadie miraba.
  //
  // Lo que cambio es que ahora hay contra QUE cruzarlas — los mandatos de compra
  // (db/migrations/2026-08-25_mandatos_compra.sql). Asi que se invierte el orden:
  // se cruza en memoria y se persiste SOLO lo que le sirve a alguien. Con la tasa
  // de cruce medida (12 matches sobre 329 ofertas, ~4%), eso es un orden de
  // magnitud menos escritura que antes, y cada fila que queda tiene un dueño.
  //
  // Si algun dia hace falta el archivo completo de ofertas, el camino es el
  // import de export .txt (importar-export.js), que sigue guardando todo a
  // proposito: ahi es una carga puntual, no ruido continuo.
  // OJO: `jid` NO es una variable suelta en este scope (procesarMensaje solo
  // destructura grupo, modo, enviar, asesor, advisorId, sesion, ahora). El jid del
  // grupo vive en `grupo.jid` — pasar un `jid` inexistente aca es un
  // ReferenceError que revienta el primer mensaje de tipo oferta en produccion.
  if (c.clase === "oferta") return manejarOferta(org, c, grupo, { advisorId, sesion, jid: grupo && grupo.jid });
```

Y agregar la función (exportada, para poder probarla sola):

```javascript
/**
 * Una oferta de colega en vivo: se cruza contra los mandatos activos y solo se
 * persiste si le sirve a alguno.
 *
 * @returns { resultado, matches? }
 *   'oferta_sin_mandatos' | 'oferta_sin_match' | 'oferta_cruzada'
 */
async function manejarOferta(org, c, grupo = {}, { advisorId = null, sesion = null, jid = null } = {}) {
  const activos = await mandatosData.listarActivos(org.id).catch((e) => {
    console.warn("[radar] no se pudieron leer los mandatos:", e.message);
    return [];
  });
  if (activos.length === 0) return { resultado: "oferta_sin_mandatos" };

  // Prueba baratísima antes de escribir nada: el shape del clasificador se
  // aproxima al de ally_properties solo para este tanteo. La evaluacion real,
  // con la fila persistida, la hace cruzarOfertaConMandatos.
  const tanteo = {
    tipo: c.tipo || null,
    operacion: c.operacion || null,
    zona: (Array.isArray(c.zonas) && c.zonas[0]) || c.zona || null,
    ciudad: c.ciudad || null,
    precio: c.precio_max || c.precio_min || 0,
    habitaciones: c.habitaciones || null,
    area: c.area_min || null,
    banos: c.banos || null,
    garajes: c.garajes || null,
    estrato: c.estrato || null,
  };
  const sirveAAlguno = activos.some((m) => {
    const e = evaluarOferta(tanteo, m);
    return Boolean(e && e.sirve);
  });
  if (!sirveAAlguno) return { resultado: "oferta_sin_match" };

  const fila = await ofertas.guardarOferta(org, { ...c, mensaje: c.mensaje || {} }).catch((e) => {
    console.warn("[radar] no se pudo guardar la oferta que cruzo:", e.message);
    return null;
  });
  if (!fila || !fila.id) return { resultado: "oferta_sin_match" };

  const r = await avisarMandato.cruzarOfertaConMandatos(org, { ...tanteo, ...fila }, {
    allyPropertyId: fila.id,
    colega: { lid: c.mensaje?.autorTelefono || null, nombre: c.mensaje?.autor || null },
    grupo: grupo?.nombre || null,
    vistoEnIso: new Date().toISOString(),
    sesion, jid,
  });
  return { resultado: "oferta_cruzada", matches: r.matches, avisados: r.avisados.length };
}
```

Y agregarla a los exports:

```javascript
module.exports = {
  procesarMensaje, idEnVivo, asistir, destinatarios, aprobarManual, responderPorDmManual,
  manejarOferta, VENTANA_LIMITE_HORAS,
};
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test test/group-vivo-ofertas.test.js`
Expected: PASS — 3 tests

- [ ] **Step 5: Regresión completa del carril de venta**

Run: `node --test test/group-vivo.test.js test/group-asistido.test.js test/group-politica.test.js test/group-publicable.test.js test/group-dm.test.js test/group-canal.test.js`
Expected: PASS — todo verde. Si algo falla acá, el enganche rompió el carril de
venta y hay que arreglarlo antes de seguir; ese carril funciona en producción.

- [ ] **Step 6: Commit**

```bash
git add src/groups/vivo.js test/group-vivo-ofertas.test.js
git commit -m "feat(radar): reactivar las ofertas en vivo, cruzando contra mandatos antes de persistir"
```

---

### Task 7: Tool `registrar_mandato_compra`

**Files:**
- Modify: `src/agent/tools.js` (definición + rama en `executeTool`)
- Modify: `src/agent/sofi-comando-tools.js` (la misma tool en el chat del CRM)
- Test: `test/mandato-tool.test.js`

**Interfaces:**
- Consumes: `mandatosData.crear` (Task 2), `advisors.findByPhone(orgId, phone)`.
- Produces: tool `registrar_mandato_compra` en los dos motores; devuelve el texto de
  confirmación campo por campo que Sofi le repite al asesor.

- [ ] **Step 1: Escribir el test que falla**

```javascript
// test/mandato-tool.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const mandatosData = require("../src/data/mandatos");
// OJO: el módulo exporta TOOL_DEFINITIONS, no `tools`. Verificado en
// src/agent/tools.js:1112 — el export es una lista explícita.
const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");

const CTX = { org: { id: "org-1" }, advisor: { id: "adv-nat", name: "Natalia Velez" } };

beforeEach(() => mandatosData._reset());

test("la tool esta declarada y exige el nombre del cliente", () => {
  const t = TOOL_DEFINITIONS.find((x) => x.name === "registrar_mandato_compra");
  assert.ok(t, "la tool tiene que existir");
  assert.ok(t.input_schema.required.includes("cliente_nombre"));
});

test("guarda el mandato y confirma CADA campo que entendio", async () => {
  const salida = await executeTool("registrar_mandato_compra", {
    cliente_nombre: "Marcela Restrepo",
    operacion: "Venta", tipo: "Apartamento",
    zonas: ["El Poblado", "Las Palmas"],
    precio_max: 2200000000, habitaciones: 4, area_min: 150,
    exigencias: ["balcón", "buena vista", "moderna", "zonas sociales"],
    texto_original: "Mi cliente subió presupuesto hasta 2.200 millones...",
  }, CTX);

  // La confirmacion es obligatoria: un mandato mal leido filtra mal para siempre
  // y no se queja. Es la unica defensa.
  assert.match(salida, /Marcela Restrepo/);
  assert.match(salida, /2\.200\.000\.000|2200000000/);
  assert.match(salida, /4/);
  assert.match(salida, /150/);
  assert.match(salida, /balcón/);
  assert.match(salida, /El Poblado/);
  assert.match(salida, /corrijo|corregir|está bien/i, "tiene que invitar a corregir");

  const guardados = await mandatosData.listarActivos("org-1");
  assert.strictEqual(guardados.length, 1);
  assert.strictEqual(guardados[0].advisor_id, "adv-nat", "el mandato queda a nombre del asesor que lo cargo");
  assert.deepStrictEqual(guardados[0].exigencias, ["balcón", "buena vista", "moderna", "zonas sociales"]);
  assert.ok(guardados[0].texto_original, "el brief original se conserva para poder auditarlo");
});

test("sin cliente_nombre no guarda nada y lo dice", async () => {
  const salida = await executeTool("registrar_mandato_compra", { precio_max: 500000000 }, CTX);
  assert.match(salida, /nombre/i);
  assert.strictEqual((await mandatosData.listarActivos("org-1")).length, 0);
});

test("un cliente final NO puede cargar mandatos", async () => {
  const salida = await executeTool("registrar_mandato_compra", { cliente_nombre: "X" }, { org: { id: "org-1" }, advisor: null });
  assert.match(salida, /asesor/i, "esto es una herramienta interna del equipo");
  assert.strictEqual((await mandatosData.listarActivos("org-1")).length, 0);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test test/mandato-tool.test.js`
Expected: FAIL — `Herramienta desconocida: registrar_mandato_compra`

- [ ] **Step 3: Declarar la tool en `src/agent/tools.js`**

Agregar al array de tools, después de `registrar_demanda_colega`:

```javascript
  {
    name: "registrar_mandato_compra",
    description:
      "Registra un MANDATO DE COMPRA: un cliente NUESTRO que está buscando algo para comprar o arrendar y que todavía no encontramos. Usala cuando un asesor de la casa te reenvíe el requerimiento de su cliente (ej. 'mi cliente busca apto hasta 600 millones con 3 habitaciones en Laureles'). A partir de ese momento, cada propiedad que un colega publique en un grupo gremial se cruza contra este mandato y, si le sirve, se le avisa al asesor. NO la uses con un cliente final que te escribe buscando para sí mismo (eso es registrar_dato_lead), ni para el pedido de un colega de otra inmobiliaria (eso es registrar_demanda_colega): esto es el cliente de un asesor de la casa. Extrae todos los datos del texto aunque venga en formato libre, y NO inventes ninguno: si el mensaje no dice el área, omití el campo.",
    input_schema: {
      type: "object",
      properties: {
        cliente_nombre: { type: "string", description: "Nombre del cliente comprador. OBLIGATORIO: si el asesor no lo dice, pregúntaselo antes de llamar esta herramienta." },
        cliente_telefono: { type: "string", description: "Teléfono del cliente, si lo menciona" },
        operacion: { type: "string", enum: ["Venta", "Arriendo"], description: "Venta si compra, Arriendo si va a arrendar. Omite si no queda claro" },
        tipo: { type: "string", description: "Apartamento, Casa, Consultorio, Local, Oficina, Bodega, Lote, Finca…" },
        zonas: { type: "array", items: { type: "string" }, description: "TODAS las zonas o barrios que acepta. 'Poblado o Envigado' son DOS. Nunca metas la ciudad acá" },
        zonas_excluidas: { type: "array", items: { type: "string" }, description: "Zonas que descarta explícitamente" },
        ciudad: { type: "string", description: "Municipio, ej 'Medellín', 'Envigado'" },
        precio_min: { type: "integer", description: "Piso en pesos, sin puntos. Omite si no lo dice" },
        precio_max: { type: "integer", description: "Tope en pesos, sin puntos. 'hasta 600 millones' -> 600000000. Omite si no lo dice" },
        habitaciones: { type: "integer", description: "Alcobas pedidas. Omite si no las menciona" },
        flexible_habitaciones: { type: "boolean", description: "true SOLO si acepta una alcoba menos con estudio o servicio (ej. '4 habitaciones, pueden ser 3 + estudio')" },
        area_min: { type: "integer", description: "Metros cuadrados mínimos. Omite si no los dice" },
        banos: { type: "integer", description: "Baños pedidos. Omite si no los dice" },
        garajes: { type: "integer", description: "Parqueaderos pedidos. Omite si no los dice" },
        estrato: { type: "integer", description: "Estrato pedido. Omite si no lo dice" },
        exigencias: { type: "array", items: { type: "string" }, description: "Requisitos que no son un número: 'balcón', 'buena vista', 'moderna', 'gym', 'zonas húmedas', 'lavadora y secadora', 'unidad con zonas sociales', 'pago de contado'. Copiá las palabras del cliente." },
        plazo: { type: "string", description: "Si es un arriendo temporal, cuánto tiempo. Ej '3 a 6 meses'" },
        notas: { type: "string", description: "Cualquier otro detalle relevante en pocas palabras" },
        texto_original: { type: "string", description: "El texto del requerimiento TAL COMO te lo reenviaron, completo y sin resumir. Obligatorio si el asesor te pegó un texto: es lo que permite revisar después si entendiste bien." },
      },
      required: ["cliente_nombre"],
    },
  },
```

- [ ] **Step 4: Implementar la rama en `executeTool` y el handler**

En `executeTool`, junto a las otras ramas:

```javascript
  if (name === "registrar_mandato_compra") {
    return registrarMandatoCompra(input, ctx);
  }
```

Y el handler (junto a `registrarDemandaColega`):

```javascript
// Un cliente comprador de la casa, cargado por su asesor. A partir de acá cada
// oferta que un colega publique en un grupo se cruza contra esto
// (src/groups/avisar-mandato.js).
//
// LA CONFIRMACION NO ES CORTESIA. Un mandato mal leido filtra mal para siempre y
// no se queja: los falsos negativos son invisibles por definicion. Repetir campo
// por campo lo que se entendio es la unica forma de que el asesor lo cache, y es
// la misma leccion que dejo el pedido recortado del 2026-08-24 (migracion
// group_signals_exigencias).
async function registrarMandatoCompra(input, ctx) {
  if (!ctx.advisor) {
    return "Esta herramienta es interna del equipo: solo un asesor de la casa puede registrar un mandato de compra. No la uses con un cliente.";
  }
  if (!String(input.cliente_nombre || "").trim()) {
    return "Falta el nombre del cliente. Preguntale de quién es el mandato antes de registrarlo.";
  }

  const fila = await mandatos.crear(ctx.org.id, {
    ...input,
    operacion: input.operacion ? String(input.operacion).toLowerCase() : null,
    advisor_id: ctx.advisor.id,
  });

  const pesos = (n) => `$${Number(n).toLocaleString("es-CO")}`;
  const lineas = [`Listo, guardé el mandato de ${fila.cliente_nombre}:`];
  const que = [
    fila.operacion === "arriendo" ? "Arriendo" : fila.operacion === "venta" ? "Compra" : null,
    fila.tipo || null,
    fila.precio_max ? `hasta ${pesos(fila.precio_max)}` : null,
    fila.plazo ? `por ${fila.plazo}` : null,
  ].filter(Boolean).join(" ");
  if (que) lineas.push(`· ${que}`);

  const medidas = [
    fila.area_min ? `mínimo ${fila.area_min} m²` : null,
    fila.habitaciones ? `${fila.habitaciones} habitaciones${fila.flexible_habitaciones ? " (acepta una menos con estudio o servicio)" : ""}` : null,
    fila.banos ? `${fila.banos} baños` : null,
    fila.garajes ? `${fila.garajes} garajes` : null,
    fila.estrato ? `estrato ${fila.estrato}` : null,
  ].filter(Boolean);
  if (medidas.length) lineas.push(`· ${medidas.join(", ")}`);

  const zonas = Array.isArray(fila.zonas) ? fila.zonas : [];
  if (zonas.length) lineas.push(`· Zonas: ${zonas.join(", ")}${fila.ciudad ? ` (${fila.ciudad})` : ""}`);
  const excl = Array.isArray(fila.zonas_excluidas) ? fila.zonas_excluidas : [];
  if (excl.length) lineas.push(`· Descarta: ${excl.join(", ")}`);

  const exig = Array.isArray(fila.exigencias) ? fila.exigencias : [];
  if (exig.length) lineas.push(`· Debe tener: ${exig.join(", ")}`);

  lineas.push("", "¿Está bien así o corrijo algo? Desde ahora, cada propiedad que un colega publique en los grupos y le sirva, te la mando.");
  return lineas.join("\n");
}
```

Agregar el require de `mandatos` arriba en `src/agent/tools.js`:

```javascript
const mandatos = require("../data/mandatos");
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `node --test test/mandato-tool.test.js`
Expected: PASS — 4 tests

- [ ] **Step 6: Replicar en el chat del CRM**

En `src/agent/sofi-comando-tools.js`, agregar la MISMA definición de tool (copiar el
bloque del Step 3 tal cual) y en su ejecutor la rama que llama al mismo handler. Para
no duplicar la lógica, exportar `registrarMandatoCompra` desde `src/agent/tools.js`.
El export es una **lista explícita** (`src/agent/tools.js:1112`), así que se agrega
ahí y no con una asignación suelta:

```javascript
module.exports = {
  TOOL_DEFINITIONS, executeTool, maybeCaptadorAlert, registrarDemandaColega, consultarRadarGrupos,
  registrarResultadoRadar, aprobarPedidoRadar, rechazarPedidoRadar, registrarMandatoCompra,
};
```

**VERIFICADO 2026-08-25 antes de ejecutar esta tarea — el `scope` de Sofi-Comando
NO tiene la misma forma que el `ctx` de WhatsApp; hay que adaptar en el punto de
llamada.** `scope` es `{ orgId, viewerUid, isAdmin }` (`sofi-comando.js:232`, `const
ctx = { scope, session }`), no `{ org, advisor }`. `viewerUid` es el `auth_user_id`
de quien está en la sesión del Centro de Comando — se resuelve la fila de
`advisors` con `advisors.findByAuthUserId(orgId, authUserId)` (ya existe,
`src/data/advisors.js:140`).

En `sofi-comando-tools.js`:

```javascript
const { registrarMandatoCompra } = require("./tools");
const advisors = require("../data/advisors"); // si ya esta importado, reusar

// dentro de executeCommandTool, antes del switch, con el mismo `scope` que ya
// se destructura arriba (`const { scope, session } = ctx;`):
if (name === "registrar_mandato_compra") {
  const advisor = await advisors.findByAuthUserId(scope.orgId, scope.viewerUid);
  return registrarMandatoCompra(input, { org: { id: scope.orgId }, advisor });
}
```

Construye en el punto de llamada el mismo shape `{ org: {id}, advisor }` que ya
espera `registrarMandatoCompra`, sin duplicar el handler ni inventar un segundo
contrato. Si `advisor` sale `null`, el propio handler ya sabe decir que es una
herramienta interna del equipo.

- [ ] **Step 7: Correr toda la suite**

Run: `npm test`
Expected: PASS — sin fallos nuevos

- [ ] **Step 8: Commit**

```bash
git add src/agent/tools.js src/agent/sofi-comando-tools.js test/mandato-tool.test.js
git commit -m "feat(radar): Sofi guarda mandatos de compra y confirma que entendio"
```

---

### Task 8 (REESCRITA): Mandatos y matches pendientes en el panel del CRM

**El plan original apuntaba a un archivo equivocado.** `crm/app/api/grupos/radar/route.ts`
es un `POST` que solo prende/apaga el motor vía `callBot` (proxy al servidor del bot) —
no expone ninguna lectura de señales. El panel real es un **Server Component de
Next.js**, `crm/app/(dashboard)/grupos/page.tsx`, que consulta Supabase directo con
`createClient()` y el helper `fetchSafe<T>(query, label)` (definido en
`crm/lib/fetch-safe.ts`), que ya degrada limpio si falta una tabla o columna —
exactamente el comportamiento que se necesita si la migración de la Tarea 1 no está
corrida todavía. Esta tarea reescrita apunta a ese archivo real.

**Files:**
- Modify: `crm/app/(dashboard)/grupos/page.tsx`
- Create: `crm/components/mandatos-panel.tsx`

**Interfaces:**
- Consumes: `fetchSafe<T>(query, label)` de `@/lib/fetch-safe` (ya importado en la
  página), `createClient()` de `@/lib/supabase/server` (ya importado), el helper
  `mias<T>(q)` YA DEFINIDO en la página (filtra por `advisor_id` para un no-admin).
- Produces: dos secciones nuevas en la página, después de "Propiedades de colegas"
  (al final del JSX, antes del cierre del `<div>` raíz): "Mis mandatos de compra" y
  "Matches sin entregar".

- [ ] **Step 1: Agregar las dos consultas, siguiendo el patrón exacto de las que ya existen**

Justo después del bloque `const [gruposRes, conMatchRes, demandasRes, ofertasRes] = await Promise.all([...`
(no antes: `mias` ya está definida arriba de ese punto en el archivo), agregar:

```typescript
const [mandatosRes, matchesPendientesRes] = await Promise.all([
  fetchSafe<Mandato>(
    mias(
      supabase.from("mandatos_compra").select("*").eq("estado", "activo")
        .order("created_at", { ascending: false })
    ),
    "grupos:mandatos"
  ),
  fetchSafe<MatchPendiente>(
    supabase.from("mandato_match_alerts").select("*").eq("entregado", false)
      .order("created_at", { ascending: false }).limit(50),
    "grupos:matches_pendientes"
  ),
]);
const mandatos = mandatosRes.data;
const matchesPendientes = matchesPendientesRes.data;
```

`mandato_match_alerts` NO se filtra con `mias()`: un match pendiente le importa a
cualquiera que pueda ver el panel de administración de matches sin entregar (es
información operativa del carril de compra, no del mandato de un asesor puntual) —
seguí el mismo criterio que ya usa `whatsapp_groups` en esta página (sin filtro de
asesor, porque los grupos son compartidos). Si en el futuro hace falta acotarlo,
que sea una decisión de producto explícita, no un default silencioso de esta tarea.

- [ ] **Step 2: Tipos, junto a los `type` que ya existen arriba del archivo (cerca de `type Metricas`)**

```typescript
type Mandato = {
  id: string;
  cliente_nombre: string;
  operacion: string | null;
  tipo: string | null;
  zonas: string[];
  precio_max: number | null;
  habitaciones: number | null;
  area_min: number | null;
  exigencias: string[];
  estado: string;
  created_at: string;
};

type MatchPendiente = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  error: string | null;
  escalado_a: string | null;
  created_at: string;
};
```

- [ ] **Step 3: El componente `crm/components/mandatos-panel.tsx`**

Server Component simple (sin `"use client"`, no hace falta interactividad — es
solo lectura, igual que `GruposPanel` cuando no necesita estado), siguiendo
exactamente el estilo visual de `grupos-panel.tsx` (mismas clases Tailwind, mismo
patrón de "estado vacío"):

```typescript
export type Mandato = {
  id: string;
  cliente_nombre: string;
  operacion: string | null;
  tipo: string | null;
  zonas: string[];
  precio_max: number | null;
  habitaciones: number | null;
  area_min: number | null;
  exigencias: string[];
  estado: string;
  created_at: string;
};

export type MatchPendiente = {
  id: string;
  mandato_id: string;
  ally_property_id: string;
  puntaje: number | null;
  error: string | null;
  escalado_a: string | null;
  created_at: string;
};

function pesos(n: number | null) {
  return n ? `$${n.toLocaleString("es-CO")}` : null;
}

export function MandatosPanel({ mandatos }: { mandatos: Mandato[] }) {
  if (mandatos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Todavía no hay mandatos de compra cargados. Reenviale a Sofi el pedido de un
        cliente comprador para que empiece a cruzarlo contra lo que publican los colegas.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {mandatos.map((m) => (
        <div key={m.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">{m.cliente_nombre}</p>
            <span className="text-xs text-slate-400">
              {m.operacion || "?"} · {m.tipo || "?"}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            {[
              pesos(m.precio_max) ? `hasta ${pesos(m.precio_max)}` : null,
              m.habitaciones ? `${m.habitaciones} hab` : null,
              m.area_min ? `${m.area_min} m² min` : null,
              m.zonas?.length ? m.zonas.join(", ") : null,
            ].filter(Boolean).join(" · ") || "sin más detalle"}
          </p>
          {m.exigencias?.length > 0 && (
            <p className="mt-1 text-xs text-slate-400">Debe tener: {m.exigencias.join(", ")}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function MatchesPendientesPanel({ matches }: { matches: MatchPendiente[] }) {
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        Ningún match sin entregar. Cuando un aviso no se pueda mandar al asesor
        (ventana cerrada y plantilla fallida, o número inválido) aparece acá.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {matches.map((m) => (
        <div key={m.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="text-slate-800">
            Mandato <code className="text-xs">{m.mandato_id.slice(0, 8)}</code> · Oferta{" "}
            <code className="text-xs">{m.ally_property_id.slice(0, 8)}</code>
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {m.escalado_a
              ? "Escalado a +" + m.escalado_a
              : m.error
                ? "Sin entregar: " + m.error
                : "Sin entregar todavía"}
          </p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Insertar las dos secciones en `page.tsx`, después de "Propiedades de colegas" y antes del cierre del `<div>` raíz**

```tsx
      <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Mis mandatos de compra</h2>
      <p className="mb-2 text-sm text-slate-500">
        Clientes tuyos que están buscando. Cada oferta que un colega publique y le sirva
        a alguno se te avisa por WhatsApp — no hace falta revisar esta lista para que funcione.
      </p>
      {mandatosRes.hasError && <ErrorBanner message={mandatosRes.message} />}
      <MandatosPanel mandatos={mandatos} />

      {admin && (
        <>
          <h2 className="mb-1 mt-8 text-lg font-semibold text-slate-900">Matches sin entregar</h2>
          <p className="mb-2 text-sm text-slate-500">
            Avisos que no se le pudieron mandar al asesor dueño del mandato. Ninguno debería
            quedar acá mucho tiempo — si algo se acumula, hay un problema de entrega que resolver.
          </p>
          {matchesPendientesRes.hasError && <ErrorBanner message={matchesPendientesRes.message} />}
          <MatchesPendientesPanel matches={matchesPendientes} />
        </>
      )}
```

Agregar el import junto a los otros imports de componentes de la página:
```typescript
import { MandatosPanel, MatchesPendientesPanel } from "@/components/mandatos-panel";
```

"Matches sin entregar" queda **solo para admin** (mismo patrón que "Posibles ventas",
"Inbox de la línea vinculada", "Escucha en vivo" en esta misma página) — es
información de supervisión del sistema completo, no del mandato de un asesor
puntual. "Mis mandatos de compra" es visible para cualquiera con `miAdvisorId`
(ya filtrado por `mias()`) o para admin (que ve todos).

- [ ] **Step 5: Verificar que compila**

Run: `cd crm && npx tsc --noEmit`
Expected: sin errores nuevos. Si hay errores preexistentes en el proyecto que no
tienen que ver con estos dos archivos, anotalos pero no los arregles — están fuera
del alcance de esta tarea.

Run: `cd crm && npm run build`
Expected: build exitoso.

- [ ] **Step 6: Commit**

```bash
git add "crm/app/(dashboard)/grupos/page.tsx" crm/components/mandatos-panel.tsx
git commit -m "feat(crm): mostrar mandatos de compra y matches sin entregar en el panel del radar"
```

---

### Task 9: Variables, documentación y cierre

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (sección 2, migraciones pendientes)
- Modify: `docs/radar-vivo.md`

- [ ] **Step 1: Agregar las variables a `.env.example`**

```bash
# ── Radar: carril de COMPRA (mandatos) ────────────────────────────────────────
# Margen sobre el tope de precio de un mandato que todavia se considera "se
# acerca". 0.15 = hasta 15% arriba. Mas que eso no se avisa.
RADAR_MANDATO_MARGEN_PRECIO=0.15
# Tope de avisos por mandato por dia. 0 = sin limite (default de producto: un
# tope que descarta matches buenos deja plata sobre la mesa). Se pone un numero
# solo si el asesor se ahoga.
RADAR_MANDATO_MAX_DIA=0
# Plantilla aprobada en Meta para entrar cuando la ventana de 24h esta cerrada.
RADAR_MANDATO_TEMPLATE=radar_match_mandato
# A quien se le escala un match que NO se pudo entregar al dueño del mandato.
# Cae a RADAR_REVISOR_PHONE si esta vacia.
RADAR_ESCALADO_PHONE=
```

- [ ] **Step 2: Actualizar `CLAUDE.md`**

En "Migraciones pendientes de correr en Supabase", agregar
`db/migrations/2026-08-25_mandatos_compra.sql` con una línea explicando que sin ella
el carril de compra queda inerte (el código degrada limpio: `listarActivos` devuelve
vacío y no se avisa nada, en vez de romper).

- [ ] **Step 3: Documentar el carril de compra en `docs/radar-vivo.md`**

Agregar una sección "Los dos carriles" con el diagrama del spec §2, y una subsección
operativa: cómo carga Natalia un mandato (le reenvía el brief a Sofi por WhatsApp),
qué recibe, y qué hacer cuando un match queda pendiente.

- [ ] **Step 4: Suite completa y verificación final**

Run: `npm test`
Expected: PASS — toda la suite, incluidos los 5 archivos nuevos de test

**RIESGO REAL, leer antes de correr esto.** `src/server.js` llama a `app.listen(...)`
SIN ninguna guarda de `require.main === module` — requerir el archivo siempre lo
arranca. Y dentro del callback de `listen`, cada scheduler
(`reminders`, `followups`, `group-digest`, `radar-watchdog`, `radar-recordatorio`,
`visitas-venta`) se enciende con `if (config.supabaseUrl) ...start()` —
`config.supabaseUrl` lee `process.env.SUPABASE_URL` DIRECTO, sin pasar por el guard
de `NODE_TEST_CONTEXT` de `src/data/supabase.js`. El `.env` de esta máquina tiene
credenciales REALES de producción. Sin cuidado, este chequeo puede terminar
disparando un scheduler real (por ejemplo, `radar-recordatorio` podría mandarle un
WhatsApp real a una asesora).

Por eso el comando SÍ lleva `NODE_TEST_CONTEXT=1`: eso hace que
`src/data/supabase.js` exporte `client = null` (ver su guard, es independiente de
si `SUPABASE_URL` está seteada), así que aunque los schedulers arranquen, cada
módulo de datos que llamen cae a su rama de memoria y no toca la red. El objetivo
de este paso es solo confirmar que la cadena de `require` no tiene un módulo roto
o un ciclo — nada más.

Run (con el flag, y matándolo apenas confirmes la línea de arranque en el log):

```bash
NODE_TEST_CONTEXT=1 timeout 5 node -e "require('./src/server.js')" 2>&1 | head -20
```

Si no tenés `timeout` disponible en tu shell, corré `NODE_TEST_CONTEXT=1 node -e "require('./src/server.js')"`
en background, esperá la línea `Bot inmobiliario corriendo en puerto...` en el log,
y matalo enseguida por PID (en Windows: `netstat -ano | findstr :3000` y después
`taskkill /PID <pid> /F`). **Nunca corras este chequeo sin `NODE_TEST_CONTEXT=1`.**

- [ ] **Step 5: Commit**

```bash
git add .env.example CLAUDE.md docs/radar-vivo.md
git commit -m "docs(radar): variables y operacion del carril de compra"
```

---

### Task 10: Prueba de extremo a extremo con los 4 mandatos reales (spec §5)

Esta tarea NO escribe código. Es la única prueba que vale: el cruce corriendo contra
datos reales. Se hace **después** de que Juan corra la migración.

**Files:** ninguno. Se ejecuta contra la base de producción, en modo lectura salvo
por los 4 mandatos que se cargan.

- [ ] **Step 1: Cargar los 4 mandatos por el flujo normal**

Natalia le reenvía a Sofi por WhatsApp los 4 briefs (los textos están en la hoja
"Los 4 pedidos" de `scratch/Cruce-compradores-colegas-2026-08-25.xlsx` y en el spec §5).
**No cargarlos por SQL:** el punto de este paso es probar
`registrar_mandato_compra` y la confirmación campo por campo con un humano leyéndola.

Verificar en cada uno que la confirmación de Sofi nombre: presupuesto, habitaciones,
área, zonas y exigencias. Si recorta algo, ese es el bug de la migración
`group_signals_exigencias` repitiéndose y hay que arreglarlo antes de seguir.

- [ ] **Step 2: Cruzar los mandatos contra las 329 ofertas YA capturadas**

```bash
node -e "
require('dotenv').config();
const mandatos = require('./src/data/mandatos');
const { evaluarOferta } = require('./src/groups/cruce-mandatos');
const allyProperties = require('./src/data/ally-properties');
(async () => {
  const org = { id: process.env.SMOKE_ORG_ID };
  const activos = await mandatos.listarActivos(org.id);
  const ofertas = await allyProperties.list(org.id, {});
  let total = 0;
  for (const m of activos) {
    const hits = ofertas.filter((o) => { const e = evaluarOferta(o, m); return e && e.sirve; });
    console.log(\`\${m.cliente_nombre}: \${hits.length} de \${ofertas.length}\`);
    total += hits.length;
  }
  console.log('TOTAL:', total);
})();
"
```

Expected: los cuatro mandatos dan un conteo, y el total queda **en el orden de 12**
(el cruce manual del 2026-08-25 dio 5 + 7 + 0 + 0).

**Este es el semáforo de la implementación.** Si da 0, el motor no está viendo lo que
vio una persona y hay un bug — probablemente en `criterioDeMandato` o en el parseo del
precio de texto. Si da 200, el piso no está cortando y el asesor va a recibir ruido.
En ambos casos, arreglar antes de encender el vivo.

- [ ] **Step 3: Un match real, de punta a punta**

Con `GROUPS_ENABLED=true` y un solo grupo en `modo='sombra'`, esperar a que entre una
oferta que cruce y verificar:
1. Llegó el WhatsApp al teléfono del asesor del mandato.
2. El mensaje trae teléfono del colega o la instrucción de tocar el nombre — nunca un
   LID de 15 dígitos disfrazado de número.
3. Quedó la fila en `mandato_match_alerts` con `entregado = true`.
4. **No se publicó nada en el grupo.** Verificar en el grupo, con los ojos.

- [ ] **Step 4: Reportarle a Juan el resultado con números**

Cuántas ofertas entraron, cuántas cruzaron, cuántos avisos salieron, cuántos quedaron
pendientes. Sin esos cuatro números no se sabe si el piso del 15% está bien puesto, y
ajustarlo a ciegas es peor que dejarlo.

---

## Checklist de cierre (antes de decir que está listo)

- [ ] `npm test` verde, incluida toda la suite de grupos del carril de venta.
- [ ] `cd crm && npm run build` exitoso.
- [ ] Ningún archivo de este plan escribe en un grupo de WhatsApp.
- [ ] Ningún archivo de este plan le manda un mensaje a un colega en el carril de compra.
- [ ] La desviación del Hallazgo 2 (persistir solo si hay match) está confirmada con Juan.
- [ ] Se le entregó a Juan la lista de lo que depende de él: correr la migración,
      crear la plantilla `radar_match_mandato` en Meta, poner `RADAR_ESCALADO_PHONE`,
      levantar WAHA con una línea sacrificable, `GROUPS_ENABLED=true`, y encender los
      15 grupos de la tabla del spec §7.
- [ ] Nada de lo anterior se hizo por él sin avisarle: la línea vinculada y la
      plantilla de Meta tienen consecuencias que solo él puede aceptar.

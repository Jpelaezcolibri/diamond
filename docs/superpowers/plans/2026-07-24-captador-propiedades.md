# Captador de propiedades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcar propiedades del inventario a nombre de un asesor vía Sofi-Comando, avisarle por WhatsApp cuando un cliente muestre interés (con dedup) y transferirle el lead en vez de al asesor de la especialidad.

**Architecture:** Calca el patrón desplegado de propiedades de aliados: columna `captador_id` en `properties` + tabla de dedup `property_owner_alerts` + alerta inmediata construida en `notifications/advisor.js`, armada en `ctx` por `tools.js`/`engine.js` y despachada por `channels/whatsapp.js`. Sofi-Comando gana dos tools (`marcar_propiedad`, `consultar_captador`).

**Tech Stack:** Node.js 22 + `node:test` con `t.mock.method`, Supabase JS, sin dependencias nuevas.

## Global Constraints

- Multi-tenant: toda query filtra por `org_id`; nada hardcodeado de Diamond.
- Código en inglés (identificadores); copy visible en español.
- Commits en español, prefijos `feat:`/`docs:`, uno por milestone.
- No hay `db:push`: la migración se corre a mano en Supabase; documentarla como pendiente en `CLAUDE.md`.
- Best-effort en el bot cliente: si la migración no corrió, try/catch + `console.warn` y el flujo sigue como hoy.
- Cualquier rol puede marcar (decisión de Juan 2026-07-24); asesor inexistente/ambiguo → Sofi vuelve a preguntar.

---

### Task 1: Migración SQL

**Files:**
- Create: `db/migrations/2026-07-24_property_captador.sql`
- Modify: `CLAUDE.md` (lista de migraciones pendientes)

**Interfaces:**
- Produces: columna `properties.captador_id` (uuid → advisors.id) y tabla `property_owner_alerts` con `unique(property_id, lead_id)`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Migracion: captador de propiedades del inventario propio. Ejecutar en el
-- SQL Editor de Supabase.
--
-- captador_id: asesor "dueño" de la propiedad (quien la capto). Se asigna
-- via Sofi-Comando ("marca la propiedad X a nombre de Natalia"). Cuando un
-- cliente muestra interes en la propiedad, el captador recibe un aviso
-- inmediato por WhatsApp y, si el lead se transfiere, se transfiere a el
-- (salvo intencion vender/vehiculos). Referencia advisors(id), no
-- auth.users: el aviso viaja al telefono del asesor y no todos tienen login.
-- El sync de Wasi/DMAP solo actualiza sus propios campos: la asignacion
-- sobrevive a cada sync.
alter table properties add column if not exists captador_id uuid references advisors(id) on delete set null;

-- Dedup + auditoria del aviso de interes: evita mandarle varios WhatsApp al
-- captador si el mismo cliente insiste sobre la misma propiedad. Espejo de
-- ally_property_alerts (migracion 2026-07-22_ally_properties_asesor.sql).
create table if not exists property_owner_alerts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (property_id, lead_id)
);

create index if not exists idx_property_owner_alerts_org on property_owner_alerts(org_id);

-- RLS: solo lectura para el equipo autenticado; escrituras via service_role.
alter table property_owner_alerts enable row level security;

drop policy if exists "team read" on property_owner_alerts;
create policy "team read" on property_owner_alerts for select to authenticated using (true);
```

- [ ] **Step 2: Registrar como pendiente en CLAUDE.md**

En la sección "Migraciones pendientes de correr en Supabase", sumar `db/migrations/2026-07-24_property_captador.sql (captador de propiedades + avisos de interés)`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/2026-07-24_property_captador.sql CLAUDE.md
git commit -m "feat(db): captador de propiedades y tabla de avisos de interes"
```

---

### Task 2: Capa de datos

**Files:**
- Modify: `src/data/advisors.js` (agregar `findById`, `searchByName`)
- Modify: `src/data/properties.js` (agregar `setCaptador`, `listByCaptador`)
- Create: `src/data/property-owner-alerts.js`
- Modify: `src/data/memory.js` (array `propertyOwnerAlerts: []`)

**Interfaces:**
- Produces:
  - `advisors.findById(orgId, id)` → fila de advisors o null
  - `advisors.searchByName(orgId, q)` → array de filas activas cuyo `name` matchea `%q%` (ilike)
  - `properties.setCaptador(orgId, propertyId, advisorId)` → fila actualizada
  - `properties.listByCaptador(orgId, advisorId)` → array de propiedades disponibles
  - `propertyOwnerAlerts.registerAlert(orgId, propertyId, leadId)` → true si es la primera vez (hay que avisar), false si ya existía

- [ ] **Step 1: `src/data/advisors.js` — agregar al final (antes de module.exports)**

```js
// Asesor por id (para resolver el captador de una propiedad).
async function findById(orgId, id) {
  if (!id) return null;
  if (!supabase) {
    return memory.advisors.find((a) => a.org_id === orgId && a.id === id) || null;
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Asesores activos cuyo nombre matchea (para "a nombre de Natalia" en
// Sofi-Comando). Devuelve todos los matches: el consumidor decide si con 0
// vuelve a preguntar y con >1 pide precisar.
async function searchByName(orgId, q) {
  const texto = String(q || "").trim();
  if (!texto) return [];
  if (!supabase) {
    return memory.advisors.filter(
      (a) => a.org_id === orgId && a.activo && a.name.toLowerCase().includes(texto.toLowerCase())
    );
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("activo", true)
    .ilike("name", `%${texto}%`);
  if (error) throw error;
  return data || [];
}
```

Y en `module.exports`: `{ findForTransfer, findByAuthUserId, findById, searchByName }`.

- [ ] **Step 2: `src/data/properties.js` — agregar antes de module.exports**

```js
// Asigna (o reasigna) el asesor captador de una propiedad. advisorId null
// desmarca. Devuelve la fila actualizada.
async function setCaptador(orgId, propertyId, advisorId) {
  if (!supabase) {
    const prop = memory.properties.find((p) => p.org_id === orgId && p.id === propertyId);
    if (!prop) return null;
    prop.captador_id = advisorId;
    return prop;
  }
  const { data, error } = await supabase
    .from("properties")
    .update({ captador_id: advisorId })
    .eq("org_id", orgId)
    .eq("id", propertyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Propiedades disponibles marcadas a nombre de un asesor.
async function listByCaptador(orgId, advisorId, limit = 20) {
  if (!supabase) {
    return memory.properties.filter((p) => p.org_id === orgId && p.captador_id === advisorId && p.disponible);
  }
  const { data, error } = await supabase
    .from("properties")
    .select("ref, titulo, tipo, operacion, precio, zona, ciudad, disponible")
    .eq("org_id", orgId)
    .eq("captador_id", advisorId)
    .eq("disponible", true)
    .limit(limit);
  if (error) throw error;
  return data || [];
}
```

Export: sumar `setCaptador, listByCaptador`.

- [ ] **Step 3: `src/data/memory.js` — sumar `propertyOwnerAlerts: []` al objeto exportado (junto a `allyPropertyAlerts`)**

- [ ] **Step 4: Crear `src/data/property-owner-alerts.js`**

```js
// Dedup del aviso al captador: una fila por (propiedad, lead). Espejo de
// allyProperties.registerAlert (src/data/ally-properties.js).
const supabase = require("./supabase");
const memory = require("./memory");

// true → primera vez, hay que avisar; false → ya se aviso a este captador
// por este cliente y esta propiedad.
async function registerAlert(orgId, propertyId, leadId) {
  if (!supabase) {
    const key = `${propertyId}:${leadId}`;
    if (memory.propertyOwnerAlerts.includes(key)) return false;
    memory.propertyOwnerAlerts.push(key);
    return true;
  }
  const { error } = await supabase
    .from("property_owner_alerts")
    .insert({ property_id: propertyId, lead_id: leadId, org_id: orgId });
  if (error) {
    if (error.code === "23505") return false; // ya existia (violacion del unique)
    throw error;
  }
  return true;
}

module.exports = { registerAlert };
```

- [ ] **Step 5: Smoke rápido de la suite (nada debería romperse)**

Run: `npm test` → Expected: PASS (153 tests).

- [ ] **Step 6: Commit**

```bash
git add src/data/advisors.js src/data/properties.js src/data/memory.js src/data/property-owner-alerts.js
git commit -m "feat(bot): capa de datos del captador (busqueda de asesor, asignacion, dedup de avisos)"
```

---

### Task 3: Alerta de interés al captador (bot cliente) — TDD

**Files:**
- Modify: `src/notifications/advisor.js` (agregar `buildCaptadorInterestAlert`)
- Modify: `src/agent/tools.js` (helper `maybeCaptadorAlert` + hook en `buscar_propiedades`)
- Modify: `src/agent/engine.js` (ctx + hook en property_ref_origen + return)
- Modify: `src/channels/whatsapp.js` (despacho)
- Test: `test/captador-alert.test.js`

**Interfaces:**
- Consumes: `advisors.findById`, `propertyOwnerAlerts.registerAlert` (Task 2).
- Produces: `ctx.captadorAlert = { advisorPhone, advisorAlert } | null`; export `maybeCaptadorAlert(ctx, property)` desde `src/agent/tools.js` (lo usa engine.js); `buildCaptadorInterestAlert(property, lead)` en notifications.

- [ ] **Step 1: Test que falla — `test/captador-alert.test.js`**

```js
// Aviso inmediato al asesor CAPTADOR de una propiedad del inventario propio
// cuando un cliente muestra interes — mismo criterio de mock que
// ally-tool.test.js: los data modules se mockean para no tocar la base real.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool, maybeCaptadorAlert } = require("../src/agent/tools");
const properties = require("../src/data/properties");
const advisors = require("../src/data/advisors");
const propertyOwnerAlerts = require("../src/data/property-owner-alerts");

function baseCtx() {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", nombre: "Carlos", categoria: "otros", estado: "en_conversacion", score: 0 },
    propertyInteres: null,
    transfer: null,
    cita: null,
    allyMatch: null,
    allyAlert: null,
    captadorAlert: null,
    lastUserMessage: "me interesa la ref 10207832",
  };
}

const PROP = Object.freeze({
  id: "prop-1", org_id: "org-1", ref: "10207832", titulo: "Apto en Laureles",
  zona: "Laureles", disponible: true, captador_id: "adv-9", operacion: "Venta",
});

test("interes en propiedad con captador dispara el aviso una sola vez", async (t) => {
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async (orgId, id) => {
    assert.strictEqual(orgId, "org-1");
    assert.strictEqual(id, "adv-9");
    return { id: "adv-9", name: "Natalia", phone: "573009998877", activo: true };
  });
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, PROP);
  assert.ok(ctx.captadorAlert);
  assert.strictEqual(ctx.captadorAlert.advisorPhone, "573009998877");
  assert.match(ctx.captadorAlert.advisorAlert, /10207832/);
  assert.match(ctx.captadorAlert.advisorAlert, /Carlos/);
});

test("si ya se aviso por este cliente y propiedad, no vuelve a avisar", async (t) => {
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => false);
  const findById = t.mock.method(advisors, "findById", async () => ({ id: "adv-9", phone: "573009998877", activo: true }));
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, PROP);
  assert.strictEqual(ctx.captadorAlert, null);
  assert.strictEqual(findById.mock.calls.length, 0);
});

test("propiedad sin captador no genera aviso", async (t) => {
  const register = t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, { ...PROP, captador_id: null });
  assert.strictEqual(ctx.captadorAlert, null);
  assert.strictEqual(register.mock.calls.length, 0);
});

test("captador inactivo no recibe aviso", async (t) => {
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-9", phone: "573009998877", activo: false }));
  const ctx = baseCtx();
  await maybeCaptadorAlert(ctx, PROP);
  assert.strictEqual(ctx.captadorAlert, null);
});

test("buscar_propiedades con ref marcada arma el aviso en el ctx", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP }));
  t.mock.method(propertyOwnerAlerts, "registerAlert", async () => true);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-9", name: "Natalia", phone: "573009998877", activo: true }));
  const ctx = baseCtx();
  await executeTool("buscar_propiedades", { ref: "10207832" }, ctx);
  assert.ok(ctx.captadorAlert);
  assert.strictEqual(ctx.propertyInteres.ref, "10207832");
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `node --test test/captador-alert.test.js` → Expected: FAIL (`maybeCaptadorAlert` no exportado).

- [ ] **Step 3: Implementar**

`src/notifications/advisor.js` — agregar antes de `buildAppointmentAlert`:

```js
// Aviso INMEDIATO al asesor CAPTADOR de una propiedad del inventario propio
// cuando un cliente muestra interes en ella — viaja apenas se detecta, sin
// esperar calificacion ni transferencia (dedup en property_owner_alerts).
function buildCaptadorInterestAlert(property, lead) {
  const clienteNombre = lead.nombre || "Un cliente";
  const clienteTelefono = lead.phone ? ` (+${lead.phone})` : "";
  const zona = property.zona ? ` en ${property.zona}` : "";
  return [
    "Cliente interesado en tu propiedad!",
    `${clienteNombre}${clienteTelefono} esta preguntando por la ref ${property.ref} — ${property.titulo}${zona}.`,
    "Sofi lo esta atendiendo; si califica, te lo transfiere directo.",
  ].join("\n");
}
```

Export: sumar `buildCaptadorInterestAlert`.

`src/agent/tools.js`:
- Import: `const propertyOwnerAlerts = require("../data/property-owner-alerts");` y sumar `buildCaptadorInterestAlert` al require de notifications.
- Helper (antes de `executeTool`):

```js
// Si la propiedad de interes tiene captador, arma el aviso inmediato para su
// asesor (una sola vez por lead+propiedad). Best-effort: si la migracion del
// captador no corrio, el bot sigue sin aviso. Lo llama buscar_propiedades y
// tambien engine.js cuando el lead entra por un ad (property_ref_origen).
async function maybeCaptadorAlert(ctx, property) {
  if (!property || !property.captador_id || ctx.captadorAlert) return;
  try {
    const esNuevo = await propertyOwnerAlerts.registerAlert(ctx.org.id, property.id, ctx.lead.id);
    if (!esNuevo) return;
    const advisor = await advisors.findById(ctx.org.id, property.captador_id);
    if (!advisor || advisor.activo === false) return;
    ctx.captadorAlert = { advisorPhone: advisor.phone, advisorAlert: buildCaptadorInterestAlert(property, ctx.lead) };
  } catch (e) {
    console.warn("[tools] No se pudo generar el aviso al captador (revisar migracion property_captador):", e.message);
  }
}
```

- En `buscar_propiedades`, tras `if (disponibles.length > 0 && !ctx.propertyInteres) ctx.propertyInteres = disponibles[0];` agregar: `if (disponibles.length > 0) await maybeCaptadorAlert(ctx, disponibles[0]);`
- Export: `module.exports = { TOOL_DEFINITIONS, executeTool, maybeCaptadorAlert };` (respetando lo ya exportado).

`src/agent/engine.js`:
- ctx (línea ~103): sumar `captadorAlert: null`.
- Tras `if (origen?.disponible) ctx.propertyInteres = origen;` agregar `if (origen?.disponible) await maybeCaptadorAlert(ctx, origen);` (importar `maybeCaptadorAlert` del require de tools).
- Return (línea ~235): sumar `captadorAlert: ctx.captadorAlert || null`.

`src/channels/whatsapp.js`:
- Destructurar `captadorAlert` de `procesarMensaje` y despachar igual que `allyAlert`:

```js
if (captadorAlert) {
  await sendWhatsApp(org, captadorAlert.advisorPhone, captadorAlert.advisorAlert, { fromPhoneId: phoneNumberId });
}
```

- [ ] **Step 4: Verde + suite completa**

Run: `node --test test/captador-alert.test.js` → PASS. Luego `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/advisor.js src/agent/tools.js src/agent/engine.js src/channels/whatsapp.js test/captador-alert.test.js
git commit -m "feat(bot): aviso inmediato al captador cuando un cliente muestra interes"
```

---

### Task 4: Transferencia al captador — TDD

**Files:**
- Modify: `src/agent/tools.js:321` (`transferir_a_asesor`)
- Test: `test/captador-transfer.test.js`

**Interfaces:**
- Consumes: `advisors.findById` (Task 2), `ctx.propertyInteres.captador_id`.
- Produces: `ctx.transfer.advisor` = captador cuando aplica; `ctx.transfer.especialidad` queda como hoy (la etiqueta de especialidad no cambia).

- [ ] **Step 1: Test que falla — `test/captador-transfer.test.js`**

```js
// La transferencia va al CAPTADOR de la propiedad de interes, salvo
// intencion vender/vehiculos. Mismo criterio de mock que ally-tool.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeTool } = require("../src/agent/tools");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");

function baseCtx(extra = {}) {
  return {
    org: { id: "org-1", name: "Diamond" },
    lead: { id: "lead-1", phone: "573001112233", categoria: "compra", estado: "calificado", score: 80 },
    propertyInteres: { id: "prop-1", ref: "10207832", operacion: "Venta", captador_id: "adv-9", link: "https://x/p" },
    transfer: null, cita: null, allyMatch: null, allyAlert: null, captadorAlert: null,
    lastUserMessage: "quiero hablar con un asesor",
    ...extra,
  };
}

const NATALIA = { id: "adv-9", name: "Natalia", phone: "573009998877", especialidad: "venta", activo: true };
const GENERICO = { id: "adv-1", name: "Asesor Ventas", phone: "573000000001", especialidad: "venta", activo: true };

test("con propiedad marcada, transfiere al captador", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(advisors, "findById", async () => NATALIA);
  const forTransfer = t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx();
  await executeTool("transferir_a_asesor", { motivo: "calificado" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-9");
  assert.strictEqual(forTransfer.mock.calls.length, 0);
});

test("intencion vender ignora al captador", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  const findById = t.mock.method(advisors, "findById", async () => NATALIA);
  t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx({ lead: { id: "lead-1", phone: "573001112233", categoria: "otros", intencion: "vender", estado: "calificado", score: 80 } });
  await executeTool("transferir_a_asesor", { motivo: "quiere vender" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-1");
  assert.strictEqual(findById.mock.calls.length, 0);
});

test("sin captador usa el flujo por especialidad", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx({ propertyInteres: { id: "prop-2", ref: "111", operacion: "Venta", captador_id: null } });
  await executeTool("transferir_a_asesor", { motivo: "calificado" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-1");
});

test("captador inactivo cae al flujo por especialidad", async (t) => {
  t.mock.method(leads, "update", async (id, patch) => patch);
  t.mock.method(advisors, "findById", async () => ({ ...NATALIA, activo: false }));
  t.mock.method(advisors, "findForTransfer", async () => GENERICO);
  const ctx = baseCtx();
  await executeTool("transferir_a_asesor", { motivo: "calificado" }, ctx);
  assert.strictEqual(ctx.transfer.advisor.id, "adv-1");
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `node --test test/captador-transfer.test.js` → Expected: FAIL en el primer test (hoy siempre usa `findForTransfer`).

- [ ] **Step 3: Implementar en `transferir_a_asesor`**

Reemplazar `const advisor = await advisors.findForTransfer(ctx.org, especialidad);` por:

```js
    // La propiedad de interes con captador manda: el negocio es del asesor
    // que la capto — salvo vendedores y vehiculos, que siguen su flujo.
    let advisor = null;
    const sigueFlujoEspecial = intencion === "vender" || intencion === "vehiculos" || especialidad === "vehiculos";
    if (!sigueFlujoEspecial && ctx.propertyInteres?.captador_id) {
      try {
        const captador = await advisors.findById(ctx.org.id, ctx.propertyInteres.captador_id);
        if (captador && captador.activo !== false) advisor = captador;
      } catch (e) {
        console.warn("[tools] No se pudo resolver el captador para transferir (revisar migracion property_captador):", e.message);
      }
    }
    if (!advisor) advisor = await advisors.findForTransfer(ctx.org, especialidad);
```

- [ ] **Step 4: Verde + suite completa**

Run: `node --test test/captador-transfer.test.js` → PASS. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.js test/captador-transfer.test.js
git commit -m "feat(bot): la transferencia respeta al captador de la propiedad de interes"
```

---

### Task 5: Tools de Sofi-Comando (`marcar_propiedad`, `consultar_captador`) — TDD

**Files:**
- Modify: `src/agent/sofi-comando-tools.js` (definiciones + casos)
- Modify: `src/agent/sofi-comando-prompts.js` (bloque CAPTADOR)
- Test: `test/command-marcar-propiedad.test.js`

**Interfaces:**
- Consumes: `properties.findByRef(scope.orgId, ref)`, `properties.setCaptador`, `properties.listByCaptador`, `advisors.searchByName`, `advisors.findById` (Task 2).
- Produces: tools `marcar_propiedad {ref, asesor}` y `consultar_captador {ref?, asesor?}` en `COMMAND_TOOL_DEFINITIONS`/`executeCommandTool`.

- [ ] **Step 1: Test que falla — `test/command-marcar-propiedad.test.js`**

```js
// Marcar propiedades a nombre de un asesor via Sofi-Comando. Cualquier rol
// puede marcar (decision 2026-07-24). Mismo criterio de mock que
// command-recordatorios-tool.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const properties = require("../src/data/properties");
const advisors = require("../src/data/advisors");

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "uid-asesor-1", role: "asesor_ventas", isAdmin: false });
}

const PROP = { id: "prop-1", ref: "10207832", titulo: "Apto en Laureles", zona: "Laureles", captador_id: null };
const NATALIA = { id: "adv-9", name: "Natalia Velez", phone: "573009998877", activo: true };

test("marcar_propiedad: cualquier rol marca y confirma con nombre y ref", async (t) => {
  t.mock.method(properties, "findByRef", async (orgId, ref) => {
    assert.strictEqual(orgId, "org-1");
    assert.strictEqual(ref, "10207832");
    return { ...PROP };
  });
  t.mock.method(advisors, "searchByName", async () => [NATALIA]);
  const set = t.mock.method(properties, "setCaptador", async (orgId, propertyId, advisorId) => {
    assert.strictEqual(propertyId, "prop-1");
    assert.strictEqual(advisorId, "adv-9");
    return { ...PROP, captador_id: "adv-9" };
  });
  const out = await executeCommandTool("marcar_propiedad", { ref: "10207832", asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 1);
  assert.match(out, /Natalia Velez/);
  assert.match(out, /10207832/);
});

test("marcar_propiedad: ref inexistente no marca nada", async (t) => {
  t.mock.method(properties, "findByRef", async () => null);
  const set = t.mock.method(properties, "setCaptador", async () => null);
  const out = await executeCommandTool("marcar_propiedad", { ref: "999", asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 0);
  assert.match(out, /No encontre la referencia 999/);
});

test("marcar_propiedad: asesor inexistente vuelve a preguntar", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP }));
  t.mock.method(advisors, "searchByName", async () => []);
  const set = t.mock.method(properties, "setCaptador", async () => null);
  const out = await executeCommandTool("marcar_propiedad", { ref: "10207832", asesor: "Karolina" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 0);
  assert.match(out, /No encontre ningun asesor/);
});

test("marcar_propiedad: nombre ambiguo pide precisar sin marcar", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP }));
  t.mock.method(advisors, "searchByName", async () => [NATALIA, { id: "adv-10", name: "Natalia Gomez", phone: "5730011", activo: true }]);
  const set = t.mock.method(properties, "setCaptador", async () => null);
  const out = await executeCommandTool("marcar_propiedad", { ref: "10207832", asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.strictEqual(set.mock.calls.length, 0);
  assert.match(out, /Natalia Velez/);
  assert.match(out, /Natalia Gomez/);
});

test("marcar_propiedad: reasignar menciona al captador anterior", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP, captador_id: "adv-1" }));
  t.mock.method(advisors, "searchByName", async () => [NATALIA]);
  t.mock.method(advisors, "findById", async () => ({ id: "adv-1", name: "Pedro Ruiz", activo: true }));
  t.mock.method(properties, "setCaptador", async () => ({ ...PROP, captador_id: "adv-9" }));
  const out = await executeCommandTool("marcar_propiedad", { ref: "10207832", asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.match(out, /Pedro Ruiz/);
});

test("consultar_captador por ref responde el dueño", async (t) => {
  t.mock.method(properties, "findByRef", async () => ({ ...PROP, captador_id: "adv-9" }));
  t.mock.method(advisors, "findById", async () => NATALIA);
  const out = await executeCommandTool("consultar_captador", { ref: "10207832" }, { scope: asesorScope(), session: null });
  assert.match(out, /Natalia Velez/);
});

test("consultar_captador por asesor lista sus propiedades", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [NATALIA]);
  t.mock.method(properties, "listByCaptador", async (orgId, advisorId) => {
    assert.strictEqual(advisorId, "adv-9");
    return [{ ref: "10207832", titulo: "Apto en Laureles", zona: "Laureles" }];
  });
  const out = await executeCommandTool("consultar_captador", { asesor: "Natalia" }, { scope: asesorScope(), session: null });
  assert.match(out, /10207832/);
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `node --test test/command-marcar-propiedad.test.js` → Expected: FAIL ("Herramienta desconocida").

- [ ] **Step 3: Implementar**

`src/agent/sofi-comando-tools.js` — imports: sumar `const advisors = require("../data/advisors");`.

Definiciones (sumar a `COMMAND_TOOL_DEFINITIONS`):

```js
  {
    name: "marcar_propiedad",
    description:
      "Marca una propiedad del inventario propio a nombre de un asesor (su captador). Desde ese momento, cuando un cliente muestre interes en esa propiedad, el captador recibe el aviso y el lead se le transfiere a el. Usala cuando digan 'marca la propiedad X a nombre de Y' o 'esa propiedad es de Y'. Cualquier miembro del equipo puede marcar.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia de la propiedad (codigo Wasi), ej 10207832" },
        asesor: { type: "string", description: "Nombre (o parte del nombre) del asesor captador, ej Natalia" },
      },
      required: ["ref", "asesor"],
    },
  },
  {
    name: "consultar_captador",
    description:
      "Consulta quien es el captador de una propiedad (por ref) o que propiedades tiene marcadas un asesor (por nombre). Usala para '¿de quien es la ref X?' o '¿que propiedades tiene Natalia?'.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia de la propiedad" },
        asesor: { type: "string", description: "Nombre del asesor" },
      },
    },
  },
```

Casos en `executeCommandTool` (antes del `default`):

```js
    case "marcar_propiedad": {
      const prop = await properties.findByRef(scope.orgId, input?.ref || "");
      if (!prop) {
        return `No encontre la referencia ${input?.ref} en el inventario. Verifica el codigo con el asesor o buscala con buscar_inventario.`;
      }
      const matches = await advisors.searchByName(scope.orgId, input?.asesor || "");
      if (matches.length === 0) {
        return `No encontre ningun asesor que coincida con "${input?.asesor}" en el equipo — no marque nada. Pregunta de nuevo el nombre (puede estar escrito distinto o no estar registrado en advisors).`;
      }
      if (matches.length > 1) {
        const lista = matches.map((a) => a.name).join(", ");
        return `Hay ${matches.length} asesores que coinciden (${lista}) — pregunta cual es antes de marcar. No marque nada.`;
      }
      const nuevo = matches[0];
      let anterior = null;
      if (prop.captador_id && prop.captador_id !== nuevo.id) {
        try {
          anterior = await advisors.findById(scope.orgId, prop.captador_id);
        } catch { /* la mencion del anterior es informativa, no bloquea */ }
      }
      await properties.setCaptador(scope.orgId, prop.id, nuevo.id);
      const reemplazo = anterior ? ` (reemplaza a ${anterior.name})` : "";
      return `Listo: la propiedad ${prop.ref} — ${prop.titulo} quedo marcada a nombre de ${nuevo.name}${reemplazo}. Cuando un cliente muestre interes, le avisamos y el lead se le transfiere.`;
    }
    case "consultar_captador": {
      if (input?.ref) {
        const prop = await properties.findByRef(scope.orgId, input.ref);
        if (!prop) return `No encontre la referencia ${input.ref} en el inventario.`;
        if (!prop.captador_id) return `La propiedad ${prop.ref} — ${prop.titulo} no tiene captador asignado.`;
        const owner = await advisors.findById(scope.orgId, prop.captador_id);
        return owner
          ? `La propiedad ${prop.ref} — ${prop.titulo} esta marcada a nombre de ${owner.name}.`
          : `La propiedad ${prop.ref} tiene un captador asignado pero no encontre su ficha de asesor (pudo ser eliminado).`;
      }
      if (input?.asesor) {
        const matches = await advisors.searchByName(scope.orgId, input.asesor);
        if (matches.length === 0) return `No encontre ningun asesor que coincida con "${input.asesor}".`;
        if (matches.length > 1) {
          return `Hay ${matches.length} asesores que coinciden (${matches.map((a) => a.name).join(", ")}) — pregunta cual.`;
        }
        const props = await properties.listByCaptador(scope.orgId, matches[0].id);
        if (props.length === 0) return `${matches[0].name} no tiene propiedades marcadas a su nombre.`;
        return `Propiedades de ${matches[0].name}:\n` + JSON.stringify(props, null, 2);
      }
      return "Dime la referencia de la propiedad o el nombre del asesor que quieres consultar.";
    }
```

`src/agent/sofi-comando-prompts.js` — sumar a HERRAMIENTAS:

```
- marcar_propiedad / consultar_captador: asigna una propiedad del inventario a su asesor captador y consulta esas asignaciones.
```

Y bloque nuevo (después de RED DE ALIADOS PROPIA):

```
CAPTADOR DE PROPIEDADES (marcar_propiedad / consultar_captador):
- Cuando digan "marca la propiedad X a nombre de Y", usa marcar_propiedad. Cualquier miembro del equipo puede marcar o reasignar.
- Si el asesor no existe o hay varios con ese nombre, NO marques: vuelve a preguntar el nombre exacto y ofrece los candidatos si los hay.
- El captador recibe un WhatsApp cuando un cliente muestra interes en su propiedad, y el lead calificado se le transfiere a el (salvo vendedores y vehiculos, que siguen su flujo).
```

- [ ] **Step 4: Verde + suite completa**

Run: `node --test test/command-marcar-propiedad.test.js` → PASS. `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/sofi-comando-tools.js src/agent/sofi-comando-prompts.js test/command-marcar-propiedad.test.js
git commit -m "feat(bot): Sofi-Comando marca propiedades a nombre de un asesor captador"
```

---

### Task 6: Verificación end-to-end

- [ ] Juan corre `db/migrations/2026-07-24_property_captador.sql` en el SQL Editor de Supabase.
- [ ] Reiniciar el bot local (matar por puerto 3003 con `netstat -ano | grep ":3003"` → `taskkill //F //PID <pid>`; `npm run dev`).
- [ ] En el CRM (localhost:3100), decirle a Sofi: "marca la propiedad <ref real> a nombre de <asesor real>" → confirma nombre y ref.
- [ ] "¿de quién es la ref <ref>?" → responde el captador.
- [ ] Probar nombre inexistente → Sofi vuelve a preguntar sin marcar.
- [ ] (Producción) Cliente pregunta por la ref marcada por WhatsApp → el captador recibe el aviso; segunda insistencia no re-avisa.

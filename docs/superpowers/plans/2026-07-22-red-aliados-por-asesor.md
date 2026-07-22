# Red de aliados por asesor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un asesor registre desde Sofi-Comando la propiedad de un colega de otra inmobiliaria, y que cuando un cliente por WhatsApp pregunte por algo similar, se le avise de inmediato al asesor dueño de ese contacto (no al de la especialidad) para que valide disponibilidad — sin revelarle nunca al cliente datos del colega ni precisos de esa propiedad.

**Architecture:** Se agrega una columna `registrado_por` a `ally_properties` (quién la registró) y una tabla `ally_property_alerts` (dedup + auditoría de avisos). Una tool nueva en Sofi-Comando (`registrar_propiedad_colega`) escribe con `registrado_por = scope.viewerUid`. En el bot público, cuando `buscar_propiedades` hace match de aliado con dueño conocido, se dispara un aviso de WhatsApp inmediato y aislado (`allyAlert`, independiente de `transfer`) al celular de ese asesor.

**Tech Stack:** Node.js 20 + CommonJS (bot), `node:test` + `node:assert`, Supabase Postgres, Anthropic SDK (tool use).

## Global Constraints

- Sin TypeScript en el bot: JS plano con CommonJS (todo el código de `src/`).
- Después de tocar `prompts.js`/`tools.js`/`engine.js`/`sofi-comando-*.js`, correr `npm test` antes de commitear.
- El cliente NUNCA debe ver precio, referencia, ni ningún dato del colega (nombre, teléfono, inmobiliaria) — solo se le puede reflejar la zona que él mismo pidió.
- `registrar_propiedad_colega` solo existe en las tools de Sofi-Comando (requiere sesión autenticada del CRM) — el bot público de WhatsApp nunca la expone.
- No se relaja RLS existente en `ally_properties`; la tabla nueva (`ally_property_alerts`) sigue el mismo patrón (solo lectura para `authenticated`, escritura vía `service_role`).
- Sigue el patrón de tests ya existente en el repo: los módulos de `src/data/*` que tocan Supabase real (`create`, `search`, `update`, `findForTransfer`) NO se testean directamente (el `.env` de este repo apunta a producción) — se cubren indirectamente mockeando esos métodos desde los tests de quien los consume (`tools.js`, `sofi-comando-tools.js`). Los constructores de texto puros (`src/notifications/advisor.js`) SÍ se testean directamente.

---

### Task 1: Migración SQL

**Files:**
- Create: `db/migrations/2026-07-22_ally_properties_asesor.sql`

**Interfaces:**
- Produces: columna `ally_properties.registrado_por` (uuid, nullable) y tabla `ally_property_alerts(id, ally_property_id, lead_id, org_id, created_at)` con `unique(ally_property_id, lead_id)`. Usadas por las Tasks 3 y 5.

- [ ] **Step 1: Escribir la migración**

```sql
-- Migracion: propiedades de aliados con dueno (asesor que las registro) +
-- dedup de avisos inmediatos al cliente. Ejecutar en Supabase SQL Editor.
--
-- registrado_por: el asesor (login del CRM) que registro la propiedad del
-- colega desde Sofi-Comando. Nullable: las filas del flujo viejo (colega
-- escribiendole directo al bot publico) quedan sin dueno y siguen el
-- comportamiento actual (nota en la alerta de transferencia, asesor de la
-- especialidad) — no se migran datos existentes.
alter table ally_properties add column if not exists registrado_por uuid references auth.users(id) on delete set null;

-- Dedup + auditoria: evita mandarle varios WhatsApp al mismo asesor si el
-- mismo cliente insiste varias veces en la conversacion sobre el mismo match.
create table if not exists ally_property_alerts (
  id uuid primary key default gen_random_uuid(),
  ally_property_id uuid not null references ally_properties(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (ally_property_id, lead_id)
);

create index if not exists idx_ally_property_alerts_org on ally_property_alerts(org_id);

-- RLS: mismo patron que ally_properties — solo lectura para el equipo
-- autenticado; las escrituras (bot) pasan por el service_role.
alter table ally_property_alerts enable row level security;

drop policy if exists "team read" on ally_property_alerts;
create policy "team read" on ally_property_alerts for select to authenticated using (true);
```

- [ ] **Step 2: Verificar sintaxis localmente (sin aplicar a produccion)**

Run: `node -e "require('fs').readFileSync('db/migrations/2026-07-22_ally_properties_asesor.sql','utf8')"`
Expected: no output, exit code 0 (el archivo existe y es legible; la validacion real de sintaxis SQL ocurre al pegarlo en Supabase).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/2026-07-22_ally_properties_asesor.sql
git commit -m "feat(db): migracion registrado_por en ally_properties + tabla ally_property_alerts"
```

**Nota para Juan:** esta migración se ejecuta manualmente en el SQL Editor de Supabase (mismo flujo que las anteriores en `db/migrations/`) — no hay `db:push` automático en este repo. Ejecutarla antes de desplegar la Task 5 en adelante, o el bot seguirá funcionando igual que hoy (con `registrado_por` ausente, cae al comportamiento actual) hasta que se aplique.

---

### Task 2: Constructor del aviso inmediato al asesor (`buildAllyClientMatchAlert`)

**Files:**
- Modify: `src/notifications/advisor.js`
- Test: `test/advisor.test.js`

**Interfaces:**
- Produces: `buildAllyClientMatchAlert(allyProperty, lead) → string`. Usada por Task 5 (`src/agent/tools.js`).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/advisor.test.js` (y ajustar el `require` de la primera línea para incluir la función nueva):

```js
const { buildClientLink, buildAdvisorAlert, buildAllyClientMatchAlert } = require("../src/notifications/advisor");
```

```js
// --- buildAllyClientMatchAlert ---

test("buildAllyClientMatchAlert: incluye colega, propiedad y quien pregunto", () => {
  const allyProperty = {
    tipo: "Apartamento",
    zona: "Laureles",
    precio: "$1.800.000",
    ref: "10128030",
    contacto_nombre: "Andrea Restrepo",
    inmobiliaria_origen: "Century21",
  };
  const lead = { nombre: "Marta Gomez", phone: "573001112233" };
  const alert = buildAllyClientMatchAlert(allyProperty, lead);
  assert.match(alert, /Andrea Restrepo/);
  assert.match(alert, /Century21/);
  assert.match(alert, /Laureles/);
  assert.match(alert, /Marta Gomez/);
  assert.match(alert, /573001112233/);
  assert.match(alert, /[Vv]alida disponibilidad/);
});

test("buildAllyClientMatchAlert: campos opcionales ausentes no rompen el mensaje", () => {
  const allyProperty = { contacto_nombre: "Andrea" };
  const lead = { phone: "573001112233" };
  const alert = buildAllyClientMatchAlert(allyProperty, lead);
  assert.match(alert, /Andrea/);
  assert.match(alert, /Un cliente/);
  assert.doesNotMatch(alert, /undefined/);
  assert.doesNotMatch(alert, /null/);
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npm test`
Expected: FAIL — `buildAllyClientMatchAlert is not a function` (no está exportada todavía).

- [ ] **Step 3: Implementar la función**

En `src/notifications/advisor.js`, agregar (antes de `module.exports`, después de `formatAllyMatch`):

```js
// Aviso INMEDIATO al asesor DUENO de una propiedad de colega cuando un cliente
// pregunta por algo similar — a diferencia de formatAllyMatch (nota dentro de
// la alerta de transferencia), este mensaje viaja solo, apenas se detecta el
// match, sin esperar a que el cliente califique o se transfiera.
function buildAllyClientMatchAlert(allyProperty, lead) {
  const tipo = allyProperty.tipo || "propiedad";
  const zona = allyProperty.zona ? ` en ${allyProperty.zona}` : "";
  const precio = allyProperty.precio ? `, ${allyProperty.precio}` : "";
  const ref = allyProperty.ref ? ` (ref ${allyProperty.ref})` : "";
  const contacto = allyProperty.contacto_nombre || "tu colega";
  const inmobiliaria = allyProperty.inmobiliaria_origen ? ` de ${allyProperty.inmobiliaria_origen}` : "";
  const clienteNombre = lead.nombre || "Un cliente";
  const clienteTelefono = lead.phone ? ` (+${lead.phone})` : "";
  return [
    "Match con la red de aliados!",
    `${clienteNombre}${clienteTelefono} pregunto por algo similar a la ${tipo}${zona}${precio}${ref} que te comparte ${contacto}${inmobiliaria}.`,
    "Valida disponibilidad con tu colega antes de confirmarle al cliente.",
  ].join("\n");
}
```

Y actualizar el `module.exports` final:

```js
module.exports = { buildClientLink, buildAdvisorAlert, buildAllyClientMatchAlert };
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm test`
Expected: PASS (todos, incluidos los 2 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/notifications/advisor.js test/advisor.test.js
git commit -m "feat(bot): aviso inmediato al asesor dueno de un match de aliado"
```

---

### Task 3: `registrado_por` + dedup en la capa de datos (`ally-properties.js`)

**Files:**
- Modify: `src/data/ally-properties.js`
- Modify: `src/data/memory.js`

**Interfaces:**
- Consumes: nada nuevo (mismo `supabase`/`memory` de siempre).
- Produces: `create(orgId, fields)` ahora persiste `fields.registrado_por`. `registerAlert(orgId, allyPropertyId, leadId) → Promise<boolean>` (true = primer aviso, false = ya se habia avisado). Usadas por Task 5.

- [ ] **Step 1: Agregar el store de alertas en memoria**

En `src/data/memory.js`, dentro del objeto `db` (después de `allyProperties: [],`):

```js
  allyProperties: [],
  allyPropertyAlerts: [],
```

- [ ] **Step 2: Guardar `registrado_por` en `create()`**

En `src/data/ally-properties.js`, dentro de `create()`, agregar el campo al objeto `row` (después de `mensaje_original: fields.mensaje_original || null,`):

```js
    mensaje_original: fields.mensaje_original || null,
    registrado_por: fields.registrado_por || null,
    estado: "pendiente",
```

- [ ] **Step 3: Implementar `registerAlert`**

Agregar antes de `module.exports`:

```js
// Registra que ya se aviso al asesor de un match cliente-aliado para este
// lead (dedup real: unique(ally_property_id, lead_id) en la migracion).
// Devuelve true la PRIMERA vez (aviso nuevo), false si ya se habia notificado.
async function registerAlert(orgId, allyPropertyId, leadId) {
  if (!supabase) {
    const key = `${allyPropertyId}:${leadId}`;
    if (memory.allyPropertyAlerts.includes(key)) return false;
    memory.allyPropertyAlerts.push(key);
    return true;
  }
  const { error } = await supabase
    .from("ally_property_alerts")
    .insert({ ally_property_id: allyPropertyId, lead_id: leadId, org_id: orgId });
  if (error) {
    if (error.code === "23505") return false; // ya existia (violacion del unique)
    throw error;
  }
  return true;
}
```

Y actualizar `module.exports`:

```js
module.exports = { create, search, findById, list, update, matchesFilters, registerAlert };
```

- [ ] **Step 4: Correr la suite completa (regresion)**

Run: `npm test`
Expected: PASS (sin cambios de comportamiento visibles todavia — `registerAlert` aun no tiene consumidor).

- [ ] **Step 5: Commit**

```bash
git add src/data/ally-properties.js src/data/memory.js
git commit -m "feat(bot): registrado_por en ally_properties + dedup de avisos (registerAlert)"
```

---

### Task 4: Buscar asesor por login (`advisors.findByAuthUserId`)

**Files:**
- Modify: `src/data/advisors.js`

**Interfaces:**
- Produces: `findByAuthUserId(orgId, authUserId) → Promise<Advisor|null>`. Usada por Task 5.

- [ ] **Step 1: Implementar la funcion**

En `src/data/advisors.js`, agregar antes de `module.exports`:

```js
// Busca el asesor (fila de advisors) vinculado a un login del CRM
// (auth_user_id) — usado para dirigir el aviso de un match de aliado a quien
// registro esa propiedad, no al asesor de la especialidad.
async function findByAuthUserId(orgId, authUserId) {
  if (!authUserId) return null;
  if (!supabase) {
    return memory.advisors.find((a) => a.org_id === orgId && a.auth_user_id === authUserId) || null;
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

Y actualizar `module.exports`:

```js
module.exports = { findForTransfer, findByAuthUserId };
```

- [ ] **Step 2: Correr la suite completa (regresion)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/data/advisors.js
git commit -m "feat(bot): advisors.findByAuthUserId para resolver al dueno de un aliado"
```

---

### Task 5: Registro desde Sofi-Comando (`registrar_propiedad_colega`)

**Files:**
- Modify: `src/agent/sofi-comando-tools.js`
- Modify: `src/agent/sofi-comando-prompts.js`
- Test: `test/command-ally-tool.test.js` (nuevo)

**Interfaces:**
- Consumes: `allyProperties.create(orgId, fields)` (Task 3), `scope.orgId`/`scope.viewerUid` (ya existentes en `src/agent/scope.js`).
- Produces: tool `registrar_propiedad_colega` disponible en `COMMAND_TOOL_DEFINITIONS`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/command-ally-tool.test.js`:

```js
// Registro de propiedades de colegas desde Sofi-Comando (el asesor, no el
// colega, es quien la registra) — mismo criterio de mock que
// command-advisor-tools.test.js: el scope viene del ctx del servidor.
const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const allyProperties = require("../src/data/ally-properties");

function asesorScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "uid-asesor-1", role: "asesor_ventas", isAdmin: false });
}

test("registrar_propiedad_colega: guarda la propiedad con registrado_por = el asesor logueado", async (t) => {
  const created = [];
  t.mock.method(allyProperties, "create", async (orgId, fields) => {
    created.push({ orgId, fields });
    return { id: "ally-9", ...fields };
  });

  const input = {
    tipo: "Apartamento",
    operacion: "Arriendo",
    zona: "Laureles",
    precio: "$1.800.000",
    inmobiliaria_origen: "Century21",
    contacto_nombre: "Andrea Restrepo",
  };
  const out = await executeCommandTool("registrar_propiedad_colega", input, { scope: asesorScope(), session: null });

  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].orgId, "org-1");
  assert.strictEqual(created[0].fields.registrado_por, "uid-asesor-1");
  assert.strictEqual(created[0].fields.contacto_nombre, "Andrea Restrepo");
  assert.match(out, /Andrea Restrepo/);
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npm test`
Expected: FAIL — `Herramienta desconocida: registrar_propiedad_colega` (la tool no existe todavía).

- [ ] **Step 3: Agregar la definicion de la tool**

En `src/agent/sofi-comando-tools.js`, agregar al array `COMMAND_TOOL_DEFINITIONS` (después del objeto de `buscar_red_aliados`):

```js
  {
    name: "registrar_propiedad_colega",
    description:
      "Registra una propiedad que un colega de OTRA inmobiliaria le comparte al asesor, para sumarla a la red de aliados del equipo. Usala cuando el asesor te cuente que un colega tiene un inmueble disponible ('mi colega Andrea de Century21 tiene un apto en Laureles en arriendo'). Queda guardada con el asesor como quien la registro: si mas adelante un cliente pregunta por algo similar, se le avisa a EL primero.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia de la propiedad, si la dieron" },
        titulo: { type: "string", description: "Titulo o descripcion corta" },
        tipo: { type: "string", description: "Tipo de propiedad: Apartamento, Casa, Apartaestudio, Finca, Lote" },
        operacion: { type: "string", enum: ["Venta", "Arriendo"] },
        precio: { type: "string", description: "Precio o canon, tal como lo dieron" },
        zona: { type: "string", description: "Zona o barrio" },
        ciudad: { type: "string", description: "Ciudad o municipio" },
        descripcion: { type: "string", description: "Resto de detalles relevantes en texto libre" },
        inmobiliaria_origen: { type: "string", description: "Inmobiliaria del colega" },
        contacto_nombre: { type: "string", description: "Nombre del colega que comparte la propiedad" },
        contacto_telefono: { type: "string", description: "Telefono del colega, si lo dieron" },
      },
      required: ["contacto_nombre"],
    },
  },
```

- [ ] **Step 4: Agregar el handler**

En `executeCommandTool`, agregar un `case` nuevo (después de `case "buscar_red_aliados":` y su bloque, antes de `default:`):

```js
    case "registrar_propiedad_colega": {
      await allyProperties.create(scope.orgId, {
        ...input,
        registrado_por: scope.viewerUid,
      });
      return `Propiedad de ${input.contacto_nombre} registrada en la red de aliados. Si un cliente pregunta por algo similar, te avisaremos a ti primero para que valides disponibilidad.`;
    }
```

- [ ] **Step 5: Agregar la tool a la guia del prompt**

En `src/agent/sofi-comando-prompts.js`, agregar una línea en la lista de HERRAMIENTAS (después de `- buscar_red_aliados: ...`):

```
- registrar_propiedad_colega: guarda una propiedad que un colega de otra inmobiliaria comparte, para sumarla a la red del equipo.
```

Y agregar, después del bloque `BUSQUEDA DE PROPIEDADES PARA EL ASESOR`, una sección nueva:

```
RED DE ALIADOS PROPIA (registrar_propiedad_colega):
- Si el asesor te cuenta que un colega de otra inmobiliaria tiene un inmueble disponible, guardalo con registrar_propiedad_colega. El nombre del colega es obligatorio (preguntalo si no lo dio); el resto de datos, los que haya.
- Explicale en una linea que si un cliente pregunta por algo parecido, se le avisara a el primero para que valide disponibilidad antes de comprometerse con el cliente.
```

- [ ] **Step 6: Correr el test y confirmar que pasa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/sofi-comando-tools.js src/agent/sofi-comando-prompts.js test/command-ally-tool.test.js
git commit -m "feat(bot): tool registrar_propiedad_colega en Sofi-Comando"
```

---

### Task 6: Match con dueño + aviso inmediato en `tools.js`

**Files:**
- Modify: `src/agent/tools.js`
- Test: `test/ally-tool.test.js`

**Interfaces:**
- Consumes: `allyProperties.registerAlert(orgId, allyPropertyId, leadId)` (Task 3), `advisors.findByAuthUserId(orgId, authUserId)` (Task 4), `buildAllyClientMatchAlert(allyProperty, lead)` (Task 2).
- Produces: `ctx.allyAlert = { advisorPhone, advisorAlert } | null` tras ejecutar `buscar_propiedades`. Consumida por Task 6 (`engine.js`).

- [ ] **Step 1: Escribir los tests que fallan**

En `test/ally-tool.test.js`, agregar el import de `advisors` (después de `const properties = require("../src/data/properties");`):

```js
const advisors = require("../src/data/advisors");
```

Y en `baseCtx()`, agregar el campo nuevo (después de `allyMatch: null,`):

```js
    allyMatch: null,
    allyAlert: null,
```

Agregar al final del archivo:

```js
test("buscar_propiedades: match de aliado CON dueno y aviso nuevo → arma ctx.allyAlert para el asesor dueno", async (t) => {
  t.mock.method(properties, "search", async () => []);
  t.mock.method(allyProperties, "search", async () => [
    { id: "ally-3", registrado_por: "uid-asesor-1", zona: "Laureles", tipo: "Apartamento", precio: "$1.800.000", ref: "10128030", contacto_nombre: "Andrea Restrepo", inmobiliaria_origen: "Century21" },
  ]);
  t.mock.method(allyProperties, "registerAlert", async () => true);
  let findArgs = null;
  t.mock.method(advisors, "findByAuthUserId", async (orgId, authUserId) => {
    findArgs = { orgId, authUserId };
    return { name: "Camila", phone: "573009990000" };
  });

  const ctx = baseCtx();
  await executeTool("buscar_propiedades", { zona: "Laureles" }, ctx);

  assert.deepStrictEqual(findArgs, { orgId: "org-1", authUserId: "uid-asesor-1" });
  assert.strictEqual(ctx.allyAlert.advisorPhone, "573009990000");
  assert.match(ctx.allyAlert.advisorAlert, /Andrea Restrepo/);
});

test("buscar_propiedades: match ya avisado antes (registerAlert devuelve false) → no repite el aviso", async (t) => {
  t.mock.method(properties, "search", async () => []);
  t.mock.method(allyProperties, "search", async () => [
    { id: "ally-3", registrado_por: "uid-asesor-1", zona: "Laureles" },
  ]);
  t.mock.method(allyProperties, "registerAlert", async () => false);
  t.mock.method(advisors, "findByAuthUserId", async () => ({ name: "Camila", phone: "573009990000" }));

  const ctx = baseCtx();
  await executeTool("buscar_propiedades", { zona: "Laureles" }, ctx);

  assert.strictEqual(ctx.allyAlert, null);
});

test("buscar_propiedades: match del flujo viejo SIN dueno (registrado_por null) → no genera aviso inmediato", async (t) => {
  t.mock.method(properties, "search", async () => []);
  t.mock.method(allyProperties, "search", async () => [
    { id: "ally-2", registrado_por: null, zona: "Guatape" },
  ]);
  const registerCalls = [];
  t.mock.method(allyProperties, "registerAlert", async (...args) => {
    registerCalls.push(args);
    return true;
  });

  const ctx = baseCtx();
  const result = await executeTool("buscar_propiedades", { zona: "Guatape" }, ctx);

  assert.strictEqual(registerCalls.length, 0);
  assert.strictEqual(ctx.allyAlert, null);
  assert.match(result, /AVISO INTERNO/);
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npm test`
Expected: FAIL — `ctx.allyAlert` queda `undefined` en vez de con el objeto esperado (la lógica todavía no existe).

- [ ] **Step 3: Implementar la logica en `tools.js`**

Actualizar el import de `../notifications/advisor` (línea 7 actual):

```js
const { buildClientLink, buildAllyClientMatchAlert } = require("../notifications/advisor");
```

Reemplazar el bloque del match de aliado (el `if (posibleMatch.length > 0) { ... }` actual, líneas ~183-186) por:

```js
      if (posibleMatch.length > 0) {
        ctx.allyMatch = posibleMatch[0];
        if (ctx.allyMatch.registrado_por) {
          try {
            const esNuevo = await allyProperties.registerAlert(ctx.org.id, ctx.allyMatch.id, ctx.lead.id);
            if (esNuevo) {
              const advisor = await advisors.findByAuthUserId(ctx.org.id, ctx.allyMatch.registrado_por);
              if (advisor) {
                ctx.allyAlert = { advisorPhone: advisor.phone, advisorAlert: buildAllyClientMatchAlert(ctx.allyMatch, ctx.lead) };
              }
            }
          } catch (e) {
            console.warn("[tools] No se pudo generar el aviso inmediato de match de aliado:", e.message);
          }
        }
        return "No se encontraron propiedades en el inventario PROPIO con esos criterios. AVISO INTERNO (no reveles al cliente precio, referencia, ni ningun dato del colega): existe una posible coincidencia en la red de aliados. Puedes decirle al cliente que tienes una opcion por la zona que el pidio y que un asesor lo contactara pronto para confirmar disponibilidad. Tambien transfierelo con transferir_a_asesor.";
      }
```

(`advisors` ya está importado arriba en el archivo — línea 3 actual, `const advisors = require("../data/advisors");`.)

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npm test`
Expected: PASS (todos, incluidos los 3 nuevos y los ya existentes de `ally-tool.test.js` sin cambios).

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.js test/ally-tool.test.js
git commit -m "feat(bot): aviso inmediato al asesor dueno cuando un cliente hace match con su aliado"
```

---

### Task 7: Propagar `allyAlert` hasta WhatsApp/Telegram

**Files:**
- Modify: `src/agent/engine.js`
- Modify: `src/channels/whatsapp.js`
- Modify: `src/channels/telegram.js`

**Interfaces:**
- Consumes: `ctx.allyAlert` (Task 5).
- Produces: `procesarMensaje()` devuelve `{ reply, lead, transfer, allyAlert, assistantMessageId }`.

- [ ] **Step 1: Inicializar y propagar `allyAlert` en `engine.js`**

En la línea donde se arma `ctx` (`const ctx = { org, lead, propertyInteres: null, transfer: null, cita: null, allyMatch: null, lastUserMessage: text };`), agregar el campo:

```js
  const ctx = { org, lead, propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null, lastUserMessage: text };
```

Y al final de la función, justo antes del `return`, agregar (después del bloque `if (ctx.transfer) { ... }` que arma `transfer`):

```js
  // Aviso inmediato al asesor dueno de una propiedad de colega que hizo match
  // con este cliente — independiente de transfer: no espera a que el lead
  // se transfiera o califique (ver ctx.allyAlert en tools.js).
  const allyAlert = ctx.allyAlert || null;

  return { reply, lead, transfer, allyAlert, assistantMessageId: assistantMsg?.id || null };
```

(reemplaza el `return` actual que no incluye `allyAlert`).

- [ ] **Step 2: Enviar el aviso por WhatsApp**

En `src/channels/whatsapp.js`, actualizar la desestructuración (línea ~176):

```js
    const { reply, transfer, allyAlert, assistantMessageId } = await procesarMensaje({
```

Y agregar, después del bloque `if (transfer) { ... }` existente:

```js
    if (allyAlert) {
      await sendWhatsApp(org, allyAlert.advisorPhone, allyAlert.advisorAlert, { fromPhoneId: phoneNumberId });
    }
```

- [ ] **Step 3: Enviar el aviso por Telegram (canal de pruebas)**

En `src/channels/telegram.js`, actualizar la desestructuración:

```js
    const { reply, transfer, allyAlert } = await procesarMensaje({
```

Y agregar, después del bloque `if (transfer) { ... }` existente:

```js
    if (allyAlert) {
      await sendTelegram(chatId, `🔔 [ALERTA INMEDIATA AL DUENO DEL ALIADO]\n\n${allyAlert.advisorAlert}`);
    }
```

- [ ] **Step 4: Correr la suite completa (regresion)**

Run: `npm test`
Expected: PASS — ningún test existente llama `procesarMensaje` end-to-end (toca la API de Anthropic real), así que esto es una verificación de que nada se rompió en los módulos ya cubiertos.

- [ ] **Step 5: Commit**

```bash
git add src/agent/engine.js src/channels/whatsapp.js src/channels/telegram.js
git commit -m "feat(bot): propaga el aviso inmediato de match de aliado hasta WhatsApp/Telegram"
```

---

### Task 8: Verificación final

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS — todos los tests (existentes + los agregados en Tasks 2, 4b y 5).

- [ ] **Step 2: Aplicar la migración en Supabase**

Pegar el contenido de `db/migrations/2026-07-22_ally_properties_asesor.sql` en el SQL Editor de Supabase y ejecutarlo (mismo flujo manual que las migraciones anteriores del repo).

- [ ] **Step 3: Smoke manual end-to-end**

1. Como asesor logueado en el CRM, abrir Sofi-Comando y escribir algo como: *"mi colega Andrea de Century21 tiene un apartamento en Laureles en arriendo, como en 1.8 millones"* — confirmar que responde reconociendo el registro.
2. Verificar en Supabase (`select * from ally_properties order by created_at desc limit 1;`) que la fila nueva tiene `registrado_por` = el `auth.uid()` de ese asesor.
3. Por el canal de Telegram (`/start` sin ref, o mensaje directo), simular un cliente preguntando por un apartamento en arriendo en Laureles que no esté en el inventario propio — confirmar que: (a) al cliente NO se le revela precio/ref/nombre del colega, solo que "hay una opción por esa zona" y que un asesor lo contactará; (b) llega el mensaje `🔔 [ALERTA INMEDIATA AL DUENO DEL ALIADO]` en el mismo chat (demo), con el nombre de Andrea y Century21.
4. Repetir el mismo mensaje del cliente una segunda vez en la misma conversación — confirmar que NO llega un segundo aviso (dedup de `ally_property_alerts`).

- [ ] **Step 4: Reportar a Juan**

Confirmar que los 4 puntos del smoke pasaron antes de dar la feature por terminada.

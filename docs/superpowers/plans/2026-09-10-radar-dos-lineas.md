# El radar con dos líneas: implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `DaianaDiamond` (línea preferida) y `RADA-NATALIA` (renombrada por Juan, línea de respaldo) puedan estar las dos vinculadas y activas a la vez sin que se rompan en silencio la aprobación manual, el DM manual, la ventana de 24h ni el resto de los sitios que hoy asumen "una sola sesión activa".

**Architecture:** Una tabla nueva `grupo_lineas` registra qué sesión de WAHA ve cada grupo (upsert en cada mensaje, antes del descarte por repetido). Un resolver único, `whatsappGroups.lineaDeSalida(org, groupId, opts)`, decide por cuál línea sale cada DM al colega: la preferida (la sesión activa cuyo `advisor_id` es la asesora principal del radar) si está activa y vista en ese grupo; si no, la que recibió el mensaje; si no, cualquier activa vista en el grupo; si no hay grupo (cascada de citas, warmers, pruebas), cualquier sesión activa. Todo lo que hoy exige "exactamente una sesión activa" pasa a llamar a este resolver en vez de adivinar con `sesiones[0]` o fallar con 409/`sesion_ambigua`.

**Tech Stack:** Node.js, Supabase (Postgres), `node:test` + `node:assert` (mocks vía `t.mock.method`), Express (crm.js).

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-09-10-radar-dos-lineas-design.md` — no la dupliques, consultala si algo de acá no calza.
- La migración SQL la corre Juan a mano contra producción (Supabase), **antes** de este deploy — no se ejecuta desde código ni desde un script en este plan.
- Todo módulo de datos (`src/data/*`) sigue el patrón `if (!supabase) { memoria } else { supabase }` ya establecido en `whatsapp-groups.js` — no introduzcas un patrón nuevo.
- Nunca lanza (`throw`) hacia arriba desde un resolver que corre en el camino caliente del webhook o de un envío al colega: todo I/O nuevo se degrada con `.catch()` a un valor seguro (`null`/`new Set()`), con un `console.warn`.
- Commits pequeños, uno por tarea, mensaje en español con prefijo convencional (`feat:`, `fix:`, `test:`), terminando en:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```
- Correr `npm test` completo al final de cada tarea, no solo el archivo tocado — varias de estas funciones tienen tests cruzados (`group-vivo.test.js`, `ventana-asesora.test.js`, `cancelar-cita-endpoint.test.js`).

---

## File Structure

- **Create:** `db/migrations/2026-09-10_grupo_lineas.sql` — tabla `grupo_lineas` + columna `group_signals.respuesta_sesion`.
- **Modify:** `src/data/memory.js` — array `grupoLineas: []` para el fallback sin Supabase.
- **Modify:** `src/data/whatsapp-groups.js` — `registrarLineaEnGrupo`, `lineasDelGrupo` (interna), `lineaDeSalida` (el resolver único).
- **Modify:** `src/channels/whatsapp-group.js` — el webhook registra `(grupo, sesión)` antes de `yaVisto`.
- **Modify:** `src/data/group-signals.js` — `marcarRespondida` acepta y guarda `sesion`.
- **Modify:** `src/groups/vivo.js` — `asistir`, `aprobarManual`, `responderPorDmManual`, `prepararAviso` usan el resolver.
- **Modify:** `src/api/crm.js` — las rutas que hoy exigen "exactamente una activa" o toman `sesiones[0]` a ciegas.
- **Modify:** `src/scheduler/ventana-asesora.js` — `sesionActiva` usa el resolver en vez de exigir exactamente una.
- **Modify:** `src/groups/cancelar-cita.js` (callers en `crm.js`), `src/scheduler/avisos-salida.js`, `src/scheduler/radar-directorio.js` — mismo cambio de "primera activa" a "preferida".
- **Test:** `test/whatsapp-groups-linea-salida.test.js` (nuevo), y ediciones en `test/group-vivo.test.js`, `test/ventana-asesora.test.js`, `test/cancelar-cita-endpoint.test.js`, `test/crm-grupos.test.js` (o el archivo que cubra `senal/responder-dm` y `aviso/ver` — confirmarlo con `grep -rl "responder-dm" test/`).

---

### Task 1: Migración SQL

**Files:**
- Create: `db/migrations/2026-09-10_grupo_lineas.sql`

**Interfaces:**
- Produces: tabla `grupo_lineas(org_id, group_id, sesion, ultimo_visto)`, PK `(org_id, group_id, sesion)`; columna `group_signals.respuesta_sesion text`. Ambas usadas por la Task 2 y la Task 4.

- [ ] **Step 1: Escribir la migración**

```sql
-- Dos lineas conviven (Daiana primero, Natalia de respaldo por grupo).
-- Ver docs/superpowers/specs/2026-09-10-radar-dos-lineas-design.md

create table if not exists grupo_lineas (
  org_id uuid not null references organizations(id) on delete cascade,
  group_id uuid not null references whatsapp_groups(id) on delete cascade,
  sesion text not null,
  ultimo_visto timestamptz not null default now(),
  primary key (org_id, group_id, sesion)
);

alter table group_signals add column if not exists respuesta_sesion text;
```

- [ ] **Step 2: Avisar a Juan**

Esta migración la corre Juan a mano en el SQL Editor de Supabase (proyecto `qwqmlmyyswpdypdfvmiv`), **antes** de desplegar el resto de este plan — igual que todas las anteriores (ver el historial de "corrida y verificada por REST" en `CLAUDE.md`). No hay paso de código que la ejecute. El resto de las tareas de este plan asumen que ya corrió; si no ha corrido, los `.catch()` de las Tasks 2 y 4 degradan sin romper nada, pero la línea de respaldo no funciona hasta que la tabla exista.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/2026-09-10_grupo_lineas.sql
git commit -m "docs(radar): migracion -- grupo_lineas y group_signals.respuesta_sesion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: El resolver — `whatsappGroups.lineaDeSalida`

**Files:**
- Modify: `src/data/memory.js`
- Modify: `src/data/whatsapp-groups.js`
- Test: `test/whatsapp-groups-linea-salida.test.js`

**Interfaces:**
- Consumes: `advisors.findAsesorPrincipalRadar(org)` → `{ id, phone, ... } | null` (ya existe, `src/data/advisors.js:223`). `listSessions(orgId)` → filas de `whatsapp_sessions` (ya existe).
- Produces: `registrarLineaEnGrupo(orgId, groupId, sesion) → Promise<void>` (nunca lanza). `lineasDelGrupo(orgId, groupId) → Promise<Set<string>>` (nombres de sesión vistos en ese grupo). `lineaDeSalida(org, groupId, { sesionQueRecibio = null } = {}) → Promise<string|null>` — el nombre de la sesión por la que hay que salir, o `null` si ninguna sirve. Usado por las Tasks 3, 5, 6, 7, 9, 10.

- [ ] **Step 1: Agregar el array de memoria**

En `src/data/memory.js`, junto a `whatsappGroups: []` (línea 44):

```js
  whatsappGroups: [],
  // Que sesion de WAHA vio cada grupo (ver lineaDeSalida en whatsapp-groups.js).
  grupoLineas: [],
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `test/whatsapp-groups-linea-salida.test.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const whatsappGroups = require("../src/data/whatsapp-groups");
const advisors = require("../src/data/advisors");
const memory = require("../src/data/memory");

const ORG = { id: "org-1" };
const DAIANA = { id: "adv-daiana", phone: "573011880668" };

beforeEach(() => {
  memory.whatsappSessions.length = 0;
  memory.grupoLineas.length = 0;
});

function sesiones(...filas) {
  memory.whatsappSessions.push(...filas);
}

test("registrarLineaEnGrupo + lineasDelGrupo: upsert idempotente por (grupo, sesion)", async () => {
  await whatsappGroups.registrarLineaEnGrupo(ORG.id, "grupo-1", "DaianaDiamond");
  await whatsappGroups.registrarLineaEnGrupo(ORG.id, "grupo-1", "DaianaDiamond");
  await whatsappGroups.registrarLineaEnGrupo(ORG.id, "grupo-1", "RADA-NATALIA");

  const vistas = await whatsappGroups.lineasDelGrupo(ORG.id, "grupo-1");
  assert.deepStrictEqual([...vistas].sort(), ["DaianaDiamond", "RADA-NATALIA"]);
});

test("lineaDeSalida: la preferida activa y vista en el grupo, aunque llegara por la otra", async (t) => {
  sesiones(
    { org_id: ORG.id, nombre: "DaianaDiamond", estado: "activa", advisor_id: DAIANA.id },
    { org_id: ORG.id, nombre: "RADA-NATALIA", estado: "activa", advisor_id: "adv-natalia" }
  );
  await whatsappGroups.registrarLineaEnGrupo(ORG.id, "grupo-1", "DaianaDiamond");
  await whatsappGroups.registrarLineaEnGrupo(ORG.id, "grupo-1", "RADA-NATALIA");
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);

  const salida = await whatsappGroups.lineaDeSalida(ORG, "grupo-1", { sesionQueRecibio: "RADA-NATALIA" });
  assert.strictEqual(salida, "DaianaDiamond");
});

test("lineaDeSalida: preferida fuera del grupo -> la que recibio el mensaje", async (t) => {
  sesiones(
    { org_id: ORG.id, nombre: "DaianaDiamond", estado: "activa", advisor_id: DAIANA.id },
    { org_id: ORG.id, nombre: "RADA-NATALIA", estado: "activa", advisor_id: "adv-natalia" }
  );
  await whatsappGroups.registrarLineaEnGrupo(ORG.id, "grupo-1", "RADA-NATALIA");
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);

  const salida = await whatsappGroups.lineaDeSalida(ORG, "grupo-1", { sesionQueRecibio: "RADA-NATALIA" });
  assert.strictEqual(salida, "RADA-NATALIA");
});

test("lineaDeSalida: ninguna sesion vista en el grupo y no llego nada -> null", async (t) => {
  sesiones({ org_id: ORG.id, nombre: "DaianaDiamond", estado: "activa", advisor_id: DAIANA.id });
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);

  const salida = await whatsappGroups.lineaDeSalida(ORG, "grupo-vacio", {});
  assert.strictEqual(salida, null);
});

test("lineaDeSalida: preferida inactiva -> cualquier otra activa vista en el grupo", async (t) => {
  sesiones(
    { org_id: ORG.id, nombre: "DaianaDiamond", estado: "pendiente", advisor_id: DAIANA.id },
    { org_id: ORG.id, nombre: "RADA-NATALIA", estado: "activa", advisor_id: "adv-natalia" }
  );
  await whatsappGroups.registrarLineaEnGrupo(ORG.id, "grupo-1", "RADA-NATALIA");
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);

  const salida = await whatsappGroups.lineaDeSalida(ORG, "grupo-1", {});
  assert.strictEqual(salida, "RADA-NATALIA");
});

test("lineaDeSalida sin groupId (cascada de citas, ventana-asesora): cualquier activa, sin exigir registro en grupo", async (t) => {
  sesiones({ org_id: ORG.id, nombre: "RADA-NATALIA", estado: "activa", advisor_id: "adv-natalia" });
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);

  const salida = await whatsappGroups.lineaDeSalida(ORG, null, {});
  assert.strictEqual(salida, "RADA-NATALIA");
});

test("lineaDeSalida: sin sesiones activas -> null", async (t) => {
  sesiones({ org_id: ORG.id, nombre: "DaianaDiamond", estado: "pendiente", advisor_id: DAIANA.id });
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => DAIANA);

  const salida = await whatsappGroups.lineaDeSalida(ORG, null, {});
  assert.strictEqual(salida, null);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test test/whatsapp-groups-linea-salida.test.js`
Expected: FAIL — `registrarLineaEnGrupo`, `lineasDelGrupo` y `lineaDeSalida` no existen todavía.

- [ ] **Step 3: Implementar**

En `src/data/whatsapp-groups.js`, agregar después de `touchSession` (línea 135) y antes de `// ── Grupos ───`:

```js
const advisors = require("./advisors");

// ── Grupo x línea ────────────────────────────────────────────────────────
//
// Que sesion de WAHA vio cada grupo — la base de lineaDeSalida. Se llama en
// CADA mensaje de grupo que llega por el webhook, antes del descarte por
// repetido (yaVisto): con dos lineas conectadas al mismo grupo, WAHA entrega
// el mensaje dos veces (una por cada dispositivo), y las dos tienen que
// quedar registradas aunque solo la primera se procese.

async function registrarLineaEnGrupo(orgId, groupId, sesion) {
  if (!sesion || !groupId) return;
  const ahoraIso = new Date().toISOString();
  try {
    if (!supabase) {
      const existente = memory.grupoLineas.find(
        (g) => g.org_id === orgId && g.group_id === groupId && g.sesion === sesion
      );
      if (existente) existente.ultimo_visto = ahoraIso;
      else memory.grupoLineas.push({ org_id: orgId, group_id: groupId, sesion, ultimo_visto: ahoraIso });
      return;
    }
    await supabase
      .from("grupo_lineas")
      .upsert({ org_id: orgId, group_id: groupId, sesion, ultimo_visto: ahoraIso }, { onConflict: "org_id,group_id,sesion" });
  } catch (e) {
    console.warn("[grupos] No se pudo registrar la linea del grupo (falta la migracion 2026-09-10_grupo_lineas.sql?):", e.message);
  }
}

async function lineasDelGrupo(orgId, groupId) {
  if (!groupId) return new Set();
  if (!supabase) {
    return new Set(
      memory.grupoLineas.filter((g) => g.org_id === orgId && g.group_id === groupId).map((g) => g.sesion)
    );
  }
  const { data, error } = await supabase
    .from("grupo_lineas").select("sesion").eq("org_id", orgId).eq("group_id", groupId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.sesion));
}

// EL RESOLVER UNICO (2026-09-10, "dos lineas conviven"). Decide por cual
// linea de WAHA sale un DM al colega, para que dejen de asumir "una sola
// sesion activa" los sitios que hoy fallan en silencio con dos (ver la nota
// de contexto en docs/superpowers/specs/2026-09-10-radar-dos-lineas-design.md).
//
// Orden: la preferida (la sesion activa cuyo advisor_id es la asesora
// principal del radar) si esta activa Y vista en ESE grupo; si no, la que
// recibio el mensaje (sesionQueRecibio); si no, cualquier sesion activa vista
// en el grupo; si no hay ninguna, null. Sin groupId (la cascada de citas, la
// ventana de 24h, los diagnosticos que no nacen de un mensaje de grupo) se
// salta el chequeo de "vista en el grupo" y devuelve cualquier activa: no hay
// grupo contra el cual verificar.
//
// org: fila de organizations (usa org.id). Nunca lanza: un fallo en I/O
// devuelve null, igual que "no hay ninguna linea" — quien llama ya sabe
// tratar null como "cae al aviso de la asesora".
async function lineaDeSalida(org, groupId, { sesionQueRecibio = null } = {}) {
  let sesiones;
  try {
    sesiones = await listSessions(org.id);
  } catch (e) {
    console.warn("[grupos] lineaDeSalida no pudo leer las sesiones:", e.message);
    return null;
  }
  const activas = (sesiones || []).filter((s) => s.estado === "activa");
  if (activas.length === 0) return null;

  const asesora = await advisors.findAsesorPrincipalRadar(org).catch(() => null);
  const preferida = asesora ? activas.find((s) => s.advisor_id === asesora.id) : null;

  if (!groupId) {
    if (preferida) return preferida.nombre;
    if (sesionQueRecibio && activas.some((s) => s.nombre === sesionQueRecibio)) return sesionQueRecibio;
    return activas[0].nombre;
  }

  const registradas = await lineasDelGrupo(org.id, groupId).catch((e) => {
    console.warn("[grupos] lineaDeSalida no pudo leer grupo_lineas:", e.message);
    return new Set();
  });

  if (preferida && registradas.has(preferida.nombre)) return preferida.nombre;
  if (sesionQueRecibio && activas.some((s) => s.nombre === sesionQueRecibio)) return sesionQueRecibio;
  const cualquiera = activas.find((s) => registradas.has(s.nombre));
  return cualquiera ? cualquiera.nombre : null;
}
```

Actualizar el `module.exports` al final del archivo:

```js
module.exports = {
  upsertSession, listSessions, touchSession, sesionPorNombre,
  registrarGrupo, listGroups, obtenerGrupo, setModo, setResponde, importarGrupos,
  asegurarGrupoVirtual, jidVirtual, slug,
  whitelist, invalidar,
  registrarLineaEnGrupo, lineasDelGrupo, lineaDeSalida,
};
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `node --test test/whatsapp-groups-linea-salida.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/data/memory.js src/data/whatsapp-groups.js test/whatsapp-groups-linea-salida.test.js
git commit -m "feat(radar): whatsappGroups.lineaDeSalida -- el resolver unico de dos lineas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: El webhook registra qué línea vio cada grupo

**Files:**
- Modify: `src/channels/whatsapp-group.js`
- Test: buscar el archivo que cubre `POST /webhook/grupos` con `grep -rl "webhook/grupos\"" test/` (probablemente `test/group-canal.test.js` o similar) y agregar el test ahí.

**Interfaces:**
- Consumes: `whatsappGroups.registrarLineaEnGrupo(orgId, groupId, sesion)` (Task 2).

- [ ] **Step 1: Ubicar el archivo de test existente**

Run: `grep -rl "webhook/grupos" test/*.js`

Abrir el que haga `POST` al webhook con un `grupo` ya en la whitelist, para copiar su fixture de request (`normalizar`/`req.body` shape) en el nuevo test.

- [ ] **Step 2: Escribir el test que falla**

Agregar al archivo encontrado (ajustar el nombre del mock/import si el archivo ya trae uno propio de `whatsappGroups`):

```js
test("el webhook registra la sesion en grupo_lineas antes de descartar por repetido", async (t) => {
  const registros = [];
  t.mock.method(whatsappGroups, "registrarLineaEnGrupo", async (orgId, groupId, sesion) => {
    registros.push({ orgId, groupId, sesion });
  });
  t.mock.method(whatsappGroups, "whitelist", async () => new Map([["120363xxx@g.us", { id: "grupo-1", modo: "sombra", responde: false }]]));
  t.mock.method(whatsappGroups, "sesionPorNombre", async () => ({ escucha_desde: null }));

  await enviarWebhookDeGrupo(app, { session: "RADA-NATALIA", chatId: "120363xxx@g.us", waMessageId: "wamid-1" });

  assert.strictEqual(registros.length, 1);
  assert.strictEqual(registros[0].groupId, "grupo-1");
  assert.strictEqual(registros[0].sesion, "RADA-NATALIA");
});
```

(Usar el helper de request real que ya use ese archivo de test en vez de `enviarWebhookDeGrupo` — es un nombre de ejemplo; copiar el patrón exacto del archivo, con `supertest` o lo que ya esté en uso.)

- [ ] **Step 3: Correr y verificar que falla**

Run: `node --test <archivo-encontrado>`
Expected: FAIL — `registros.length` es 0.

- [ ] **Step 4: Implementar**

En `src/channels/whatsapp-group.js`, dentro de `router.post("/webhook/grupos", ...)`, justo después de resolver `grupo` (línea 416, tras el bloque `if (!grupo) { ... return }`) y antes de `const sesion = await whatsappGroups.sesionPorNombre(...)` (línea 418):

```js
    // DOS LINEAS CONVIVEN (2026-09-10). Se registra ANTES del descarte por
    // repetido (yaVisto, mas abajo): con dos sesiones conectadas al mismo
    // grupo, WAHA entrega el mismo mensaje dos veces, y las DOS tienen que
    // quedar en grupo_lineas aunque solo la primera se procese — es lo que
    // usa whatsappGroups.lineaDeSalida para saber que linea puede escribirle
    // a este colega. Fire-and-forget, mismo patron que touchSession un poco
    // mas abajo: no puede agregar latencia al webhook.
    whatsappGroups.registrarLineaEnGrupo(org.id, grupo.id, ev.sesion).catch(() => {});

    const sesion = await whatsappGroups.sesionPorNombre(org.id, ev.sesion);
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `node --test <archivo-encontrado>`
Expected: PASS

- [ ] **Step 6: Correr toda la suite**

Run: `npm test`
Expected: PASS — nada de lo existente debería cambiar de comportamiento (la llamada es fire-and-forget y nueva).

- [ ] **Step 7: Commit**

```bash
git add src/channels/whatsapp-group.js test/<archivo-encontrado>
git commit -m "feat(radar): el webhook registra que linea vio cada grupo (grupo_lineas)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `marcarRespondida` guarda por cuál línea salió

**Files:**
- Modify: `src/data/group-signals.js:664-713`
- Test: buscar con `grep -rl "marcarRespondida" test/*.js` — probablemente `test/group-vivo.test.js` o un `test/group-signals.test.js` dedicado.

**Interfaces:**
- Produces: `marcarRespondida(orgId, signalId, { texto, wamid, modo, refs, destinoTelefono, destinoLid, sesion = null })` — agrega `sesion` a la firma existente. Consumido por las Tasks 5 y 6.

- [ ] **Step 1: Escribir el test que falla**

En el archivo de test que ya cubra `marcarRespondida` (si no hay ninguno unitario, agregar al que pruebe `group-signals.js` directamente contra un mock de `supabase`):

```js
test("marcarRespondida guarda respuesta_sesion cuando se pasa sesion", async (t) => {
  const updates = [];
  t.mock.method(supabase.from("group_signals"), "update", (patch) => {
    updates.push(patch);
    return { eq: () => ({ eq: async () => ({ error: null }) }) };
  });

  await groupSignals.marcarRespondida("org-1", "signal-1", {
    texto: "hola", wamid: "w1", modo: "auto", sesion: "DaianaDiamond",
  });

  assert.strictEqual(updates[0].respuesta_sesion, "DaianaDiamond");
});
```

(Ajustar el mock de `supabase.from(...).update(...).eq(...).eq(...)` al patrón exacto que ya usen los tests existentes de `group-signals.js` — copiarlo de un test vecino en vez de inventar uno nuevo.)

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test <archivo>`
Expected: FAIL — `updates[0].respuesta_sesion` es `undefined`.

- [ ] **Step 3: Implementar**

En `src/data/group-signals.js`, agregar una entrada a `DEGRADACION_RESPUESTA` (línea 650), al final de la lista (es lo menos crítico de soltar, después de `respuesta_refs`):

```js
const DEGRADACION_RESPUESTA = [
  {
    columnas: ["respuesta_destino_telefono", "respuesta_destino_lid"],
    aviso:
      "[grupos] Falta la migracion 2026-09-04_dm_destinatario.sql: la respuesta se marca, pero sin decir a quien salio.",
  },
  {
    columnas: ["respuesta_refs"],
    aviso:
      "[grupos] Falta la migracion de group_signals.respuesta_refs: la respuesta se marca, pero sin las refs que iban en el texto.",
  },
  {
    columnas: ["respuesta_sesion"],
    aviso:
      "[grupos] Falta la migracion 2026-09-10_grupo_lineas.sql: la respuesta se marca, pero sin decir por cual linea salio.",
  },
];
```

Y en `marcarRespondida` (línea 664), agregar el parámetro y el campo del patch:

```js
async function marcarRespondida(
  orgId,
  signalId,
  { texto, wamid = null, modo = "auto", refs = null, destinoTelefono = null, destinoLid = null, sesion = null } = {}
) {
  if (!MODOS_RESPUESTA.includes(modo)) throw new Error(`Modo de respuesta invalido: ${modo}`);
  if (!supabase) return true;
  const patch = {
    respondida_at: new Date().toISOString(),
    respuesta_texto: texto || null,
    respuesta_wamid: wamid,
    respuesta_modo: modo,
    respuesta_refs: refs && refs.length ? refs : null,
    updated_at: new Date().toISOString(),
  };
  if (destinoTelefono) patch.respuesta_destino_telefono = destinoTelefono;
  if (destinoLid) patch.respuesta_destino_lid = destinoLid;
  if (sesion) patch.respuesta_sesion = sesion;
```

(El resto de la función, la degradación por columna faltante y el `return`, no cambia — `COLUMNAS_RESPUESTA` ya se deriva de `DEGRADACION_RESPUESTA.flatMap(...)`, así que recoge `respuesta_sesion` sin tocarla aparte.)

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test <archivo>`
Expected: PASS

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/data/group-signals.js test/<archivo>
git commit -m "feat(radar): group_signals.respuesta_sesion -- que linea mando cada DM

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `asistir` (DM automático) usa la línea resuelta

**Files:**
- Modify: `src/groups/vivo.js:423-733` (función `asistir`)
- Test: `test/group-asistido.test.js`

**Interfaces:**
- Consumes: `whatsappGroups.lineaDeSalida(org, grupo.id, { sesionQueRecibio: sesion })` (Task 2).
- Produces: nada nuevo hacia afuera — cambia el `sesion` interno usado para `cuotaLinea`, `waha.enviarDm` y `marcarRespondida`.

- [ ] **Step 1: Leer el test existente para entender el fixture**

Run: `sed -n '1,80p' test/group-asistido.test.js` (o abrirlo con Read) — copiar exactamente cómo mockea `whatsappGroups`, `waha.enviarDm` y arma `señal`/`signal`/`mensaje`/`grupo` antes de escribir el test nuevo.

- [ ] **Step 2: Escribir el test que falla**

Agregar a `test/group-asistido.test.js`:

```js
test("asistir: con dos lineas activas, el DM sale por la preferida aunque el mensaje llego por la otra", async (t) => {
  const envios = [];
  t.mock.method(whatsappGroups, "lineaDeSalida", async (org, groupId, { sesionQueRecibio }) => {
    assert.strictEqual(sesionQueRecibio, "RADA-NATALIA");
    return "DaianaDiamond";
  });
  t.mock.method(waha, "enviarDm", async (sesion, telefono, texto, opts) => {
    envios.push({ sesion, telefono, opts });
    return { ok: true, wamid: "w1" };
  });
  t.mock.method(waha, "cuotaDeLinea", async () => null);
  // ... resto del escenario feliz que ya arma el archivo (veredicto que aprueba,
  // politica.decidirDm que dice enviarDm:true, etc.) con sesion: "RADA-NATALIA"
  // pasado a asistir() como la sesion que RECIBIO el mensaje.

  const r = await vivo.asistir(ORG, C, SEÑAL, SIGNAL, { mensaje: MENSAJE, grupo: GRUPO, asesor: null, ahora: AHORA, sesion: "RADA-NATALIA" });

  assert.strictEqual(envios[0].sesion, "DaianaDiamond");
});
```

(Completar `C`, `SEÑAL`, `SIGNAL`, `MENSAJE`, `GRUPO`, `AHORA` y los mocks de `revalidar`/`politica`/`directorio`/`colegas` copiando el escenario feliz que ya exista en ese archivo — no reinventar el fixture completo, solo agregar el mock de `lineaDeSalida` y verificar que `waha.enviarDm` recibe la sesión resuelta y no la cruda.)

- [ ] **Step 3: Correr y verificar que falla**

Run: `node --test test/group-asistido.test.js`
Expected: FAIL — `envios[0].sesion` es `"RADA-NATALIA"` (la cruda), no `"DaianaDiamond"`.

- [ ] **Step 4: Implementar**

En `src/groups/vivo.js`, dentro de `asistir` (línea 423), agregar justo después de la declaración de la función (antes de `const matches = ...`):

```js
async function asistir(org, c, señal, signal, { mensaje, grupo, asesor, ahora, sesion = null }) {
  // DOS LINEAS CONVIVEN (2026-09-10): `sesion` (arriba, en los parametros) es
  // la que RECIBIO el mensaje del grupo -- se sigue usando tal cual para
  // directorio.telefonoDe (leer participantes por la linea que vio el
  // grupo). `sesionSalida` es por donde el DM tiene que SALIR: la preferida
  // si esta activa y vista en este grupo, si no la que recibio, si no
  // cualquier otra vista en el grupo. Ver whatsappGroups.lineaDeSalida.
  const sesionSalida = await whatsappGroups
    .lineaDeSalida(org, grupo && grupo.id, { sesionQueRecibio: sesion })
    .catch((e) => {
      console.warn("[radar] No se pudo resolver la linea de salida, se usa la que recibio:", e.message);
      return sesion;
    });

  const matches = señal.matches || [];
```

Después, reemplazar los usos de `sesion` que son sobre la línea de SALIDA (no tocar el de `directorio.telefonoDe`, línea ~458, que sigue siendo sobre la línea que RECIBIÓ):

- Línea ~528 `cuotaLinea`:
  ```js
  const cuotaLinea = sesionSalida
    ? await waha.cuotaDeLinea(sesionSalida).catch((e) => {
  ```
- Línea ~620 (el gate de envío):
  ```js
  if (decisionDm.enviarDm && sesionSalida && utiles.length > 0 && salidaSolaOk) {
  ```
- Línea ~636 y ~647 y ~663 (las tres llamadas a `waha.enviarDm`): cambiar el primer argumento de `sesion` a `sesionSalida`.
- Línea ~683 (`marcarRespondida`): agregar el campo nuevo al objeto:
  ```js
        await groupSignals.marcarRespondida(org.id, signal.id, {
          texto: textoDm, wamid: envioDm.wamid, modo: "auto", refs: refsDm,
          destinoTelefono: telefonoColega || null,
          destinoLid: mensaje.autorId || mensaje.autorTelefono || null,
          sesion: sesionSalida,
        });
  ```

No tocar: `directorio.telefonoDe(org.id, mensaje.autorTelefono, { sesion, jid: grupo.jid, ... })` (línea ~458) sigue usando `sesion` (la que recibió), no `sesionSalida` — es sobre leer participantes de WAHA, no sobre por dónde sale el DM.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `node --test test/group-asistido.test.js`
Expected: PASS

- [ ] **Step 6: Correr toda la suite**

Run: `npm test`
Expected: PASS — con una sola sesión activa (el caso de hoy en producción), `lineaDeSalida` devuelve esa misma sesión, así que el comportamiento actual no cambia.

- [ ] **Step 7: Commit**

```bash
git add src/groups/vivo.js test/group-asistido.test.js
git commit -m "feat(radar): asistir manda el DM por la linea preferida, no por la que recibio

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `aprobarManual` deja de exigir "exactamente una activa"

**Files:**
- Modify: `src/groups/vivo.js:1039-1221` (función `aprobarManual`)
- Test: `test/group-vivo.test.js`

**Interfaces:**
- Consumes: `whatsappGroups.lineaDeSalida(org, signal.group_id, {})` (Task 2).
- Produces: cambia el resultado `"sesion_ambigua"` por `"sin_sesion"` cuando el resolver no encuentra ninguna línea — mismo nombre que ya usa `responderPorDmManual` para el mismo caso (consistencia entre los dos caminos manuales).

- [ ] **Step 1: Ubicar los tests existentes de `sesion_ambigua`**

Run: `grep -n "sesion_ambigua" test/group-vivo.test.js`

- [ ] **Step 2: Escribir/editar los tests**

Reemplazar cada test que hoy arma 0 o 2+ sesiones activas y espera `resultado: "sesion_ambigua"` por uno que mockea `whatsappGroups.lineaDeSalida` devolviendo `null` y espera `resultado: "sin_sesion"`:

```js
test("aprobarManual: sin ninguna linea que pueda salir, sin_sesion (no publica ni marca respondida)", async (t) => {
  t.mock.method(whatsappGroups, "lineaDeSalida", async () => null);
  // ... el resto del escenario que ya arma este archivo para llegar hasta el
  // punto de resolver la sesion (signal valido, no es solo_llamada, grupo
  // encontrado y habilitado, carril no aplica, hay publicables, hay texto).

  const r = await vivo.aprobarManual(ORG, "signal-1");

  assert.strictEqual(r.resultado, "sin_sesion");
});

test("aprobarManual: con dos lineas activas, usa la que resuelve lineaDeSalida", async (t) => {
  const envios = [];
  t.mock.method(whatsappGroups, "lineaDeSalida", async (org, groupId) => {
    assert.strictEqual(groupId, "grupo-1"); // el group_id de la senal, no un hardcode
    return "DaianaDiamond";
  });
  t.mock.method(waha, "enviarDm", async (sesion, telefono, texto, opts) => {
    envios.push({ sesion });
    return { ok: true, wamid: "w1" };
  });
  // ... resto del escenario feliz existente.

  const r = await vivo.aprobarManual(ORG, "signal-1");

  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(envios[0].sesion, "DaianaDiamond");
});
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `node --test test/group-vivo.test.js`
Expected: FAIL en los tests editados/nuevos — `aprobarManual` todavía devuelve `sesion_ambigua` y todavía usa `listSessions` a mano.

- [ ] **Step 4: Implementar**

En `src/groups/vivo.js`, dentro de `aprobarManual` (línea 1104-1109), reemplazar:

```js
  // Una sola sesion vinculada por org en este piloto (Juan, 2026-08-16): si
  // manana hay mas de una, esto se vuelve ambiguo a proposito — falla cerrado
  // en vez de adivinar por cual linea publicar.
  const sesiones = await whatsappGroups.listSessions(org.id);
  const activas = sesiones.filter((s) => s.estado === "activa");
  if (activas.length !== 1) return { resultado: "sesion_ambigua", cantidad: activas.length };
```

por:

```js
  // DOS LINEAS CONVIVEN (2026-09-10): en vez de exigir "exactamente una
  // activa" y fallar ambiguo con dos, se resuelve por la preferida vista en
  // este grupo (ver whatsappGroups.lineaDeSalida). Mismo resultado
  // "sin_sesion" que ya usa responderPorDmManual cuando ninguna sirve --
  // consistencia entre los dos caminos manuales.
  const sesionSalida = await whatsappGroups.lineaDeSalida(org, grupo.id, {});
  if (!sesionSalida) return { resultado: "sin_sesion" };
```

Y reemplazar los tres usos de `activas[0].nombre` más abajo:

- Línea ~1129 `cuotaAgotada(activas[0].nombre)` → `cuotaAgotada(sesionSalida)`
- Línea ~1150 `directorio.telefonoDe(org.id, signal.autor_telefono, { sesion: activas[0].nombre, jid: grupo && grupo.jid })` → `{ sesion: sesionSalida, jid: grupo && grupo.jid }`
- Línea ~1173 `waha.enviarDm(activas[0].nombre, telefonoColega, texto, opcionesDm)` → `waha.enviarDm(sesionSalida, telefonoColega, texto, opcionesDm)`
- Línea ~1185 (`marcarRespondida`): agregar `sesion: sesionSalida` al objeto, mismo patrón que la Task 5.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `node --test test/group-vivo.test.js`
Expected: PASS

- [ ] **Step 6: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/groups/vivo.js test/group-vivo.test.js
git commit -m "fix(radar): aprobarManual usa la linea preferida en vez de exigir una sola activa

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `responderPorDmManual` y `prepararAviso` resuelven la sesión solos

**Files:**
- Modify: `src/groups/vivo.js:1249-1417` (`responderPorDmManual`), `src/groups/vivo.js:1536-1610` (`prepararAviso`)
- Test: `test/group-vivo.test.js`

**Interfaces:**
- Consumes: `whatsappGroups.lineaDeSalida(org, signal.group_id, {})`.
- Produces: `responderPorDmManual(org, signalId, { sesion = null, refs = null })` y `prepararAviso(org, signalId, { sesion = null })` — la firma NO cambia (siguen aceptando `sesion` para no romper llamadores existentes ni tests), pero si no viene, la resuelven solas. Esto es lo que permite que la Task 8 saque a `crm.js` del negocio de "cuál sesión mando".

- [ ] **Step 1: Ubicar los tests que pasan `sesion` explícita**

Run: `grep -n "responderPorDmManual\|prepararAviso" test/group-vivo.test.js`

Confirmar que los tests existentes siguen pasando (no deberían romperse: `sesion` explícita sigue funcionando igual, es solo el default lo que cambia).

- [ ] **Step 2: Escribir los tests nuevos que fallan**

Agregar a `test/group-vivo.test.js`:

```js
test("responderPorDmManual: sin sesion explicita, la resuelve con lineaDeSalida", async (t) => {
  const envios = [];
  t.mock.method(whatsappGroups, "lineaDeSalida", async (org, groupId) => {
    assert.strictEqual(groupId, "grupo-1");
    return "DaianaDiamond";
  });
  t.mock.method(waha, "enviarDm", async (sesion) => {
    envios.push(sesion);
    return { ok: true, wamid: "w1" };
  });
  // ... resto del escenario feliz existente para este endpoint, SIN pasar
  // `sesion` en el tercer argumento.

  const r = await vivo.responderPorDmManual(ORG, "signal-1", { refs: null });

  assert.strictEqual(r.resultado, "dm_enviado");
  assert.strictEqual(envios[0], "DaianaDiamond");
});

test("responderPorDmManual: si lineaDeSalida no resuelve nada, sin_sesion", async (t) => {
  t.mock.method(whatsappGroups, "lineaDeSalida", async () => null);
  // ... resto del escenario feliz hasta el punto de necesitar la sesion.

  const r = await vivo.responderPorDmManual(ORG, "signal-1", {});

  assert.strictEqual(r.resultado, "sin_sesion");
});

test("prepararAviso: sin sesion explicita, la resuelve con lineaDeSalida para directorio.telefonoDe", async (t) => {
  const consultas = [];
  t.mock.method(whatsappGroups, "lineaDeSalida", async () => "DaianaDiamond");
  t.mock.method(directorio, "telefonoDe", async (orgId, autorTelefono, opts) => {
    consultas.push(opts.sesion);
    return null;
  });
  // ... resto del escenario existente.

  await vivo.prepararAviso(ORG, "signal-1", {});

  assert.strictEqual(consultas[0], "DaianaDiamond");
});
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `node --test test/group-vivo.test.js`
Expected: FAIL en los 3 tests nuevos.

- [ ] **Step 4: Implementar**

En `responderPorDmManual` (línea 1249), justo después de resolver `signal` (línea 1250-1253, tras los `if` de `no_encontrada`/`ya_respondida`/`no_es_demanda`) pero antes del chequeo de `solo_llamada`, no hace falta moverlo — el cambio real es donde hoy dice `if (!sesion) return { resultado: "sin_sesion" };` (línea 1323). Reemplazar:

```js
  const telefonoColega = await directorio
    .telefonoDe(org.id, signal.autor_telefono, { sesion, jid: grupo && grupo.jid })
```

por (resolver ANTES, para que `telefonoDe` ya reciba la sesión resuelta):

```js
  // DOS LINEAS CONVIVEN (2026-09-10): si el llamador (hoy, crm.js) no trae una
  // sesion ya resuelta, se resuelve aca con la preferida vista en el grupo de
  // esta senal — el endpoint del CRM deja de tener que exigir "exactamente
  // una activa".
  const sesionResuelta = sesion || await whatsappGroups.lineaDeSalida(org, signal.group_id, {}).catch((e) => {
    console.warn("[radar] No se pudo resolver la linea de salida para el DM manual:", e.message);
    return null;
  });

  const telefonoColega = await directorio
    .telefonoDe(org.id, signal.autor_telefono, { sesion: sesionResuelta, jid: grupo && grupo.jid })
```

Y más abajo, reemplazar `if (!sesion) return { resultado: "sin_sesion" };` por `if (!sesionResuelta) return { resultado: "sin_sesion" };`, y los usos posteriores de `sesion` (línea ~1372 `cuotaAgotada(sesion)`, línea ~1375 `waha.enviarDm(sesion, ...)`, y agregar `sesion: sesionResuelta` al `marcarRespondida` de la línea ~1395) por `sesionResuelta`.

En `prepararAviso` (línea 1536), reemplazar:

```js
async function prepararAviso(org, signalId, { sesion = null } = {}) {
  const signal = await groupSignals.obtenerPorId(org.id, signalId);
  if (!signal) return { resultado: "no_encontrada" };
  const grupo = await whatsappGroups.obtenerGrupo(org.id, signal.group_id).catch(() => null);
```

por:

```js
async function prepararAviso(org, signalId, { sesion = null } = {}) {
  const signal = await groupSignals.obtenerPorId(org.id, signalId);
  if (!signal) return { resultado: "no_encontrada" };
  const grupo = await whatsappGroups.obtenerGrupo(org.id, signal.group_id).catch(() => null);
  // Mismo criterio que responderPorDmManual: si no viene una sesion ya
  // resuelta, se resuelve sola con la preferida vista en el grupo.
  const sesionResuelta = sesion || await whatsappGroups.lineaDeSalida(org, signal.group_id, {}).catch(() => null);
```

Y en la línea siguiente (antes `const telefonoColega = ... { sesion, jid: ... }`), cambiar `sesion` por `sesionResuelta`.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `node --test test/group-vivo.test.js`
Expected: PASS

- [ ] **Step 6: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/groups/vivo.js test/group-vivo.test.js
git commit -m "feat(radar): responderPorDmManual y prepararAviso resuelven su propia linea

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `crm.js` deja de exigir "exactamente una activa"

**Files:**
- Modify: `src/api/crm.js:767-786` (`/api/grupos/senal/responder-dm`), `src/api/crm.js:420-440` (`/api/grupos/aviso/ver`)
- Test: buscar con `grep -rl "senal/responder-dm\|aviso/ver" test/*.js`

**Interfaces:**
- Consumes: `vivo.responderPorDmManual(org, signalId, { refs })` y `vivo.prepararAviso(org, signal.id, {})` sin pasar `sesion` (Task 7 ya la resuelve sola).

- [ ] **Step 1: Ubicar los tests existentes**

Run: `grep -rl "senal/responder-dm\|aviso/ver" test/*.js`

Leer el archivo encontrado para copiar el patrón de request (supertest/app) antes de editar.

- [ ] **Step 2: Editar/escribir los tests**

Reemplazar cualquier test que arme 0 o 2+ sesiones activas y espere `409` por uno que mockea `vivo.responderPorDmManual` devolviendo `{ resultado: "sin_sesion" }` y espera `200` con ese resultado en el body:

```js
test("POST /api/grupos/senal/responder-dm: con dos lineas activas, ya no responde 409", async (t) => {
  t.mock.method(whatsappGroups, "listSessions", async () => [
    { nombre: "DaianaDiamond", estado: "activa" },
    { nombre: "RADA-NATALIA", estado: "activa" },
  ]);
  t.mock.method(vivo, "responderPorDmManual", async (org, signalId, opts) => {
    assert.strictEqual(opts.sesion, undefined); // el endpoint ya no la resuelve el mismo
    return { resultado: "dm_enviado", wamid: "w1" };
  });

  const res = await request(app).post("/api/grupos/senal/responder-dm").send({ signalId: "signal-1" });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.resultado, "dm_enviado");
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `node --test <archivo>`
Expected: FAIL — el endpoint hoy responde 409 con dos activas.

- [ ] **Step 4: Implementar**

En `src/api/crm.js`, reemplazar el handler de `/api/grupos/senal/responder-dm` (línea 767-786):

```js
router.post("/api/grupos/senal/responder-dm", async (req, res) => {
  const { signalId, refs } = req.body || {};
  if (!signalId) return res.status(400).json({ error: "Falta signalId" });
  try {
    const org = await organizations.getDefault();
    const vivo = require("../groups/vivo");
    // DOS LINEAS CONVIVEN (2026-09-10): responderPorDmManual resuelve su
    // propia linea con whatsappGroups.lineaDeSalida (la preferida vista en
    // el grupo de esta senal) -- este endpoint ya no exige "exactamente una
    // activa" ni la resuelve el mismo.
    const r = await vivo.responderPorDmManual(org, signalId, { refs: refs ?? null });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

Y en `/api/grupos/aviso/ver` (línea 420-440), quitar la resolución manual de `sesion`:

```js
router.post("/api/grupos/aviso/ver", async (req, res) => {
  const groupSignals = require("../data/group-signals");
  const vivo = require("../groups/vivo");
  const token = String(req.body?.token || "").trim();
  const signal = token ? await groupSignals.obtenerPorToken(token) : null;
  if (!signal) return res.status(404).json({ error: "Este link no existe o venció" });
  try {
    const org = await organizations.findById(signal.org_id);
    if (!org) return res.status(404).json({ error: "Organizacion no encontrada" });
    // prepararAviso resuelve su propia linea (Task 7) -- ya no hace falta
    // traerla aca.
    const datos = await vivo.prepararAviso(org, signal.id, {});
    if (datos.resultado !== "ok") return res.status(404).json({ error: datos.resultado });
    const vistoAhora = await groupSignals.marcarVisto(org.id, signal.id);
    res.json({ ...datos, visto_ahora: vistoAhora, org: { name: org.name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `node --test <archivo>`
Expected: PASS

- [ ] **Step 6: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/api/crm.js test/<archivo>
git commit -m "fix(radar): responder-dm y aviso/ver dejan de exigir una sola sesion activa

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `ventana-asesora.js` usa el resolver

**Files:**
- Modify: `src/scheduler/ventana-asesora.js:51-57`
- Test: `test/ventana-asesora.test.js`

**Interfaces:**
- Consumes: `whatsappGroups.lineaDeSalida(org, null, {})`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/ventana-asesora.test.js` (mismo estilo que `escenario()` ya usa):

```js
test("con dos lineas activas, se usa la preferida (Daiana) para abrir la ventana", async (t) => {
  const envios = [];
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => NATALIA);
  t.mock.method(whatsappGroups, "listSessions", async () => [
    { nombre: "DaianaDiamond", estado: "activa", advisor_id: NATALIA.id },
    { nombre: "RADA-NATALIA", estado: "activa", advisor_id: "otro-asesor" },
  ]);
  t.mock.method(waha, "estadoSesion", async (sesion) => ({ status: "WORKING", me: { id: sesion === "DaianaDiamond" ? "573001878024@c.us" : "otro@c.us" } }));
  t.mock.method(waha, "cuotaDeLinea", async () => null);
  t.mock.method(leads, "findOrCreate", async () => ({ id: "lead-natalia" }));
  t.mock.method(conversations, "findOrCreate", async () => ({ id: "conv-natalia" }));
  t.mock.method(conversations, "hayMensajeEntranteDespues", async () => false);
  t.mock.method(waha, "enviarDm", async (sesion, telefono, texto) => {
    envios.push(sesion);
    return { ok: true, wamid: "w1" };
  });

  const r = await ventana.runOnce();

  assert.strictEqual(r.sent, 1);
  assert.strictEqual(envios[0], "DaianaDiamond");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/ventana-asesora.test.js`
Expected: FAIL — `sesionActiva` hoy devuelve `null` con dos activas (`activas.length !== 1`), así que el resultado es `sin_sesion`, no `enviado`.

- [ ] **Step 3: Implementar**

En `src/scheduler/ventana-asesora.js`, reemplazar `sesionActiva` (líneas 51-57):

```js
// DOS LINEAS CONVIVEN (2026-09-10): en vez de exigir "exactamente una
// activa" y fallar con `sin_sesion` cuando hay dos, se usa el resolver unico
// (whatsappGroups.lineaDeSalida) -- sin groupId, porque este worker no nace
// de un mensaje de grupo: prefiere la sesion de la asesora, y si no hay
// preferida, cualquier otra activa. La guarda de mas abajo (lineaEsDeLaAsesora)
// sigue verificando contra el `me.id` real de WAHA antes de mandar nada.
async function sesionActiva(orgId, org) {
  return whatsappGroups.lineaDeSalida(org, null, {});
}
```

y actualizar su único llamador, en `runParaOrg` (línea 96):

```js
  const sesion = await sesionActiva(org.id, org).catch(() => null);
```

(Se agrega el parámetro `org` porque `lineaDeSalida` necesita el objeto completo, no solo el id, para llamar a `advisors.findAsesorPrincipalRadar`.)

- [ ] **Step 4: Correr y verificar que pasan**

Run: `node --test test/ventana-asesora.test.js`
Expected: PASS (todos, incluidos los preexistentes — con una sola sesión activa, `lineaDeSalida(org, null, {})` sigue devolviendo esa sesión).

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/scheduler/ventana-asesora.js test/ventana-asesora.test.js
git commit -m "fix(radar): ventana-asesora usa la linea preferida en vez de exigir una sola activa

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Los últimos "primera activa" — citas, avisos-salida, radar-directorio, estado y probar-dm

**Files:**
- Modify: `src/api/crm.js:812-828` (`/api/citas/cancelar`), `src/api/crm.js:834-850` (`/api/citas/reprogramar`)
- Modify: `src/scheduler/avisos-salida.js:204-206`
- Modify: `src/scheduler/radar-directorio.js:63-77` (`calentarOrg`)
- Modify: `src/channels/whatsapp-group.js:446-479` (`GET /webhook/grupos/estado`)
- Modify: `src/api/crm.js:489-510` (`POST /api/grupos/probar-dm`)
- Test: `test/cancelar-cita-endpoint.test.js`, y el archivo que cubra `avisos-salida.js`/`radar-directorio.js` si existe (`grep -rl "avisos-salida\|radar-directorio" test/*.js`).

**Interfaces:**
- Consumes: `whatsappGroups.lineaDeSalida(org, null, {})` (sin groupId: ninguno de estos tres callers nace de un mensaje de grupo).

- [ ] **Step 1: Escribir el test que falla para citas**

En `test/cancelar-cita-endpoint.test.js`, agregar:

```js
test("POST /api/citas/cancelar: con dos lineas activas, usa la preferida para el respaldo por WAHA", async (t) => {
  const usadas = [];
  t.mock.method(whatsappGroups, "lineaDeSalida", async (org, groupId) => {
    assert.strictEqual(groupId, null);
    return "DaianaDiamond";
  });
  t.mock.method(cancelarCita, "cancelar", async (org, leadId, opts) => {
    usadas.push(opts.sesion);
    return { ok: true, resultado: "cancelada", aviso: "oficial" };
  });

  await request(app).post("/api/citas/cancelar").send({ leadId: "lead-1" });

  assert.strictEqual(usadas[0], "DaianaDiamond");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test test/cancelar-cita-endpoint.test.js`
Expected: FAIL — el endpoint hoy arma `sesion` con `sesiones.find(...) || (sesiones.length === 1 ? ... : null)`, no con `lineaDeSalida`.

- [ ] **Step 3: Implementar — citas**

En `src/api/crm.js`, reemplazar en `/api/citas/cancelar` (línea 817-821):

```js
    const org = await organizations.getDefault();
    const sesionSalida = await whatsappGroups.lineaDeSalida(org, null, {}).catch(() => null);
    const r = await require("../groups/cancelar-cita").cancelar(org, leadId, {
      motivo: motivo || null,
      sesion: sesionSalida,
    });
```

Y lo mismo en `/api/citas/reprogramar` (línea 838-844):

```js
    const org = await organizations.getDefault();
    const sesionSalida = await whatsappGroups.lineaDeSalida(org, null, {}).catch(() => null);
    const r = await require("../groups/cancelar-cita").reprogramar(org, leadId, {
      nuevaFechaHora,
      motivo: motivo || null,
      sesion: sesionSalida,
    });
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test test/cancelar-cita-endpoint.test.js`
Expected: PASS

- [ ] **Step 5: Implementar — avisos-salida.js**

En `src/scheduler/avisos-salida.js`, reemplazar (línea 204-206):

```js
  const grupos = new Map((await whatsappGroups.listGroups(org.id).catch(() => [])).map((g) => [g.id, g]));
  const sesion = await whatsappGroups.lineaDeSalida(org, null, {}).catch(() => null);
```

- [ ] **Step 6: Implementar — radar-directorio.js**

En `src/scheduler/radar-directorio.js`, reemplazar `calentarOrg` (línea 63-77):

```js
async function calentarOrg(org) {
  const sesiones = await whatsappGroups.listSessions(org.id).catch(() => []);
  // Se prefiere la preferida (whatsappGroups.lineaDeSalida), pero con UNA
  // sola sesion vinculada se usa esa igual aunque no este marcada activa
  // (2026-09-02): la columna `estado` puede quedar desactualizada, y
  // calentar el indice solo LEE listas de participantes, no manda nada, asi
  // que fallar cerrado aca no protege de nada y deja el DM automatico sin
  // telefonos. El envio si sigue exigiendo sesion activa donde corresponde
  // (vivo.js#aprobarManual, via lineaDeSalida).
  const preferida = await whatsappGroups.lineaDeSalida(org, null, {}).catch(() => null);
  const activa = preferida
    ? sesiones.find((s) => s.nombre === preferida)
    : sesiones.length === 1
    ? sesiones[0]
    : null;
  if (!activa) {
    if (sesiones.length > 1) {
      console.warn(`[directorio] ${sesiones.length} sesiones y ninguna activa: no se calienta (seria adivinar por cual).`);
    }
    return null;
  }
```

(El resto de la función no cambia.)

- [ ] **Step 7: Implementar — `GET /webhook/grupos/estado`**

En `src/channels/whatsapp-group.js`, reemplazar (línea 453-455):

```js
  const sesiones = org ? await whatsappGroups.listSessions(org.id).catch(() => []) : [];
  const activas = sesiones.filter((s) => s.estado === "activa");
  const sesionActiva = activas.length === 1 ? activas[0].nombre : null;
```

por:

```js
  // DOS LINEAS CONVIVEN (2026-09-10): antes exigia "exactamente una activa"
  // para poder decir de que linea es la cuota de WhatsApp; con el resolver,
  // la cuota que importa es la de la linea PREFERIDA (la que de verdad va a
  // mandar los DM), no cualquiera de las que esten activas.
  const sesionActiva = org ? await whatsappGroups.lineaDeSalida(org, null, {}).catch(() => null) : null;
```

(El resto del handler, que usa `sesionActiva` para `cuotaWhatsapp`, no cambia.)

- [ ] **Step 8: Implementar — `POST /api/grupos/probar-dm`**

En `src/api/crm.js`, reemplazar (línea 495-505):

```js
    const org = await organizations.getDefault();
    const sesiones = await whatsappGroups.listSessions(org.id);
    if (!sesiones.length) return res.status(404).json({ error: "No hay sesion vinculada" });

    const texto = ...

    const envio = await waha.enviarDm(sesiones[0].nombre, destino, texto, { orgId: org.id });
    res.json({ destino: `***${destino.slice(-4)}`, sesion: sesiones[0].nombre, ...envio });
```

por:

```js
    const org = await organizations.getDefault();
    const sesionSalida = await whatsappGroups.lineaDeSalida(org, null, {}).catch(() => null);
    if (!sesionSalida) return res.status(404).json({ error: "No hay sesion vinculada" });

    const texto =
      typeof req.body?.texto === "string" && req.body.texto.trim()
        ? req.body.texto.trim()
        : "Prueba del radar: este es un mensaje directo enviado por la linea del radar. " +
          "Si lo estas leyendo, el DM al colega funciona.";

    const envio = await waha.enviarDm(sesionSalida, destino, texto, { orgId: org.id });
    res.json({ destino: `***${destino.slice(-4)}`, sesion: sesionSalida, ...envio });
```

- [ ] **Step 9: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/api/crm.js src/scheduler/avisos-salida.js src/scheduler/radar-directorio.js src/channels/whatsapp-group.js test/cancelar-cita-endpoint.test.js
git commit -m "fix(radar): citas, avisos-salida, el calentador, /estado y probar-dm usan la linea preferida

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Fuera de alcance (a propósito)

- **`src/scheduler/radar-recordatorio.js`** — la spec menciona que el recordatorio de 2h "sale por la misma línea", pero ese worker está apagado desde el 2026-09-06 (`RADAR_RECORDATORIO_ENABLED=false`), reemplazado por `cierre-dia`. No se toca código muerto; si se reactiva algún día, hay que revisar entonces si necesita `lineaDeSalida`.
- **`/api/grupos/diagnostico-directorio`, `/api/grupos/diagnostico-lids`, `/api/grupos/waha/diagnostico`, `/api/grupos/waha/prueba-lid`** (`crm.js`) — endpoints de solo diagnóstico manual, no tocan el camino real de envío a un colega. Toman `sesiones[0]` a ciegas hoy; con dos líneas eso puede mostrar el diagnóstico de la línea equivocada, pero no rompe nada en producción. Se puede resolver en una pasada aparte si llega a confundir a alguien mirando esos endpoints.

## Cierre

- [ ] **Verificación final:** `npm test` completo en verde, `npm run lint` si el proyecto lo tiene configurado (chequear `package.json`).
- [ ] **No desplegar todavía sin que Juan corra la migración de la Task 1 contra producción y la verifique por REST** — mismo protocolo que todas las migraciones anteriores de este repo.
- [ ] **Orden operativo (de la spec, sección 4):** una vez desplegado esto, recién ahí Natalia (o quien tenga esa línea) escanea el QR de `RADA-NATALIA` desde el CRM para dejarla activa junto a `DaianaDiamond`.

# Radar — Link en el aviso (Bloque 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada aviso a la asesora lleva un link único; abrirlo registra `visto`, adentro está el pedido, las fichas y el mensaje listo, y el botón de envío registra `gestionado`. En `/grupos`, "por revisar" se reemplaza por **Vistos** y **Gestionados**.

**Architecture:** El bot (Node/Express, `src/`) es dueño del dato y de la lógica: genera el token, arma la página (mismas piezas que el DM manual) y expone dos endpoints por token. El CRM (Next.js, `crm/`) tiene una ruta pública `/aviso/[token]` que es un renderer fino: llama al bot con la API key server-side y pinta. Nada nuevo toca WhatsApp: el link va inline en el texto del aviso que ya sale.

**Tech Stack:** Node 20 + Express 5 (CommonJS, `node --test`), Supabase (Postgres), Next.js 15 + React 19 + Tailwind 4, WhatsApp Cloud API (texto con link; sin botón CTA en este bloque).

## Global Constraints

- **El mensaje va SIEMPRE al DM del colega, nunca al grupo.** El link `wa.me` solo se usa con número resuelto; sin número, el botón copia el texto y abre WhatsApp para que ella toque el nombre del colega (el grupo es donde lo encuentra, no a dónde escribe).
- **Multi-tenant:** el token resuelve la org solo; `CRM_PUBLIC_URL` es la única env var nueva y sin ella el aviso sale igual, sin link.
- **Degrada limpio sin la migración:** `asegurarToken` devuelve `null` y todo sigue como hoy.
- Spec: `docs/superpowers/specs/2026-09-02-radar-que-paso-despues-del-aviso.md` (opción D, bloques 1 y 2). Mockup aprobado 2026-09-02.
- Commits en español con prefijo; tests con `node --test`; `npm test` en verde antes de cada commit.

---

## File map

| Archivo | Responsabilidad |
|---|---|
| `db/migrations/2026-09-03_aviso_link.sql` | `group_signals.aviso_token`, `visto_at`, `gestionado_at`, `gestion` + índice único |
| `src/lib/link-aviso.js` | `urlDeAviso(token)` a partir de `CRM_PUBLIC_URL`; `null` si no está |
| `src/data/group-signals.js` | `asegurarToken`, `obtenerPorToken`, `marcarVisto`, `marcarGestion` (memoria + Supabase) |
| `src/groups/alerta-asesor.js` | `construir(..., { link })` agrega la línea "👉 Ver la oportunidad" |
| `src/groups/digest-avisos.js` | `lineaPedido` muestra `p.link` |
| `src/groups/vivo.js` | token antes del aviso; `prepararAviso(org, signalId)` para la página |
| `src/scheduler/avisos-salida.js` | token y link en el aviso único y en el digest |
| `src/api/crm.js` | `POST /api/grupos/aviso/ver`, `POST /api/grupos/aviso/gestion` |
| `crm/middleware.ts` | `/aviso` público |
| `crm/app/aviso/[token]/page.tsx` | server component: llama al bot y pinta |
| `crm/components/aviso-celular.tsx` | client: botones, `wa.me` / portapapeles, registra gestión |
| `crm/app/api/aviso/gestion/route.ts` | proxy sin sesión → bot |
| `crm/app/(dashboard)/grupos/page.tsx` + `crm/components/dashboard-matches.tsx` | KPIs Vistos / Gestionados |

---

### Task 1: Migración, token y estados en la señal

**Files:**
- Create: `db/migrations/2026-09-03_aviso_link.sql`
- Create: `src/lib/link-aviso.js`
- Modify: `src/data/group-signals.js` (antes de `module.exports`)
- Test: `test/aviso-link.test.js`

**Interfaces:**
- Produces: `groupSignals.asegurarToken(orgId, signalId) → Promise<string|null>` (idempotente: devuelve el existente); `groupSignals.obtenerPorToken(token) → Promise<signal|null>` (trae `org_id`); `groupSignals.marcarVisto(orgId, signalId) → Promise<boolean>` (solo la primera vez escribe); `groupSignals.marcarGestion(orgId, signalId, gestion) → Promise<boolean>` con `gestion ∈ {"envio","no_sirve"}`; `linkAviso.urlDeAviso(token) → string|null`.

- [ ] **Step 1: Migración**

```sql
-- db/migrations/2026-09-03_aviso_link.sql
-- El link en el aviso a la asesora (Juan, 2026-09-02, opcion D del spec
-- docs/superpowers/specs/2026-09-02-radar-que-paso-despues-del-aviso.md).
--
-- POR QUE: "por revisar" media clics en el CRM que nadie hace (212 de 213).
-- Abrir el link es el dato; tocar el boton de envio es la gestion. Reemplaza
-- esa medida por dos reales: vistos y gestionados.
--
-- Sin correrla, el bot funciona igual: asegurarToken devuelve null y el aviso
-- sale sin link. Correr a mano en Supabase. Idempotente.
alter table group_signals add column if not exists aviso_token text;
alter table group_signals add column if not exists visto_at timestamptz;
alter table group_signals add column if not exists gestionado_at timestamptz;
alter table group_signals add column if not exists gestion text;
create unique index if not exists idx_group_signals_aviso_token
  on group_signals(aviso_token) where aviso_token is not null;
comment on column group_signals.gestion is 'envio = toco el boton de mandar · no_sirve = lo descarto desde la pagina';
```

- [ ] **Step 2: Test que falla**

```js
// test/aviso-link.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const groupSignals = require("../src/data/group-signals");
const linkAviso = require("../src/lib/link-aviso");

const ORG = "org-1";
beforeEach(() => {
  memory.groupSignals.length = 0;
  memory.groupSignals.push({ id: "s1", org_id: ORG, clase: "demanda", matches: [] });
  delete process.env.CRM_PUBLIC_URL;
});

test("asegurarToken crea uno y despues devuelve el mismo", async () => {
  const a = await groupSignals.asegurarToken(ORG, "s1");
  const b = await groupSignals.asegurarToken(ORG, "s1");
  assert.ok(a && a.length >= 24);
  assert.strictEqual(a, b);
});

test("obtenerPorToken trae la señal con su org", async () => {
  const t = await groupSignals.asegurarToken(ORG, "s1");
  const s = await groupSignals.obtenerPorToken(t);
  assert.strictEqual(s.id, "s1");
  assert.strictEqual(s.org_id, ORG);
  assert.strictEqual(await groupSignals.obtenerPorToken("no-existe"), null);
});

test("marcarVisto escribe solo la primera vez", async () => {
  assert.strictEqual(await groupSignals.marcarVisto(ORG, "s1"), true);
  const primera = memory.groupSignals[0].visto_at;
  assert.strictEqual(await groupSignals.marcarVisto(ORG, "s1"), false);
  assert.strictEqual(memory.groupSignals[0].visto_at, primera);
});

test("marcarGestion guarda envio o no_sirve y rechaza otra cosa", async () => {
  assert.strictEqual(await groupSignals.marcarGestion(ORG, "s1", "envio"), true);
  assert.strictEqual(memory.groupSignals[0].gestion, "envio");
  assert.ok(memory.groupSignals[0].gestionado_at);
  await assert.rejects(() => groupSignals.marcarGestion(ORG, "s1", "otra"));
});

test("urlDeAviso: sin CRM_PUBLIC_URL no hay link; con ella, /aviso/<token>", () => {
  assert.strictEqual(linkAviso.urlDeAviso("abc"), null);
  process.env.CRM_PUBLIC_URL = "https://crm.ejemplo.com/";
  assert.strictEqual(linkAviso.urlDeAviso("abc"), "https://crm.ejemplo.com/aviso/abc");
  assert.strictEqual(linkAviso.urlDeAviso(null), null);
});
```

- [ ] **Step 3: Correr y ver fallar**

Run: `node --test test/aviso-link.test.js`
Expected: FAIL — `groupSignals.asegurarToken is not a function`.

- [ ] **Step 4: `src/lib/link-aviso.js`**

```js
// La URL que abre la asesora desde el aviso (Juan, 2026-09-02, opcion D).
// Una sola env var: CRM_PUBLIC_URL (ej. https://crm.diamondinmobiliaria.com).
// Sin ella no hay link y el aviso sale como hoy — se dice en el informe de
// arranque (src/lib/arranque.js), no se inventa un dominio.
function urlDeAviso(token) {
  const base = String(process.env.CRM_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!base || !token) return null;
  return `${base}/aviso/${encodeURIComponent(token)}`;
}
module.exports = { urlDeAviso };
```

- [ ] **Step 5: Funciones en `src/data/group-signals.js`** (antes de `module.exports`; agregar `const crypto = require("node:crypto");` arriba)

```js
// ── El link del aviso (Juan, 2026-09-02, opcion D) ─────────────────────
// Token irrepetible por señal. Idempotente: si ya tiene, devuelve el mismo
// (el digest y el aviso unico pueden pedirlo los dos). Sin la migracion
// 2026-09-03_aviso_link.sql devuelve null y el aviso sale sin link.
async function asegurarToken(orgId, signalId) {
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.org_id === orgId && x.id === signalId);
    if (!s) return null;
    if (!s.aviso_token) s.aviso_token = crypto.randomBytes(24).toString("base64url");
    return s.aviso_token;
  }
  const { data: actual } = await supabase.from("group_signals").select("aviso_token").eq("org_id", orgId).eq("id", signalId).maybeSingle();
  if (actual && actual.aviso_token) return actual.aviso_token;
  const token = crypto.randomBytes(24).toString("base64url");
  const { error } = await supabase.from("group_signals").update({ aviso_token: token }).eq("org_id", orgId).eq("id", signalId);
  if (error) {
    if (esColumnaFaltante(error)) console.warn("[grupos] Falta 2026-09-03_aviso_link.sql: el aviso sale sin link.");
    else console.warn("[grupos] No se pudo guardar el token del aviso:", error.message);
    return null;
  }
  return token;
}

async function obtenerPorToken(token) {
  if (!token) return null;
  if (!supabase) return memory.groupSignals.find((x) => x.aviso_token === token) || null;
  const { data, error } = await supabase.from("group_signals").select("*").eq("aviso_token", token).maybeSingle();
  if (error) return null;
  return data || null;
}

// Solo la PRIMERA apertura escribe: "visto" es un hecho, no un contador.
async function marcarVisto(orgId, signalId) {
  const ahora = new Date().toISOString();
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.org_id === orgId && x.id === signalId);
    if (!s || s.visto_at) return false;
    s.visto_at = ahora;
    return true;
  }
  const { data, error } = await supabase.from("group_signals").update({ visto_at: ahora })
    .eq("org_id", orgId).eq("id", signalId).is("visto_at", null).select("id");
  if (error) { console.warn("[grupos] No se pudo marcar visto:", error.message); return false; }
  return Boolean(data && data.length);
}

const GESTIONES = ["envio", "no_sirve"];
async function marcarGestion(orgId, signalId, gestion) {
  if (!GESTIONES.includes(gestion)) throw new Error(`Gestion invalida: ${gestion}`);
  const ahora = new Date().toISOString();
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.org_id === orgId && x.id === signalId);
    if (!s) return false;
    s.gestionado_at = ahora; s.gestion = gestion;
    return true;
  }
  const { error } = await supabase.from("group_signals").update({ gestionado_at: ahora, gestion, updated_at: ahora })
    .eq("org_id", orgId).eq("id", signalId);
  if (error) { console.warn("[grupos] No se pudo marcar la gestion:", error.message); return false; }
  return true;
}
```

Y en `module.exports` sumar: `asegurarToken, obtenerPorToken, marcarVisto, marcarGestion`.

- [ ] **Step 6: Correr y ver pasar**

Run: `node --test test/aviso-link.test.js` → 5 pass. Luego `npm test` → todo en verde.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/2026-09-03_aviso_link.sql src/lib/link-aviso.js src/data/group-signals.js test/aviso-link.test.js
git commit -m "feat(radar): token, visto y gestion por señal para el link del aviso"
```

---

### Task 2: El link viaja en el aviso (único y agrupado)

**Files:**
- Modify: `src/groups/alerta-asesor.js` (firma de `construir`, línea ~201; `cabecera`, ~224)
- Modify: `src/groups/digest-avisos.js` (`lineaPedido`, ~57)
- Modify: `src/groups/vivo.js` (llamada a `alertaAsesor.construir`, ~530-558)
- Modify: `src/scheduler/avisos-salida.js` (`textoDePedido` ~64-90; `pedidos.map` ~147-158)
- Test: `test/aviso-link-en-texto.test.js`

**Interfaces:**
- Consumes: `groupSignals.asegurarToken`, `linkAviso.urlDeAviso` (Task 1).
- Produces: `alertaAsesor.construir(senal, veredicto, matches, telefonoColega, org, motivoDm, { link } = {})`; `digest.construir(nombre, pedidos, ofertas)` donde cada pedido puede traer `link`.

- [ ] **Step 1: Test que falla**

```js
// test/aviso-link-en-texto.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const alerta = require("../src/groups/alerta-asesor");
const digest = require("../src/groups/digest-avisos");

const senal = { grupo_nombre: "PEDIDOS", autor_nombre: "Julieth", autor_telefono: "262396832686143", texto_original: "Busco apto" };
const matches = [{ ref: "9935585", titulo: "Fontanar", zona: "El Poblado", precio: "$1.250.000.000", operacion: "Venta", puntaje: 95 }];
const aprobado = { sirve_alguna: true, refs_utiles: ["9935585"], refs_dudosas: [], por_que: "Cumple." };

test("el aviso unico lleva el link arriba, antes del pedido", () => {
  const t = alerta.construir(senal, aprobado, matches, null, { id: "org-1" }, "sin_telefono", { link: "https://crm.x/aviso/abc" });
  const iLink = t.indexOf("👉 Ver la oportunidad: https://crm.x/aviso/abc");
  const iPedido = t.indexOf("Lo escribió así:") >= 0 ? t.indexOf("Lo escribió así:") : t.indexOf("Pidió:");
  assert.ok(iLink > 0 && iLink < iPedido, t);
});

test("sin link, el aviso es el de siempre", () => {
  const t = alerta.construir(senal, aprobado, matches, null, { id: "org-1" }, "sin_telefono");
  assert.ok(!t.includes("Ver la oportunidad"));
});

test("el digest muestra un link por pedido", () => {
  const t = digest.construir("Natalia", [
    { id: "s1", colega: "Julieth", operacion: "venta", tipo: "apartamento", zona: "El Poblado", utiles: 1, dudosas: 0, motivo: "sin_telefono", link: "https://crm.x/aviso/abc" },
    { id: "s2", colega: "Diego", operacion: "venta", tipo: "apartamento", zona: "Calasanz", utiles: 2, dudosas: 0, motivo: "limite_colega_alcanzado" },
  ], []);
  assert.ok(t.includes("👉 https://crm.x/aviso/abc"), t);
  assert.strictEqual((t.match(/👉/g) || []).length, 1, "solo el que tiene link");
});
```

Run: `node --test test/aviso-link-en-texto.test.js` → FAIL (no aparece el link).

- [ ] **Step 2: `alerta-asesor.js`** — firma y cabecera

```js
function construir(senal, veredicto, matches, telefonoColega = null, org = null, motivoDm = null, { link = null } = {}) {
```

En `cabecera`, justo después de la línea `Contacto: ...` y antes de `...(porque ? ...)`:

```js
    // El link (Juan, 2026-09-02, opcion D): arriba, antes del pedido, para
    // que sea lo primero que toca. Lo esencial sigue inline: si un dia no le
    // abre, no pierde el negocio por una metrica.
    ...(link ? [``, `👉 Ver la oportunidad: ${link}`] : []),
```

- [ ] **Step 3: `digest-avisos.js`** — en `lineaPedido`, reemplazar el `return`:

```js
  const base = `${i}. ${p.colega || "un colega"} — ${que || "sin detalle"}\n   ${cuantas}${porque ? ` · ${porque}` : ""}`;
  return p.link ? `${base}\n   👉 ${p.link}` : base;
```

- [ ] **Step 4: `vivo.js`** — antes de `const texto = alertaAsesor.construir(` (≈línea 530), agregar:

```js
  // El link del aviso (Juan, 2026-09-02, opcion D). Sin migracion o sin
  // CRM_PUBLIC_URL queda null y el aviso sale como hoy.
  const linkAviso = require("../lib/link-aviso").urlDeAviso(await groupSignals.asegurarToken(org.id, signal.id));
```

y en la llamada, después de `decisionDm.motivo`, agregar el 7º argumento: `{ link: linkAviso }`.

- [ ] **Step 5: `avisos-salida.js`** — en `textoDePedido`, antes del `return alertaAsesor.construir(`:

```js
  const link = require("../lib/link-aviso").urlDeAviso(await groupSignals.asegurarToken(org.id, senal.id));
```

y cerrar la llamada con `..., s.politica_motivo, { link })` (verificar cuál es el 6º argumento actual en ese archivo y respetarlo). En el digest, dentro de `pedidos.map((s) => ({ ... }))`, el map pasa a ser `async` con `Promise.all`:

```js
      pedidos: await Promise.all(pedidos.map(async (s) => ({
        id: s.id,
        colega: s.autor_nombre,
        // ...campos existentes sin cambios...
        motivo: s.politica_motivo,
        link: require("../lib/link-aviso").urlDeAviso(await groupSignals.asegurarToken(org.id, s.id)),
      }))),
```

(`digest.construir(nombre, pedidos, ofertas)` recibe el array ya resuelto; ajustar la llamada para pasar el resultado del `Promise.all`.)

- [ ] **Step 6: Correr**

`node --test test/aviso-link-en-texto.test.js` → 3 pass. `npm test` → verde (los tests de `avisos-salida` y `group-vivo` mockean `group-signals`; si alguno no expone `asegurarToken`, sumarlo al mock devolviendo `null`).

- [ ] **Step 7: Commit**

```bash
git add src/groups/alerta-asesor.js src/groups/digest-avisos.js src/groups/vivo.js src/scheduler/avisos-salida.js test/aviso-link-en-texto.test.js test/
git commit -m "feat(radar): el aviso a la asesora lleva el link a la pagina del pedido"
```

---

### Task 3: Endpoints por token: ver y gestionar

**Files:**
- Modify: `src/groups/vivo.js` (nueva `prepararAviso`, exportarla)
- Modify: `src/api/crm.js` (dos rutas, junto a `/api/grupos/senal/responder-dm`)
- Test: `test/aviso-endpoint.test.js`

**Interfaces:**
- Produces: `vivo.prepararAviso(org, signalId, { sesion }) → { resultado: "ok"|"no_encontrada", senal: {id, autor_nombre, grupo_nombre, texto_original, created_at, revalidacion, visto_at, gestionado_at, gestion}, utiles: match[], dudosas: match[], descartados, mensaje: string|null, telefonoColega: string|null, motivo: string|null, porque: string|null, aprobada: boolean }`.
- `POST /api/grupos/aviso/ver {token}` → 200 con lo de arriba + `visto_ahora: boolean`; 404 si el token no existe.
- `POST /api/grupos/aviso/gestion {token, gestion}` → 200 `{ok:true, gestion}`; 400 gestion inválida; 404 token.

- [ ] **Step 1: Test que falla**

```js
// test/aviso-endpoint.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const groupSignals = require("../src/data/group-signals");
const organizations = require("../src/data/organizations");
const whatsappGroups = require("../src/data/whatsapp-groups");
const vivo = require("../src/groups/vivo");
const router = require("../src/api/crm");

function rutaDe(path) {
  const capa = router.stack.find((c) => c.route?.path === path && c.route.methods.post);
  assert.ok(capa, `No existe POST ${path}`);
  return capa.route.stack[capa.route.stack.length - 1].handle;
}
function res() { const r = { codigo: 200, cuerpo: null }; r.status = (c) => { r.codigo = c; return r; }; r.json = (b) => { r.cuerpo = b; return r; }; return r; }

let token;
beforeEach(async () => {
  memory.groupSignals.length = 0;
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", autor_nombre: "Julieth", texto_original: "Busco apto", matches: [], revalidacion: { refs_utiles: [], refs_dudosas: [] } });
  token = await groupSignals.asegurarToken("org-1", "s1");
});

test("ver: primera apertura marca visto, la segunda no", async (t) => {
  t.mock.method(organizations, "getById", async () => ({ id: "org-1", name: "Diamond" }));
  t.mock.method(whatsappGroups, "listSessions", async () => []);
  t.mock.method(vivo, "prepararAviso", async () => ({ resultado: "ok", senal: { id: "s1" }, utiles: [], dudosas: [], mensaje: null, telefonoColega: null, motivo: "sin_telefono", porque: "x", aprobada: false }));
  const r1 = res(); await rutaDe("/api/grupos/aviso/ver")({ body: { token } }, r1);
  assert.strictEqual(r1.codigo, 200); assert.strictEqual(r1.cuerpo.visto_ahora, true);
  const r2 = res(); await rutaDe("/api/grupos/aviso/ver")({ body: { token } }, r2);
  assert.strictEqual(r2.cuerpo.visto_ahora, false);
});

test("ver: token desconocido -> 404 sin tocar nada", async () => {
  const r = res(); await rutaDe("/api/grupos/aviso/ver")({ body: { token: "nope" } }, r);
  assert.strictEqual(r.codigo, 404);
});

test("gestion: envio y no_sirve se guardan; no_sirve ademas descarta la señal", async () => {
  const r = res(); await rutaDe("/api/grupos/aviso/gestion")({ body: { token, gestion: "no_sirve" } }, r);
  assert.strictEqual(r.codigo, 200);
  assert.strictEqual(memory.groupSignals[0].gestion, "no_sirve");
  assert.strictEqual(memory.groupSignals[0].estado, "descartado");
  const r2 = res(); await rutaDe("/api/grupos/aviso/gestion")({ body: { token, gestion: "otra" } }, r2);
  assert.strictEqual(r2.codigo, 400);
});
```

Run: `node --test test/aviso-endpoint.test.js` → FAIL (`No existe POST /api/grupos/aviso/ver`).

(Si `organizations.getById` no existe, usar la función que sí resuelva una org por id en `src/data/organizations.js`; si ninguna lo hace, agregar `getById(id)` con una consulta `select * eq id` y rama memoria `memory.organizations.find`.)

- [ ] **Step 2: `vivo.prepararAviso`** — después de `responderPorDmManual`, antes de `module.exports`:

```js
// Lo que ve la asesora al abrir el link del aviso (Juan, 2026-09-02, opcion
// D). Mismas piezas que responderPorDmManual —compuerta de calidad, telefono,
// texto redactado— pero SIN enviar nada: el envio lo hace ella desde su
// telefono, y la pagina solo registra que toco el boton. Nunca lanza.
async function prepararAviso(org, signalId, { sesion = null } = {}) {
  const signal = await groupSignals.obtenerPorId(org.id, signalId);
  if (!signal) return { resultado: "no_encontrada" };
  const grupo = await whatsappGroups.obtenerGrupo(org.id, signal.group_id).catch(() => null);
  const rev = signal.revalidacion || {};
  const porRef = (refs) => (refs || []).map((r) => (signal.matches || []).find((m) => String(m.ref) === String(r))).filter(Boolean);
  const inventario = await syncEstado.estadoDelInventario(org.id, {}).catch(() => ({ fresco: true }));
  const { publicables: candidatas, descartados } = publicable.filtrar(porRef(rev.refs_utiles), { syncFresco: inventario.fresco, umbral: 0 });
  const { verificadas: utiles, rotas } = await verificarLink.verificar(candidatas).catch(() => ({ verificadas: candidatas, rotas: [] }));
  for (const r of rotas) descartados.push({ ref: r.ref, motivos: ["link_no_abre"] });
  const telefonoColega = await directorio.telefonoDe(org.id, signal.autor_telefono, { sesion, jid: grupo && grupo.jid }).catch(() => null);
  const mensaje = utiles.length
    ? redactar.mensajeGrupo({ autor_nombre: signal.autor_nombre }, utiles, { org, sinConfirmar: rev.sin_confirmar || [], leFalta: rev.le_falta || [] })
    : null;
  const aprobada = utiles.length > 0;
  return {
    resultado: "ok",
    senal: {
      id: signal.id, autor_nombre: signal.autor_nombre, grupo_nombre: (grupo && (grupo.nombre || grupo.jid)) || null,
      texto_original: signal.texto_original, created_at: signal.created_at, operacion: signal.operacion, tipo: signal.tipo,
      zona: signal.zona, zonas: signal.zonas, precio_max: signal.precio_max, habitaciones: signal.habitaciones,
      garajes: signal.garajes, area_min: signal.area_min, sin_confirmar: rev.sin_confirmar || [],
      visto_at: signal.visto_at || null, gestionado_at: signal.gestionado_at || null, gestion: signal.gestion || null,
      respondida_at: signal.respondida_at || null,
    },
    utiles, dudosas: porRef(rev.refs_dudosas), descartados, mensaje, telefonoColega,
    motivo: signal.politica_motivo || null,
    porque: alertaAsesor.porqueNoSalioSolo(signal.politica_motivo, aprobada),
    aprobada,
  };
}
```

Sumar `prepararAviso` a `module.exports`. Verificar que `alertaAsesor`, `redactar`, `publicable`, `verificarLink`, `syncEstado`, `directorio`, `whatsappGroups` ya están requeridos arriba en `vivo.js` (lo están: los usa `responderPorDmManual`).

- [ ] **Step 3: Rutas en `src/api/crm.js`** — junto a `/api/grupos/senal/responder-dm`:

```js
// La pagina que abre la asesora desde el aviso (Juan, 2026-09-02, opcion D).
// Por TOKEN, sin sesion de usuario: el token es irrepetible y resuelve la
// org solo. El CRM llama con la API key server-side; el navegador nunca ve
// esta ruta.
router.post("/api/grupos/aviso/ver", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const signal = token ? await groupSignals.obtenerPorToken(token) : null;
  if (!signal) return res.status(404).json({ error: "Este link no existe o venció" });
  try {
    const org = await organizations.getById(signal.org_id);
    const sesiones = await whatsappGroups.listSessions(org.id).catch(() => []);
    const sesion = (sesiones.find((s) => s.estado === "activa") || {}).nombre || null;
    const datos = await vivo.prepararAviso(org, signal.id, { sesion });
    if (datos.resultado !== "ok") return res.status(404).json({ error: datos.resultado });
    // Visto = primera apertura. Se marca DESPUES de armar la pagina: si algo
    // revienta arriba, no queda un "visto" de algo que nunca se mostro.
    const vistoAhora = await groupSignals.marcarVisto(org.id, signal.id);
    res.json({ ...datos, visto_ahora: vistoAhora, org: { name: org.name } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/grupos/aviso/gestion", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const gestion = String(req.body?.gestion || "");
  if (!["envio", "no_sirve"].includes(gestion)) return res.status(400).json({ error: "gestion debe ser envio o no_sirve" });
  const signal = token ? await groupSignals.obtenerPorToken(token) : null;
  if (!signal) return res.status(404).json({ error: "Este link no existe o venció" });
  try {
    await groupSignals.marcarGestion(signal.org_id, signal.id, gestion);
    // "No sirve" desde la pagina es el mismo descarte que desde el CRM.
    if (gestion === "no_sirve") await groupSignals.setEstado(signal.org_id, signal.id, "descartado").catch(() => {});
    res.json({ ok: true, gestion });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: Correr** — `node --test test/aviso-endpoint.test.js` → 3 pass; `npm test` → verde.

- [ ] **Step 5: Commit**

```bash
git add src/groups/vivo.js src/api/crm.js src/data/organizations.js test/aviso-endpoint.test.js
git commit -m "feat(radar): endpoints por token para ver y gestionar un aviso"
```

---

### Task 4: La página en el CRM

**Files:**
- Modify: `crm/middleware.ts` (matcher)
- Create: `crm/app/aviso/[token]/page.tsx`
- Create: `crm/components/aviso-celular.tsx`
- Create: `crm/app/api/aviso/gestion/route.ts`

**Interfaces:**
- Consumes: `POST /api/grupos/aviso/ver`, `POST /api/grupos/aviso/gestion` (Task 3) vía `callBot` de `crm/lib/bot.ts`.

- [ ] **Step 1: Middleware** — en `config.matcher`, excluir `aviso`:

```ts
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|aviso|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
```

- [ ] **Step 2: Ruta proxy `crm/app/api/aviso/gestion/route.ts`**

```ts
import { NextResponse } from "next/server";
import { callBot } from "@/lib/bot";

// Sin sesion a proposito: la pagina del aviso se abre desde WhatsApp con un
// token irrepetible, y ese token es la autorizacion. Solo acepta las dos
// gestiones que existen.
export async function POST(request: Request) {
  const { token, gestion } = await request.json().catch(() => ({}));
  if (typeof token !== "string" || !["envio", "no_sirve"].includes(gestion)) {
    return NextResponse.json({ error: "Falta token o gestion" }, { status: 400 });
  }
  const r = await callBot("/api/grupos/aviso/gestion", { token, gestion });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
```

- [ ] **Step 3: Página `crm/app/aviso/[token]/page.tsx`**

```tsx
import { callBot } from "@/lib/bot";
import AvisoCelular, { type DatosAviso } from "@/components/aviso-celular";

export const dynamic = "force-dynamic";

// Lo que abre la asesora desde el aviso de WhatsApp (Juan, 2026-09-02, opcion
// D). Sin login: el token es la autorizacion. Es un renderer fino — el bot
// arma los datos con las mismas piezas del DM manual.
export default async function AvisoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await callBot<DatosAviso>("/api/grupos/aviso/ver", { token });
  if (!r.ok) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="font-display text-xl font-extrabold text-slate-900">Este link no existe o venció</h1>
        <p className="mt-2 text-sm text-slate-600">Pedile a Sofi el aviso de nuevo, o abrilo desde el CRM.</p>
      </main>
    );
  }
  return <AvisoCelular datos={r.data as DatosAviso} token={token} />;
}
```

- [ ] **Step 4: Componente `crm/components/aviso-celular.tsx`** — reproduce el mockup aprobado. Estructura (client component):

```tsx
"use client";
import { useState } from "react";

type Match = { ref: string; titulo?: string; zona?: string; precio?: string; area?: string; habitaciones?: number; banos?: number | null; garajes?: number | null; estrato?: number | null; link?: string | null };
export type DatosAviso = {
  senal: { id: string; autor_nombre: string | null; grupo_nombre: string | null; texto_original: string; created_at: string; operacion?: string; tipo?: string; zona?: string; zonas?: string[]; precio_max?: number; habitaciones?: number; garajes?: number; area_min?: number; sin_confirmar: string[]; visto_at: string | null; gestionado_at: string | null; gestion: string | null; respondida_at: string | null };
  utiles: Match[]; dudosas: Match[]; mensaje: string | null; telefonoColega: string | null;
  motivo: string | null; porque: string | null; aprobada: boolean; visto_ahora: boolean; org: { name: string };
};

const primerNombre = (n: string | null) => (n || "").trim().split(/\s+/)[0] || "el colega";
const dato = (v: number | null | undefined, u: string) => (v === null || v === undefined ? `${u}: sin dato` : `${v} ${u}`);

export default function AvisoCelular({ datos, token }: { datos: DatosAviso; token: string }) {
  const { senal, utiles, dudosas, mensaje, telefonoColega, porque, aprobada } = datos;
  const [texto, setTexto] = useState(mensaje || "");
  const [gestion, setGestion] = useState<string | null>(senal.gestion);
  const [ocupado, setOcupado] = useState(false);

  async function registrar(g: "envio" | "no_sirve") {
    setOcupado(true);
    await fetch("/api/aviso/gestion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, gestion: g }) }).catch(() => null);
    setGestion(g);
    setOcupado(false);
  }

  // SIEMPRE al privado del colega. Con numero: wa.me abre ese chat con el
  // texto. Sin numero: se copia el texto y se abre WhatsApp; el grupo es
  // donde lo ENCUENTRA (toca su nombre), no a donde escribe.
  async function enviar() {
    await registrar("envio");
    if (telefonoColega) {
      window.location.href = `https://wa.me/${telefonoColega}?text=${encodeURIComponent(texto)}`;
      return;
    }
    try { await navigator.clipboard.writeText(texto); } catch {}
    window.location.href = `whatsapp://send?text=${encodeURIComponent(texto)}`;
  }

  const nombre = primerNombre(senal.autor_nombre);
  return (
    <main className="mx-auto min-h-dvh max-w-md bg-white pb-36 text-slate-900">
      <header className="bg-gradient-to-br from-[#0b1526] to-[#15213a] px-5 pb-4 pt-5 text-slate-100">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#f2d58a]">{aprobada ? "🚨 Aprobada por Sofi · sin salir" : "🎯 Oportunidad · para revisar"}</div>
        <h1 className="font-display mt-1 text-lg font-extrabold leading-tight">{senal.autor_nombre || "Un colega"} busca {senal.tipo || "propiedad"}{senal.zona ? ` en ${senal.zona}` : ""}</h1>
        <div className="mt-1 text-xs text-slate-300">Grupo <b className="text-white">{senal.grupo_nombre || "sin nombre"}</b></div>
        {gestion && <div className="mt-2 inline-block rounded-full border border-emerald-300/50 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200">✅ {gestion === "envio" ? "Ya le escribiste" : "Marcado: no sirve"}</div>}
      </header>

      {porque && (
        <section className="border-b border-slate-200 px-5 py-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Por qué no salió solo</p>
          <p className="rounded-r-lg border-l-4 border-amber-400 bg-slate-50 px-3 py-2 text-sm">{porque}</p>
        </section>
      )}

      <section className="border-b border-slate-200 px-5 py-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Lo que pide</p>
        <p className="whitespace-pre-line rounded-r-lg border-l-4 border-indigo-500 bg-slate-50 px-3 py-2 text-sm">{senal.texto_original}</p>
      </section>

      {utiles.length > 0 && (
        <section className="border-b border-slate-200 px-5 py-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Le sirve · {utiles.length}</p>
          {utiles.map((m) => (
            <div key={m.ref} className="border-t border-slate-100 py-2 first:border-t-0 first:pt-0">
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-sm font-semibold">{m.titulo || "Sin título"}</div><div className="font-mono text-[11px] text-slate-400">ref {m.ref}{m.link ? <> · <a className="text-indigo-600" href={m.link} target="_blank" rel="noopener noreferrer">Wasi ↗</a></> : null}</div></div>
                <div className="font-display whitespace-nowrap text-base font-bold tabular-nums">{m.precio}</div>
              </div>
              <div className="mt-1 text-xs text-slate-600">{[m.zona, m.area, m.habitaciones ? `${m.habitaciones} alcobas` : null, dato(m.banos, "baños"), dato(m.garajes, "garajes"), m.estrato ? `estrato ${m.estrato}` : "estrato: sin dato"].filter(Boolean).join(" · ")}</div>
            </div>
          ))}
          {senal.sin_confirmar.length > 0 && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900"><b>Sin confirmar:</b> {senal.sin_confirmar.join(", ")}.</p>}
        </section>
      )}

      {dudosas.length > 0 && (
        <section className="border-b border-slate-200 px-5 py-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">🔎 Para revisar · {dudosas.length}</p>
          {dudosas.map((m) => <div key={m.ref} className="py-1 text-sm">{m.titulo || m.ref} <span className="text-slate-500">· {m.precio}</span></div>)}
        </section>
      )}

      {mensaje && (
        <section className="border-b border-slate-200 px-5 py-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">El mensaje para {nombre}</p>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={9} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" />
        </section>
      )}

      <section className="px-5 py-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Cómo se la mandás</p>
        {telefonoColega ? (
          <p className="text-sm text-slate-600"><b className="text-slate-900">{senal.autor_nombre}</b> · {telefonoColega.replace(/^57/, "")}. Se abre el chat con el mensaje ya escrito; solo tocás enviar.</p>
        ) : (
          <ol className="grid gap-1 text-sm text-slate-600">
            <li>1. El botón copia el mensaje y abre WhatsApp</li>
            <li>2. Entrá a <b className="text-slate-900">{senal.grupo_nombre}</b> y tocá “{senal.autor_nombre}”</li>
            <li>3. Pegá en su chat privado y enviá</li>
          </ol>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 mx-auto grid max-w-md gap-2 border-t border-slate-200 bg-white px-4 pb-5 pt-3">
        {mensaje && (
          <button onClick={enviar} disabled={ocupado} className="rounded-2xl bg-[#25d366] px-4 py-3 text-[15px] font-bold text-[#0b3d22] disabled:opacity-60">
            {telefonoColega ? "💬 Enviar por WhatsApp" : "📋 Copiar y abrir WhatsApp"}
          </button>
        )}
        <button onClick={() => registrar("no_sirve")} disabled={ocupado} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">No sirve para este colega</button>
        <p className="text-center text-[11px] text-slate-400">Al tocar el botón verde queda registrado como gestionado.</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Verificar** — `cd crm && npx tsc --noEmit && npm run build`. Con el bot local corriendo y `BOT_API_URL` apuntando a él, abrir `http://localhost:3000/aviso/<token de una señal real>` en el navegador en modo móvil (390px): la página carga sin login, muestra el pedido y las fichas, y el botón verde abre `wa.me` (con número) o copia + `whatsapp://` (sin número). En la base, `visto_at` queda escrito al abrir y `gestionado_at` al tocar.

- [ ] **Step 6: Commit**

```bash
git add crm/middleware.ts "crm/app/aviso/[token]/page.tsx" crm/components/aviso-celular.tsx crm/app/api/aviso/gestion/route.ts
git commit -m "feat(crm): pagina /aviso/[token] que abre la asesora desde el WhatsApp"
```

---

### Task 5: KPIs Vistos y Gestionados reemplazan "por revisar"

**Files:**
- Modify: `crm/app/(dashboard)/grupos/page.tsx` (bloque `countSafe` ~línea 204; props a `DashboardMatches` ~480)
- Modify: `crm/components/dashboard-matches.tsx` (Props ~24-25; Kpi "Pedidos con match" ~156-162)

- [ ] **Step 1: Conteos en `page.tsx`** — en el `Promise.all` que ya tiene `conMatchTotalRes, porRevisarRes, ...`, reemplazar la consulta `porRevisarRes` por dos:

```ts
    countSafe(
      mias(supabase.from("group_signals").select("*", { count: "exact", head: true }).eq("clase", "demanda"))
        .neq("matches", "[]").not("visto_at", "is", null),
      "grupos:vistos"
    ),
    countSafe(
      mias(supabase.from("group_signals").select("*", { count: "exact", head: true }).eq("clase", "demanda"))
        .neq("matches", "[]").not("gestionado_at", "is", null),
      "grupos:gestionados"
    ),
```

nombrarlas `vistosRes` y `gestionadosRes` en la destructuración, borrar `pendientes`, y pasar `vistos={vistosRes.hasError ? null : vistosRes.count}` y `gestionados={gestionadosRes.hasError ? null : gestionadosRes.count}` a `<DashboardMatches>` en lugar de `pedidosPorRevisar`.

- [ ] **Step 2: `dashboard-matches.tsx`** — Props: quitar `pedidosPorRevisar: number;` y sumar

```ts
  /** Avisos que la asesora abrio (visto_at) y que gestiono (gestionado_at). null = fallo la consulta. */
  vistos: number | null;
  gestionados: number | null;
```

Kpi "Pedidos con match":

```tsx
            <Kpi
              n={pedidosConMatch}
              titulo="Pedidos con match"
              detalle="calzan con inventario propio"
              tono="indigo"
              badge={vistos === null ? null : `${vistos} vistos · ${gestionados ?? 0} gestionados`}
              href="#entrada-match"
            />
```

- [ ] **Step 3: Verificar** — `cd crm && npx tsc --noEmit && npm run build`. En `/grupos`, la tarjeta ya no dice "por revisar"; dice `N vistos · M gestionados` (0 · 0 hasta que la migración corra y alguien abra un link).

- [ ] **Step 4: Commit**

```bash
git add "crm/app/(dashboard)/grupos/page.tsx" crm/components/dashboard-matches.tsx
git commit -m "feat(crm): Vistos y Gestionados reemplazan 'por revisar' en /grupos"
```

---

### Task 6: Configuración visible y documentación

**Files:**
- Modify: `src/lib/arranque.js` (`informe`)
- Modify: `.env.example`
- Modify: `CLAUDE.md` (lista de migraciones pendientes)
- Test: `test/arranque.test.js` (un caso más)

- [ ] **Step 1: Test** — agregar a `test/arranque.test.js`:

```js
test("sin CRM_PUBLIC_URL, el informe dice que los avisos salen sin link", async () => {
  delete process.env.CRM_PUBLIC_URL;
  const arranque = instalar();
  const { texto, faltantes } = await arranque.informe({ id: "org-1" });
  assert.ok(faltantes.includes("link de avisos (CRM_PUBLIC_URL)"));
  assert.ok(texto.includes("Link de avisos: sin configurar"));
});
```

- [ ] **Step 2: `arranque.js`** — en `informe`, después de `visitas`:

```js
  const linkAvisos = String(process.env.CRM_PUBLIC_URL || "").trim();
  if (!linkAvisos) faltantes.push("link de avisos (CRM_PUBLIC_URL)");
```

y en `partes`, después de `Visitas: ...`:

```js
    `Link de avisos: ${linkAvisos || "sin configurar"}.`,
```

- [ ] **Step 3: `.env.example`** — bajo `BOT_PUBLIC_URL=`:

```
# URL publica del CRM, para el link que va en cada aviso a la asesora
# (/aviso/<token>). Sin ella el aviso sale igual, sin link.
CRM_PUBLIC_URL=
```

- [ ] **Step 4: `CLAUDE.md`** — en "Migraciones pendientes de correr en Supabase", agregar `db/migrations/2026-09-03_aviso_link.sql` con una línea de por qué (token, visto, gestión del link del aviso; degrada limpio).

- [ ] **Step 5: Correr y commit**

`npm test` → verde.

```bash
git add src/lib/arranque.js .env.example CLAUDE.md test/arranque.test.js
git commit -m "config(radar): CRM_PUBLIC_URL para el link de los avisos, visible en el arranque"
```

---

## Después del bloque 1 (no en este plan)

- **Bloque 2 — envío directo sin número:** probar si la versión de WAHA desplegada acepta destinos `<lid>@lid` y expone `/api/{session}/lids`. Si sí, el botón "Enviar" de la página puede mandar el DM desde la línea de Natalia con un toque, sin copiar/pegar, y el directorio resuelve más teléfonos. Requiere ver la versión en Railway (no alcanzable desde el entorno de desarrollo).
- **Bloque 3 — contador y traspaso a Catherine** (spec, cinco condiciones).
- Botón CTA de URL en el mensaje de WhatsApp (`interactive.cta_url`) en vez del link en texto: solo para avisos únicos; el digest seguiría con links inline.

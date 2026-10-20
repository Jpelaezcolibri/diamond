# Sofi publica la propiedad de un asesor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un asesor le pida a Sofi por WhatsApp publicar una propiedad (esté o no en Wasi), Sofi le pida los datos y fotos, cree la ficha `D1001…` en la landing, la meta al inventario con el asesor como captador, el publicador la saque primera en los grupos, y venza a los 30 días salvo que el asesor la renueve.

**Architecture:** Tres herramientas nuevas de Sofi (`preparar_publicacion`, `confirmar_publicacion`, `actualizar_vigencia`) delegan en `src/agent/publicar-asesor.js`, que usa lógica pura (`src/lib/propiedad-asesor.js`) y acceso a datos (`src/data/propiedades-asesor.js`). La fila vive en `properties` con `origen='asesor'`; el publicador de grupos gana la categoría `ofertas`, prioridad y espera de 15 min; un scheduler de vigencia pregunta a los 25 días (botones `vig:si:<ref>` / `vig:no:<ref>`) y da de baja a los 30.

**Tech Stack:** Node.js (CommonJS), `node:test`, Supabase JS, WhatsApp Cloud API, Next.js (landing `web/`).

Spec: `docs/superpowers/specs/2026-10-19-sofi-publica-propiedad-asesor-design.md`.

## Global Constraints

- App en español (Colombia); código (variables, funciones) en inglés o el español ya usado en el módulo vecino; commits en español con `feat:`/`fix:`/`docs:`/`config:` y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ref de asesor: `D` + consecutivo desde `D1001`, sin guion.
- Vigencia: 30 días; pregunta a los 25 (`vence_at - 5 días`); sin respuesta, baja al llegar a `vence_at`.
- Fotos: las del chat del asesor con Sofi de las últimas 6 h, mínimo 1, máximo 10.
- Interruptores: `SOFI_PUBLICA_ASESOR=true` enciende crear/publicar (apagado por defecto); `SOFI_VIGENCIA_ASESOR=false` apaga solo la pregunta de vigencia.
- Nunca correr la migración ni SQL contra producción: la corre Juan en el SQL Editor de Supabase.
- Ninguna herramienta publica en un grupo: solo crea la propiedad; publicar es siempre el publicador.
- Tests del bot: `node --test test/<archivo>.test.js`; suite completa: `npm test` (debe quedar en verde, hoy 2.311).

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `db/migrations/2026-10-19_propiedades_asesor.sql` (crear) | Columnas `origen`, `vence_at`, `vigencia_preguntada_at`; categoría `ofertas` |
| `web/next.config.ts` (modificar) | Dejar ver fotos de Supabase en la landing |
| `src/lib/propiedad-asesor.js` (crear) | Pura: normalizar datos del asesor, título, token, siguiente ref |
| `src/data/propiedades-asesor.js` (crear) | I/O: fotos recientes, crear fila, buscar por captador, renovar/baja, listas de vigencia |
| `src/agent/publicar-asesor.js` (crear) | Lógica de las 3 herramientas |
| `src/agent/tools.js` (modificar) | Definiciones y despacho de las 3 herramientas |
| `src/agent/engine.js` (modificar) | `ctx.conversationId` |
| `src/agent/prompts.js` (modificar) | Sección "CUANDO QUIERE PUBLICAR UNA PROPIEDAD" en `promptAsesor` |
| `src/groups/publicador.js` (modificar) | Categoría `ofertas`, prioridad, espera de 15 min |
| `src/scheduler/publicador-grupos.js` (modificar) | Aviso único al captador |
| `src/lib/vigencia-asesor.js` (crear) | Botones `vig:` |
| `src/scheduler/vigencia-asesor.js` (crear) | Pregunta a los 25 días, baja a los 30 |
| `src/channels/whatsapp.js` (modificar) | Ruteo de botones `vig:` |
| `src/server.js` (modificar) | Arrancar el scheduler de vigencia |
| `scripts/create-vigencia-propiedad-template.mjs` (crear) | Plantilla de Meta |

---

### Task 1: Migración y fotos de Supabase en la landing

**Files:**
- Create: `db/migrations/2026-10-19_propiedades_asesor.sql`
- Modify: `web/next.config.ts` (línea `img-src` del CSP y `images.remotePatterns`)

**Interfaces:**
- Produces: columnas `properties.origen` (`'wasi'|'asesor'`), `properties.vence_at`, `properties.vigencia_preguntada_at`; valor `'ofertas'` en `whatsapp_groups.publica`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Propiedades que publica Sofi a pedido de un asesor (spec
-- docs/superpowers/specs/2026-10-19-sofi-publica-propiedad-asesor-design.md).
-- Solo agrega. El check de publica se reemplaza para admitir 'ofertas'
-- (no toca datos: los valores existentes siguen siendo validos).

alter table properties add column if not exists origen text not null default 'wasi'
  check (origen in ('wasi', 'asesor'));
alter table properties add column if not exists vence_at timestamptz;
alter table properties add column if not exists vigencia_preguntada_at timestamptz;

alter table whatsapp_groups drop constraint if exists whatsapp_groups_publica_check;
alter table whatsapp_groups add constraint whatsapp_groups_publica_check
  check (publica is null or publica in ('amoblados', 'fincas', 'ofertas'));

update whatsapp_groups set publica = 'ofertas'
where org_id = (select id from organizations where name = 'Diamond')
  and jid in (
    '573003371490-1503058650@g.us', -- OFERTAS SUR POB ENV SAB
    '573006167957-1494531534@g.us', -- OFERTAS 7:00 A.M.8:00P.M.
    '573003371490-1503059132@g.us'  -- OFERTAS 2 7am 8pm
  );
```

- [ ] **Step 2: Landing — CSP y remotePatterns**

En `web/next.config.ts`, cambiar la línea del CSP:

```js
  "img-src 'self' data: blob: https://*.wasi.co https://*.supabase.co https://images.unsplash.com https://www.facebook.com",
```

y agregar a `images.remotePatterns`:

```js
      { protocol: "https", hostname: "**.supabase.co" },
```

- [ ] **Step 3: Verificar que la landing compila**

Run: `cd web && npm run build`
Expected: build sin errores.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/2026-10-19_propiedades_asesor.sql web/next.config.ts
git commit -m "config: columnas de propiedades de asesor y fotos de Supabase en la landing"
```

---

### Task 2: Lógica pura de la propiedad del asesor

**Files:**
- Create: `src/lib/propiedad-asesor.js`
- Test: `test/propiedad-asesor.test.js`

**Interfaces:**
- Produces:
  - `normalizar(datos) -> { fila, faltantes: string[] }`. `datos`: `{ operacion, tipo, barrio, municipio, precio, periodo, amoblado (bool), area, alcobas, banos, parqueaderos, estrato, administracion, descripcion }`. `fila`: `{ titulo, tipo, operacion, precio, area, habitaciones, banos, garaje, estrato, administracion, zona, ciudad, descripcion, caracteristicas, periodo_precio }`.
  - `tokenDe(fila, fotos: string[]) -> string` (12 hex).
  - `siguienteRef(refs: string[]) -> string` (`"D1001"`…).

- [ ] **Step 1: Write the failing test**

```js
// test/propiedad-asesor.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const pa = require("../src/lib/propiedad-asesor");

const COMPLETO = {
  operacion: "arriendo", tipo: "apartamento", barrio: "Laureles", municipio: "Medellín",
  precio: "4.500.000", periodo: "mensual", amoblado: true, area: "60", alcobas: 2, banos: 2,
  parqueaderos: 1, estrato: 5, administracion: "350.000", descripcion: "Cerca a la 70",
};

test("datos completos: fila lista y sin faltantes", () => {
  const { fila, faltantes } = pa.normalizar(COMPLETO);
  assert.deepStrictEqual(faltantes, []);
  assert.strictEqual(fila.operacion, "Arriendo");
  assert.strictEqual(fila.tipo, "Apartamento");
  assert.strictEqual(fila.precio, "$4.500.000");
  assert.strictEqual(fila.area, "60m2");
  assert.strictEqual(fila.zona, "Laureles");
  assert.strictEqual(fila.ciudad, "Medellín");
  assert.strictEqual(fila.periodo_precio, "mensual");
  assert.strictEqual(fila.caracteristicas, "Amoblado");
  assert.strictEqual(fila.administracion, "$350.000");
  assert.strictEqual(fila.titulo, "Apartamento amoblado en arriendo en Laureles");
});

test("faltantes: dice exactamente que falta", () => {
  const { faltantes } = pa.normalizar({ operacion: "arriendo", tipo: "casa" });
  for (const f of ["barrio o sector", "municipio", "precio (en números)", "si el canon es mensual o por noche", "si está amoblado", "área en m²", "alcobas", "baños"]) {
    assert.ok(faltantes.includes(f), `falta "${f}" en ${JSON.stringify(faltantes)}`);
  }
});

test("venta no pide periodo ni amoblado; local no pide alcobas", () => {
  const { faltantes, fila } = pa.normalizar({ operacion: "venta", tipo: "local", barrio: "Centro", municipio: "Medellín", precio: "450 millones", area: "80" });
  assert.deepStrictEqual(faltantes, []);
  assert.strictEqual(fila.precio, "$450.000.000");
  assert.strictEqual(fila.periodo_precio, null);
  assert.strictEqual(fila.titulo, "Local en venta en Centro");
});

test("precio y area que no cuadran cuentan como faltantes", () => {
  const { faltantes } = pa.normalizar({ ...COMPLETO, precio: "barato", area: "0" });
  assert.ok(faltantes.includes("precio (en números)"));
  assert.ok(faltantes.includes("área en m²"));
});

test("casa amoblada concuerda en genero y el periodo por noche se lee", () => {
  const { fila } = pa.normalizar({ ...COMPLETO, tipo: "casa", periodo: "por noche" });
  assert.strictEqual(fila.titulo, "Casa amoblada en arriendo en Laureles");
  assert.strictEqual(fila.periodo_precio, "diario");
});

test("token cambia si cambian los datos o las fotos", () => {
  const { fila } = pa.normalizar(COMPLETO);
  const t = pa.tokenDe(fila, ["a.jpg"]);
  assert.match(t, /^[0-9a-f]{12}$/);
  assert.strictEqual(pa.tokenDe(fila, ["a.jpg"]), t);
  assert.notStrictEqual(pa.tokenDe(fila, ["a.jpg", "b.jpg"]), t);
  assert.notStrictEqual(pa.tokenDe({ ...fila, precio: "$1" }, ["a.jpg"]), t);
});

test("siguienteRef arranca en D1001 y sigue el mayor", () => {
  assert.strictEqual(pa.siguienteRef([]), "D1001");
  assert.strictEqual(pa.siguienteRef(["D1001", "d1007", "10383517", "D10x"]), "D1008");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/propiedad-asesor.test.js`
Expected: FAIL con "Cannot find module '../src/lib/propiedad-asesor'".

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/propiedad-asesor.js
// Propiedad que un asesor le pide a Sofi publicar (spec docs/superpowers/
// specs/2026-10-19-sofi-publica-propiedad-asesor-design.md §2). Logica pura:
// convierte lo que dijo el asesor en una fila de `properties` y dice que
// falta. Nada se inventa: un dato que no se entiende cuenta como faltante.
const crypto = require("crypto");

const TIPOS = {
  apartamento: "Apartamento", apto: "Apartamento", apartaestudio: "Apartaestudio",
  casa: "Casa", finca: "Finca", local: "Local", oficina: "Oficina", lote: "Lote",
};
const SIN_ALCOBAS = new Set(["Local", "Oficina", "Lote"]);
const FEMENINO = new Set(["Casa", "Finca", "Oficina"]);

function texto(v) {
  return String(v ?? "").trim();
}

function pesos(n) {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

// "4.500.000", "$4500000", "4,5 millones", "450 millones", "4.5M".
function parsePrecio(v, minimo = 100000) {
  const s = texto(v).toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const num = s.replace(/[^\d.,]/g, "");
  if (!num) return null;
  const n = /mill|m$/.test(s) ? parseFloat(num.replace(",", ".")) * 1e6 : Number(num.replace(/[.,]/g, ""));
  return Number.isFinite(n) && n >= minimo ? n : null;
}

function parseArea(v) {
  const n = parseFloat(texto(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}

function parseEntero(v) {
  if (v === null || v === undefined || texto(v) === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function operacionDe(v) {
  const t = texto(v);
  if (/arriend|renta|alquil/i.test(t)) return "Arriendo";
  if (/vent/i.test(t)) return "Venta";
  return null;
}

function periodoDe(v) {
  const t = texto(v);
  if (/mes|mensual/i.test(t)) return "mensual";
  if (/d[ií]a|noche|diari/i.test(t)) return "diario";
  return null;
}

function tituloDe({ tipo, amoblado, operacion, zona }) {
  const mueble = amoblado ? (FEMENINO.has(tipo) ? " amoblada" : " amoblado") : "";
  return `${tipo}${mueble} en ${operacion === "Arriendo" ? "arriendo" : "venta"} en ${zona}`;
}

function normalizar(d = {}) {
  const faltantes = [];
  const operacion = operacionDe(d.operacion);
  if (!operacion) faltantes.push("operación (venta o arriendo)");
  const tipo = TIPOS[texto(d.tipo).toLowerCase()] || null;
  if (!tipo) faltantes.push("tipo de inmueble");
  const zona = texto(d.barrio);
  if (!zona) faltantes.push("barrio o sector");
  const ciudad = texto(d.municipio);
  if (!ciudad) faltantes.push("municipio");
  const precio = parsePrecio(d.precio);
  if (precio === null) faltantes.push("precio (en números)");

  let periodo = null;
  let amoblado = null;
  if (operacion === "Arriendo") {
    periodo = periodoDe(d.periodo);
    if (!periodo) faltantes.push("si el canon es mensual o por noche");
    amoblado = typeof d.amoblado === "boolean" ? d.amoblado : null;
    if (amoblado === null) faltantes.push("si está amoblado");
  }

  const area = parseArea(d.area);
  if (area === null) faltantes.push("área en m²");
  const habitaciones = parseEntero(d.alcobas);
  const banos = parseEntero(d.banos);
  if (tipo && !SIN_ALCOBAS.has(tipo)) {
    if (habitaciones === null) faltantes.push("alcobas");
    if (banos === null) faltantes.push("baños");
  }

  const administracion = parsePrecio(d.administracion, 1000);
  const fila = {
    titulo: tipo && operacion && zona ? tituloDe({ tipo, amoblado, operacion, zona }) : null,
    tipo,
    operacion,
    precio: precio === null ? null : pesos(precio),
    area: area === null ? null : `${area}m2`,
    habitaciones,
    banos,
    garaje: parseEntero(d.parqueaderos),
    estrato: parseEntero(d.estrato),
    administracion: administracion === null ? null : pesos(administracion),
    zona: zona || null,
    ciudad: ciudad || null,
    descripcion: texto(d.descripcion) || null,
    caracteristicas: amoblado ? "Amoblado" : null,
    periodo_precio: periodo,
  };
  return { fila, faltantes };
}

// Ata la confirmacion a la vista previa: si el modelo cambia un dato o llega
// otra foto entre preparar y confirmar, el token no coincide.
function tokenDe(fila, fotos) {
  return crypto.createHash("sha256").update(JSON.stringify({ fila, fotos })).digest("hex").slice(0, 12);
}

function siguienteRef(refs) {
  const numeros = (refs || []).map((r) => /^D(\d+)$/i.exec(String(r))).filter(Boolean).map((m) => Number(m[1]));
  return `D${Math.max(1000, ...numeros) + 1}`;
}

module.exports = { normalizar, tokenDe, siguienteRef };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/propiedad-asesor.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/propiedad-asesor.js test/propiedad-asesor.test.js
git commit -m "feat(sofi): normalizar la propiedad que dicta un asesor"
```

---

### Task 3: Acceso a datos de las propiedades de asesor

**Files:**
- Create: `src/data/propiedades-asesor.js`
- Test: `test/propiedades-asesor-data.test.js`

**Interfaces:**
- Consumes: `siguienteRef` (Task 2), `buildSlug` (`src/lib/slug.js`), `config.landingBaseUrl`.
- Produces:
  - `fotosRecientes(conversationId, { horas = 6, max = 10 }) -> Promise<string[]>`
  - `crear(org, advisor, fila, fotos) -> Promise<row>` (lanza `Error` con `.code = "SIN_MIGRACION"` si faltan las columnas)
  - `aplicarVigencia(orgId, advisorId, ref, sigue: boolean) -> Promise<{ estado: "renovada"|"baja"|"no_encontrada", ref }>`
  - `porPreguntar(orgId, ahora) -> Promise<row[]>`, `vencidas(orgId, ahora) -> Promise<row[]>`, `marcarPreguntada(id, ahora)`, `darDeBaja(id)`
  - Constantes `VIGENCIA_DIAS = 30`, `AVISO_DIAS = 5`.

- [ ] **Step 1: Write the failing test**

```js
// test/propiedades-asesor-data.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const datos = require("../src/data/propiedades-asesor");

// Supabase falso y encadenable: graba la consulta y devuelve `respuesta`.
function falso(respuestas) {
  const llamadas = [];
  const cadena = (tabla) => {
    const q = { tabla, ops: [] };
    llamadas.push(q);
    const self = new Proxy({}, {
      get(_, op) {
        if (op === "then") {
          const r = respuestas.shift() || { data: null, error: null };
          return (ok) => Promise.resolve(r).then(ok);
        }
        return (...args) => { q.ops.push([op, ...args]); return self; };
      },
    });
    return self;
  };
  return { from: cadena, llamadas };
}

test("crear: ref D siguiente, link de la landing, captador y vigencia", async (t) => {
  const sb = falso([{ data: [{ ref: "D1003" }], error: null }, { data: { id: "p1", ref: "D1004" }, error: null }]);
  t.mock.method(datos, "_supabase", () => sb);
  const org = { id: "org-1", landing_base_url: "https://diamondinmobiliaria.com" };
  const fila = { titulo: "Apartamento amoblado en arriendo en Laureles", zona: "Laureles" };
  const r = await datos.crear(org, { id: "adv-1" }, fila, ["https://x.supabase.co/a.jpg"]);
  assert.strictEqual(r.ref, "D1004");
  const insert = sb.llamadas[1].ops.find(([op]) => op === "insert")[1];
  assert.strictEqual(insert.ref, "D1004");
  assert.strictEqual(insert.origen, "asesor");
  assert.strictEqual(insert.captador_id, "adv-1");
  assert.strictEqual(insert.disponible, true);
  assert.deepStrictEqual(insert.images, ["https://x.supabase.co/a.jpg"]);
  assert.strictEqual(insert.link, "https://diamondinmobiliaria.com/propiedades/apartamento-amoblado-en-arriendo-en-laureles-d1004");
  const dias = (new Date(insert.vence_at) - Date.now()) / 86400000;
  assert.ok(dias > 29.9 && dias <= 30);
});

test("crear: sin la migracion avisa con SIN_MIGRACION", async (t) => {
  const sb = falso([{ data: [], error: null }, { data: null, error: { code: "PGRST204", message: "Could not find the 'origen' column of 'properties'" } }]);
  t.mock.method(datos, "_supabase", () => sb);
  await assert.rejects(datos.crear({ id: "o" }, { id: "a" }, { titulo: "x" }, ["f"]), (e) => e.code === "SIN_MIGRACION");
});

test("crear: si la ref choca (23505) reintenta con la siguiente", async (t) => {
  const sb = falso([
    { data: [{ ref: "D1001" }], error: null }, { data: null, error: { code: "23505", message: "duplicate" } },
    { data: [{ ref: "D1001" }, { ref: "D1002" }], error: null }, { data: { id: "p", ref: "D1003" }, error: null },
  ]);
  t.mock.method(datos, "_supabase", () => sb);
  const r = await datos.crear({ id: "o" }, { id: "a" }, { titulo: "x" }, ["f"]);
  assert.strictEqual(r.ref, "D1003");
});

test("aplicarVigencia: renueva, da de baja o no la encuentra", async (t) => {
  t.mock.method(datos, "_supabase", () => falso([{ data: { id: "p1", ref: "D1004" }, error: null }, { data: null, error: null }]));
  assert.deepStrictEqual(await datos.aplicarVigencia("o", "a", "d1004", true), { estado: "renovada", ref: "D1004" });
  t.mock.method(datos, "_supabase", () => falso([{ data: { id: "p1", ref: "D1004" }, error: null }, { data: null, error: null }]));
  assert.deepStrictEqual(await datos.aplicarVigencia("o", "a", "D1004", false), { estado: "baja", ref: "D1004" });
  t.mock.method(datos, "_supabase", () => falso([{ data: null, error: null }]));
  assert.deepStrictEqual(await datos.aplicarVigencia("o", "a", "D9999", true), { estado: "no_encontrada", ref: "D9999" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/propiedades-asesor-data.test.js`
Expected: FAIL con "Cannot find module '../src/data/propiedades-asesor'".

- [ ] **Step 3: Write minimal implementation**

```js
// src/data/propiedades-asesor.js
// Propiedades que publica Sofi a pedido de un asesor (origen = 'asesor').
// Spec docs/superpowers/specs/2026-10-19-sofi-publica-propiedad-asesor-design.md.
const config = require("../config");
const { buildSlug } = require("../lib/slug");
const { siguienteRef } = require("../lib/propiedad-asesor");

const DIA_MS = 86400000;
const VIGENCIA_DIAS = 30;
const AVISO_DIAS = 5;
const COLUMNA_FALTANTE = /origen|vence_at|vigencia_preguntada_at/;

const self = {
  // Indireccion para que los tests cambien el cliente sin tocar el require.
  _supabase: () => require("./supabase"),
};

self.fotosRecientes = async function fotosRecientes(conversationId, { horas = 6, max = 10 } = {}) {
  const desde = new Date(Date.now() - horas * 3600e3).toISOString();
  const { data, error } = await self._supabase()
    .from("messages")
    .select("media_url, media_mime, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .not("media_url", "is", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).filter((m) => /^image\//.test(String(m.media_mime || ""))).map((m) => m.media_url).slice(0, max);
};

self.crear = async function crear(org, advisor, fila, fotos) {
  const base = String(org.landing_base_url || config.landingBaseUrl).replace(/\/+$/, "");
  for (let intento = 0; intento < 3; intento++) {
    const { data: refs, error } = await self._supabase().from("properties").select("ref").eq("org_id", org.id).ilike("ref", "D%");
    if (error) throw error;
    const ref = siguienteRef((refs || []).map((r) => r.ref));
    const row = {
      ...fila,
      org_id: org.id,
      ref,
      link: `${base}/propiedades/${buildSlug(fila.titulo, ref)}`,
      images: fotos,
      disponible: true,
      origen: "asesor",
      captador_id: advisor.id,
      vence_at: new Date(Date.now() + VIGENCIA_DIAS * DIA_MS).toISOString(),
      vigencia_preguntada_at: null,
    };
    const { data, error: e2 } = await self._supabase().from("properties").insert(row).select().single();
    if (!e2) return data;
    if (e2.code === "23505") continue;
    if (COLUMNA_FALTANTE.test(String(e2.message || ""))) {
      const err = new Error("Falta la migracion 2026-10-19_propiedades_asesor.sql");
      err.code = "SIN_MIGRACION";
      throw err;
    }
    throw e2;
  }
  throw new Error("No se pudo asignar una ref D libre");
};

async function deCaptador(orgId, advisorId, ref) {
  const { data, error } = await self._supabase()
    .from("properties")
    .select("id, ref")
    .eq("org_id", orgId)
    .eq("origen", "asesor")
    .eq("captador_id", advisorId)
    .eq("ref", String(ref || "").trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

self.aplicarVigencia = async function aplicarVigencia(orgId, advisorId, ref, sigue) {
  const p = await deCaptador(orgId, advisorId, ref);
  if (!p) return { estado: "no_encontrada", ref: String(ref || "").trim().toUpperCase() };
  const patch = sigue
    ? { disponible: true, vence_at: new Date(Date.now() + VIGENCIA_DIAS * DIA_MS).toISOString(), vigencia_preguntada_at: null }
    : { disponible: false };
  const { error } = await self._supabase().from("properties").update(patch).eq("id", p.id);
  if (error) throw error;
  return { estado: sigue ? "renovada" : "baja", ref: p.ref };
};

self.porPreguntar = async function porPreguntar(orgId, ahora = new Date()) {
  const limite = new Date(ahora.getTime() + AVISO_DIAS * DIA_MS).toISOString();
  const { data, error } = await self._supabase()
    .from("properties")
    .select("id, ref, titulo, captador_id, vence_at")
    .eq("org_id", orgId)
    .eq("origen", "asesor")
    .eq("disponible", true)
    .is("vigencia_preguntada_at", null)
    .lte("vence_at", limite);
  if (error) throw error;
  return data || [];
};

self.vencidas = async function vencidas(orgId, ahora = new Date()) {
  const { data, error } = await self._supabase()
    .from("properties")
    .select("id, ref, titulo, captador_id")
    .eq("org_id", orgId)
    .eq("origen", "asesor")
    .eq("disponible", true)
    .lte("vence_at", ahora.toISOString());
  if (error) throw error;
  return data || [];
};

self.marcarPreguntada = async function marcarPreguntada(id, ahora = new Date()) {
  const { error } = await self._supabase().from("properties").update({ vigencia_preguntada_at: ahora.toISOString() }).eq("id", id);
  if (error) throw error;
};

self.darDeBaja = async function darDeBaja(id) {
  const { error } = await self._supabase().from("properties").update({ disponible: false }).eq("id", id);
  if (error) throw error;
};

self.VIGENCIA_DIAS = VIGENCIA_DIAS;
self.AVISO_DIAS = AVISO_DIAS;
module.exports = self;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/propiedades-asesor-data.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/propiedades-asesor.js test/propiedades-asesor-data.test.js
git commit -m "feat(sofi): datos de las propiedades que publica un asesor"
```

---

### Task 4: Herramientas de Sofi para publicar y renovar

**Files:**
- Create: `src/agent/publicar-asesor.js`
- Modify: `src/agent/tools.js` (agregar 3 definiciones al final de `TOOL_DEFINITIONS`, justo después de `confirmar_cita` ~línea 336, y 3 ramas al inicio de `executeTool` ~línea 598)
- Modify: `src/agent/engine.js` (objeto `ctx`, ~línea 240: agregar `conversationId: conv.id,`)
- Test: `test/publicar-asesor-tools.test.js`

**Interfaces:**
- Consumes: `normalizar`, `tokenDe` (Task 2); `fotosRecientes`, `crear`, `aplicarVigencia` (Task 3); `postGrupo(propiedad, { org })` (`src/groups/redactar.js`).
- Produces: `preparar(input, ctx) -> Promise<string>`, `confirmar(input, ctx) -> Promise<string>`, `actualizarVigencia(input, ctx) -> Promise<string>`; herramientas `preparar_publicacion`, `confirmar_publicacion`, `actualizar_vigencia`.

- [ ] **Step 1: Write the failing test**

```js
// test/publicar-asesor-tools.test.js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { executeTool } = require("../src/agent/tools");
const datos = require("../src/data/propiedades-asesor");
const { normalizar, tokenDe } = require("../src/lib/propiedad-asesor");

const ORG = { id: "org-1", name: "Diamond", landing_base_url: "https://diamondinmobiliaria.com" };
const ADVISOR = { id: "adv-1", name: "Daiana Zea", phone: "573011880668" };
const ctx = () => ({ org: ORG, advisor: ADVISOR, colega: null, lead: { id: "l" }, conversationId: "conv-1" });
const DATOS = {
  operacion: "arriendo", tipo: "apartamento", barrio: "Laureles", municipio: "Medellín", precio: "4.500.000",
  periodo: "mensual", amoblado: true, area: "60", alcobas: 2, banos: 2,
};
let previo;
beforeEach(() => { previo = process.env.SOFI_PUBLICA_ASESOR; process.env.SOFI_PUBLICA_ASESOR = "true"; });
afterEach(() => { if (previo === undefined) delete process.env.SOFI_PUBLICA_ASESOR; else process.env.SOFI_PUBLICA_ASESOR = previo; });

test("un cliente o colega no puede usarlas", async () => {
  for (const tool of ["preparar_publicacion", "confirmar_publicacion", "actualizar_vigencia"]) {
    const r = await executeTool(tool, DATOS, { org: ORG, advisor: null });
    assert.match(r, /solo para un asesor/i);
  }
});

test("apagado: no crea nada", async () => {
  process.env.SOFI_PUBLICA_ASESOR = "false";
  const r = await executeTool("preparar_publicacion", DATOS, ctx());
  assert.match(r, /no está activa/i);
});

test("faltan datos y fotos: lista exacta", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => []);
  const r = await executeTool("preparar_publicacion", { operacion: "venta", tipo: "casa" }, ctx());
  assert.match(r, /FALTAN DATOS/);
  assert.match(r, /barrio o sector/);
  assert.match(r, /al menos una foto/);
});

test("completo: vista previa con token y numero de fotos", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => ["a.jpg", "b.jpg"]);
  const r = await executeTool("preparar_publicacion", DATOS, ctx());
  const { fila } = normalizar(DATOS);
  assert.match(r, /VISTA PREVIA/);
  assert.match(r, /Fotos recibidas: 2/);
  assert.match(r, new RegExp(`token=${tokenDe(fila, ["a.jpg", "b.jpg"])}`));
  assert.match(r, /Apartamento amoblado en arriendo en Laureles/);
});

test("confirmar con token viejo no crea", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => ["a.jpg"]);
  const crear = t.mock.method(datos, "crear", async () => ({}));
  const r = await executeTool("confirmar_publicacion", { ...DATOS, token: "000000000000" }, ctx());
  assert.match(r, /cambiaron/i);
  assert.strictEqual(crear.mock.callCount(), 0);
});

test("confirmar con el token correcto crea y devuelve ref y link", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => ["a.jpg"]);
  const crear = t.mock.method(datos, "crear", async () => ({ ref: "D1001", link: "https://diamondinmobiliaria.com/propiedades/x-d1001" }));
  const { fila } = normalizar(DATOS);
  const r = await executeTool("confirmar_publicacion", { ...DATOS, token: tokenDe(fila, ["a.jpg"]) }, ctx());
  assert.strictEqual(crear.mock.calls[0].arguments[1], ADVISOR);
  assert.match(r, /CREADA: ref D1001/);
  assert.match(r, /x-d1001/);
});

test("confirmar sin migracion lo dice", async (t) => {
  t.mock.method(datos, "fotosRecientes", async () => ["a.jpg"]);
  t.mock.method(datos, "crear", async () => { const e = new Error("x"); e.code = "SIN_MIGRACION"; throw e; });
  const { fila } = normalizar(DATOS);
  const r = await executeTool("confirmar_publicacion", { ...DATOS, token: tokenDe(fila, ["a.jpg"]) }, ctx());
  assert.match(r, /migraci/i);
  assert.match(r, /no prometas/i);
});

test("actualizar_vigencia: renueva o da de baja la del asesor", async (t) => {
  const aplicar = t.mock.method(datos, "aplicarVigencia", async (o, a, ref, sigue) => ({ estado: sigue ? "renovada" : "baja", ref: "D1001" }));
  assert.match(await executeTool("actualizar_vigencia", { ref: "D1001", sigue: true }, ctx()), /30 días más/);
  assert.match(await executeTool("actualizar_vigencia", { ref: "D1001", sigue: false }, ctx()), /sale del inventario/);
  assert.deepStrictEqual(aplicar.mock.calls[0].arguments, ["org-1", "adv-1", "D1001", true]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/publicar-asesor-tools.test.js`
Expected: FAIL (las herramientas no existen: `executeTool` no las reconoce).

- [ ] **Step 3: Implementar `src/agent/publicar-asesor.js`**

```js
// Herramientas con las que Sofi publica la propiedad de un asesor (spec
// docs/superpowers/specs/2026-10-19-sofi-publica-propiedad-asesor-design.md
// §2 y §6). Nunca publican en un grupo: crean la propiedad y el publicador
// la saca con su freno.
const { normalizar, tokenDe } = require("../lib/propiedad-asesor");
const datos = require("../data/propiedades-asesor");
const { postGrupo } = require("../groups/redactar");

const SOLO_ASESOR = "Esta herramienta es solo para un asesor de la casa.";
const APAGADO = "La publicación de propiedades por Sofi no está activa todavía. Dile al asesor que la cargue en Wasi o que hable con Juan.";

function activo() {
  return process.env.SOFI_PUBLICA_ASESOR === "true";
}

async function revisar(input, ctx) {
  const { token, ...resto } = input || {};
  const { fila, faltantes } = normalizar(resto);
  const fotos = ctx.conversationId ? await datos.fotosRecientes(ctx.conversationId).catch(() => []) : [];
  if (fotos.length === 0) faltantes.push("al menos una foto (que te la mande por este chat)");
  return { token, fila, fotos, faltantes };
}

function mensajeFaltantes(faltantes, fotos) {
  return `FALTAN DATOS, pídeselos al asesor (no inventes ninguno): ${faltantes.join("; ")}.${fotos.length ? ` Ya tengo ${fotos.length} foto(s).` : ""}`;
}

async function preparar(input, ctx) {
  if (!ctx.advisor) return SOLO_ASESOR;
  if (!activo()) return APAGADO;
  const { fila, fotos, faltantes } = await revisar(input, ctx);
  if (faltantes.length) return mensajeFaltantes(faltantes, fotos);
  const post = postGrupo({ ...fila, ref: "nueva", linkWasi: "(link de la ficha, se crea al confirmar)" }, { org: ctx.org });
  return `VISTA PREVIA (muéstrasela tal cual y pide un sí explícito antes de confirmar). Fotos recibidas: ${fotos.length}; si alguna no es de esta propiedad, que te diga. token=${tokenDe(fila, fotos)}\n\n${post}`;
}

async function confirmar(input, ctx) {
  if (!ctx.advisor) return SOLO_ASESOR;
  if (!activo()) return APAGADO;
  const { token, fila, fotos, faltantes } = await revisar(input, ctx);
  if (faltantes.length) return mensajeFaltantes(faltantes, fotos);
  if (tokenDe(fila, fotos) !== token) {
    return "Los datos o las fotos cambiaron desde la vista previa: vuelve a llamar preparar_publicacion y muéstrale la vista previa nueva.";
  }
  try {
    const p = await datos.crear(ctx.org, ctx.advisor, fila, fotos);
    return `CREADA: ref ${p.ref}, ficha ${p.link}. Dile al asesor la ref y el link: la ficha queda visible en unos minutos y sale en los grupos en los próximos turnos (lunes a sábado, 8 a. m. a 6 p. m.). Vence en 30 días; a los 25 le pregunto si sigue disponible.`;
  } catch (e) {
    console.error("[publicar-asesor] No se pudo crear la propiedad:", e.message);
    if (e.code === "SIN_MIGRACION") return "No se pudo crear: falta correr la migración de propiedades de asesor. Díselo al asesor y no prometas que se publicó.";
    return "No se pudo crear la propiedad por un error técnico. Díselo al asesor y no prometas que se publicó.";
  }
}

async function actualizarVigencia(input, ctx) {
  if (!ctx.advisor) return SOLO_ASESOR;
  try {
    const r = await datos.aplicarVigencia(ctx.org.id, ctx.advisor.id, input && input.ref, Boolean(input && input.sigue));
    if (r.estado === "no_encontrada") return `No encuentro la ${r.ref} entre las propiedades que publicaste con Sofi.`;
    if (r.estado === "renovada") return `Listo: la ${r.ref} sigue publicada 30 días más.`;
    return `Listo: la ${r.ref} sale del inventario y de los grupos.`;
  } catch (e) {
    console.error("[publicar-asesor] No se pudo actualizar la vigencia:", e.message);
    return "No pude actualizarla por un error técnico. Díselo al asesor.";
  }
}

module.exports = { preparar, confirmar, actualizarVigencia, activo };
```

- [ ] **Step 4: Definiciones y despacho en `src/agent/tools.js`**

Agregar al final del arreglo `TOOL_DEFINITIONS` (después del objeto de `confirmar_cita`):

```js
  {
    name: "preparar_publicacion",
    description:
      "SOLO para un asesor de la casa que te pide publicar una propiedad (venta o arriendo) en los grupos. Con lo que el asesor te haya dicho, valida los datos, cuenta las fotos que te mandó en las últimas 6 h y devuelve lo que FALTA o la VISTA PREVIA del post con un token. Llámala cada vez que el asesor te dé datos nuevos. Nunca inventes un dato que el asesor no dijo.",
    input_schema: {
      type: "object",
      properties: {
        operacion: { type: "string", description: "venta o arriendo" },
        tipo: { type: "string", description: "apartamento, apartaestudio, casa, finca, local, oficina o lote" },
        barrio: { type: "string", description: "Barrio o sector, tal como lo dijo el asesor" },
        municipio: { type: "string" },
        precio: { type: "string", description: "Precio tal como lo dijo, con números (ej '4.500.000', '450 millones')" },
        periodo: { type: "string", description: "Solo arriendo: mensual o por noche" },
        amoblado: { type: "boolean", description: "Solo arriendo" },
        area: { type: "string", description: "Área en m²" },
        alcobas: { type: "integer" },
        banos: { type: "integer" },
        parqueaderos: { type: "integer" },
        estrato: { type: "integer" },
        administracion: { type: "string" },
        descripcion: { type: "string", description: "Una o dos líneas, solo con lo que dijo el asesor" },
      },
    },
  },
  {
    name: "confirmar_publicacion",
    description:
      "SOLO para un asesor, y SOLO después de mostrarle la vista previa de preparar_publicacion y de que diga un sí explícito. Pasa EXACTAMENTE los mismos datos y el token de la vista previa. Crea la propiedad (ref D…), su ficha en la landing y la deja en la fila del publicador de grupos. NO publica en el grupo en este momento.",
    input_schema: {
      type: "object",
      properties: {
        token: { type: "string" },
        operacion: { type: "string" }, tipo: { type: "string" }, barrio: { type: "string" }, municipio: { type: "string" },
        precio: { type: "string" }, periodo: { type: "string" }, amoblado: { type: "boolean" }, area: { type: "string" },
        alcobas: { type: "integer" }, banos: { type: "integer" }, parqueaderos: { type: "integer" }, estrato: { type: "integer" },
        administracion: { type: "string" }, descripcion: { type: "string" },
      },
      required: ["token"],
    },
  },
  {
    name: "actualizar_vigencia",
    description:
      "SOLO para un asesor, sobre una propiedad que publicó con Sofi (ref D…). sigue=true si dice que sigue disponible (renueva 30 días); sigue=false si dice que se arrendó, se vendió o ya no está (sale del inventario y de los grupos).",
    input_schema: {
      type: "object",
      properties: { ref: { type: "string" }, sigue: { type: "boolean" } },
      required: ["ref", "sigue"],
    },
  },
```

Y al inicio de `executeTool(name, input, ctx)`, antes de `if (name === "buscar_propiedades")`:

```js
  if (name === "preparar_publicacion") return require("./publicar-asesor").preparar(input, ctx);
  if (name === "confirmar_publicacion") return require("./publicar-asesor").confirmar(input, ctx);
  if (name === "actualizar_vigencia") return require("./publicar-asesor").actualizarVigencia(input, ctx);
```

- [ ] **Step 5: `ctx.conversationId` en `src/agent/engine.js`**

En el objeto `const ctx = { org, lead, advisor, ...` (~línea 240), agregar después de `colega,`:

```js
    // Para las herramientas que leen lo que el asesor mando en este chat (las
    // fotos de la propiedad a publicar, src/agent/publicar-asesor.js).
    conversationId: conv.id,
```

- [ ] **Step 6: Run tests**

Run: `node --test test/publicar-asesor-tools.test.js test/confirmar-cita.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/publicar-asesor.js src/agent/tools.js src/agent/engine.js test/publicar-asesor-tools.test.js
git commit -m "feat(sofi): herramientas para publicar y renovar la propiedad de un asesor"
```

---

### Task 5: Prompt del asesor

**Files:**
- Modify: `src/agent/prompts.js` (`promptAsesor`, ~líneas 32-150)
- Test: `test/promptasesor-publicar.test.js`

**Interfaces:**
- Consumes: `activo()` de `src/agent/publicar-asesor.js` (Task 4).

- [ ] **Step 1: Write the failing test**

```js
// test/promptasesor-publicar.test.js
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const { buildSystemPrompt } = require("../src/agent/prompts");

const ORG = { id: "org-1", name: "Diamond Inmobiliaria" };
const ADVISOR = { name: "Daiana Zea" };
const texto = () => buildSystemPrompt({ org: ORG, advisor: ADVISOR, now: null }).map((b) => b.text).join("\n");
const previo = process.env.SOFI_PUBLICA_ASESOR;
afterEach(() => { if (previo === undefined) delete process.env.SOFI_PUBLICA_ASESOR; else process.env.SOFI_PUBLICA_ASESOR = previo; });

test("encendido: explica el flujo de publicar", () => {
  process.env.SOFI_PUBLICA_ASESOR = "true";
  const t = texto();
  assert.match(t, /CUANDO QUIERE PUBLICAR UNA PROPIEDAD/);
  assert.match(t, /preparar_publicacion/);
  assert.match(t, /confirmar_publicacion/);
  assert.match(t, /actualizar_vigencia/);
  assert.match(t, /sí explícito/);
});

test("apagado: no ofrece publicar", () => {
  process.env.SOFI_PUBLICA_ASESOR = "false";
  assert.doesNotMatch(texto(), /preparar_publicacion/);
});

test("sigue sin publicar respuestas a pedidos del radar en grupos", () => {
  process.env.SOFI_PUBLICA_ASESOR = "true";
  assert.match(texto(), /pedidos? del radar/i);
  assert.match(texto(), /confirmar_cita/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/promptasesor-publicar.test.js`
Expected: FAIL en "encendido: explica el flujo de publicar".

- [ ] **Step 3: Editar `promptAsesor`**

1. En el párrafo `CUANDO RESPONDE AL AVISO "🔔 Un pedido del radar no salió solo..."`, reemplazar la frase `vos NUNCA publicas nada en ningun grupo — esa opcion ya no existe, es norma del gremio (Juan, 2026-08-22).` por:

```
vos NUNCA respondes un pedido del radar dentro de un grupo — es norma del gremio (Juan, 2026-08-22). (Publicar una propiedad que el asesor te pide es otra cosa: ver "CUANDO QUIERE PUBLICAR UNA PROPIEDAD".)
```

2. Al inicio de `promptAsesor`, antes de `const stable = ...`:

```js
  const seccionPublicar = require("./publicar-asesor").activo()
    ? `

CUANDO QUIERE PUBLICAR UNA PROPIEDAD (ej "quiero publicar un apto en arriendo", "súbeme esta casa a los grupos"):
- Pedile lo que falte, de a poco y en conversación, nunca como formulario: operación, tipo, barrio y municipio, precio, si es arriendo el período (mensual o por noche) y si está amoblado, área, alcobas y baños, y las fotos (entre 1 y 10, por este chat). Parqueaderos, estrato, administración y una descripción corta son opcionales.
- Cada vez que te dé datos nuevos, llamá preparar_publicacion con TODO lo que te dijo hasta ahora. Si te devuelve FALTAN DATOS, pedile exactamente eso. NUNCA inventes ni supongas un dato.
- Cuando te devuelva la VISTA PREVIA, mostrásela tal cual, decile cuántas fotos recibiste y pedile un sí explícito. Solo con ese sí llamá confirmar_publicacion con los MISMOS datos y el token.
- Al confirmar, decile la ref (D…) y el link de la ficha. No digas que ya salió en un grupo: sale en los próximos turnos del publicador.
- Si te dice que una propiedad que publicó con vos se arrendó, se vendió o ya no está, o que sigue disponible, usá actualizar_vigencia con su ref.`
    : "";
```

y concatenar `${seccionPublicar}` al final del texto de `stable` (justo antes del cierre del template literal de `stable`).

- [ ] **Step 4: Run tests**

Run: `node --test test/promptasesor-publicar.test.js test/promptasesor-confirmar-cita.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts.js test/promptasesor-publicar.test.js
git commit -m "feat(sofi): el prompt del asesor sabe publicar una propiedad"
```

---

### Task 6: Publicador — categoría ofertas, prioridad y aviso al captador

**Files:**
- Modify: `src/groups/publicador.js`
- Modify: `src/scheduler/publicador-grupos.js`
- Test: `test/publicador-grupos.test.js` (agregar al final)

**Interfaces:**
- Consumes: filas de `properties` con `origen`, `created_at`, `captador_id`.
- Produces: `aptaPara(p, "ofertas")`; `elegir` prioriza `origen='asesor'` reciente; deps del scheduler `avisarCaptador(org, propiedad, grupo) -> Promise`.

- [ ] **Step 1: Write the failing tests** (agregar a `test/publicador-grupos.test.js`)

```js
// --- propiedades de asesor (spec 2026-10-19-sofi-publica-propiedad-asesor) ---

const GO = { id: "go", jid: "o@g.us", nombre: "Ofertas", publica: "ofertas" };
function deAsesor(ref, extra = {}) {
  return amoblado(ref, {
    origen: "asesor", operacion: "Venta", titulo: "Casa en venta en Belén", area: "120m2",
    captador_id: "adv-1", created_at: new Date(LUNES_10AM.getTime() - 60 * MIN).toISOString(), ...extra,
  });
}

test("ofertas recibe la venta de un asesor y los amoblados, no la venta de Wasi", () => {
  assert.equal(publicador.aptaPara(deAsesor("D1001"), "ofertas"), true);
  assert.equal(publicador.aptaPara(amoblado("1"), "ofertas"), true);
  assert.equal(publicador.aptaPara(amoblado("2", { operacion: "Venta", titulo: "Casa en venta" }), "ofertas"), false);
  assert.equal(publicador.aptaPara(deAsesor("D1002", { zona: "" }), "ofertas"), false);
  assert.equal(publicador.aptaPara(deAsesor("D1003", { area: null }), "ofertas"), false);
});

test("la propiedad nueva de un asesor sale primero", () => {
  const r = publicador.elegir({ grupos: [GO], propiedades: [amoblado("1"), deAsesor("D1001")], historial: [], ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r.propiedad.ref, "D1001");
});

test("una propiedad de asesor recien creada espera 15 minutos", () => {
  const recien = deAsesor("D1001", { created_at: new Date(LUNES_10AM.getTime() - 5 * MIN).toISOString() });
  const r = publicador.elegir({ grupos: [GO], propiedades: [recien], historial: [], ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r.motivo, "nada_que_publicar");
});

test("el captador recibe un solo aviso, la primera vez que sale", async () => {
  const avisos = [];
  const { d } = deps({
    grupos: async () => [GO],
    propiedades: async () => [deAsesor("D1001")],
    avisarCaptador: async (org, p, g) => avisos.push([p.ref, g.nombre]),
  });
  await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.deepEqual(avisos, [["D1001", "Ofertas"]]);

  scheduler._reset();
  const { d: d2 } = deps({
    grupos: async () => [GO, { ...G1, publica: "ofertas" }],
    propiedades: async () => [deAsesor("D1001")],
    historial: async () => [{ group_id: "go", property_ref: "D1001", estado: "enviado", created_at: hace(60) }],
    avisarCaptador: async (org, p, g) => avisos.push([p.ref, g.nombre]),
  });
  await scheduler.runOnce({ ahora: LUNES_10AM, deps: d2 });
  assert.equal(avisos.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/publicador-grupos.test.js`
Expected: FAIL en los 4 tests nuevos.

- [ ] **Step 3: Cambios en `src/groups/publicador.js`**

Agregar arriba (después de los `require`):

```js
const { parsearArea } = require("../lib/formato");

const ESPERA_ASESOR_MS = 15 * 60000;
const PRIORIDAD_ASESOR_DIAS = 7;

function esDeAsesor(p) {
  return p && p.origen === "asesor";
}

// Lo que un asesor pidio publicar (venta o arriendo) con los datos minimos.
function aptaDeAsesor(p) {
  return esDeAsesor(p) && aptaParaKit(p) && Boolean(String(p.zona || "").trim()) && parsearArea(p.area) !== null;
}
```

> `src/lib/formato.js` exporta `parsearArea` (verificado; lo usa `src/groups/publicable.js`).

En `aptaPara`, antes de `return false;` final:

```js
  if (categoria === "ofertas") return aptaPara(p, "amoblados") || aptaDeAsesor(p);
```

En `elegir`, reemplazar el filtrado y orden de `opciones` por:

```js
    const prioridad = (p) =>
      esDeAsesor(p) && ahora.getTime() - new Date(p.created_at).getTime() < PRIORIDAD_ASESOR_DIAS * DIA_MS ? 0 : 1;
    const opciones = propiedades
      .filter((p) => !excluirRefs.has(String(p.ref)) && !recientes.has(String(p.ref)) && aptaPara(p, grupo.publica))
      .filter((p) => !esDeAsesor(p) || ahora.getTime() - new Date(p.created_at).getTime() >= ESPERA_ASESOR_MS)
      .sort((a, b) => prioridad(a) - prioridad(b) || ultimoDeRef(a.ref) - ultimoDeRef(b.ref) || String(a.ref).localeCompare(String(b.ref)));
```

y agregar `esDeAsesor` al `module.exports`.

- [ ] **Step 4: Cambios en `src/scheduler/publicador-grupos.js`**

En `depsPorDefecto()`, agregar:

```js
    avisarCaptador: async (org, propiedad, grupo) => {
      if (!propiedad.captador_id) return;
      const advisor = await require("../data/advisors").findById(org.id, propiedad.captador_id).catch(() => null);
      if (!advisor || !advisor.phone) return;
      const texto = `📣 Tu ${propiedad.ref} salió en ${grupo.nombre}. Sigue rotando en los demás grupos; si un colega pregunta, te aviso.`;
      const r = await require("../lib/mensaje-asesor").enviarYRegistrar(org, advisor.phone, texto).catch((e) => ({ ok: false, error: e.message }));
      if (!r || !r.ok) console.warn(`[publicador] No se pudo avisar a ${advisor.name} de la ${propiedad.ref}: ${r && r.error}`);
    },
```

En `runParaOrg`, después del `console.log("[publicador] Ref ...")` del envío exitoso y antes del `return { resultado: "enviado", ... }`:

```js
  const yaSalio = historial.some((h) => h.estado === "enviado" && String(h.property_ref) === String(propiedad.ref));
  if (publicador.esDeAsesor(propiedad) && !yaSalio && d.avisarCaptador) {
    await d.avisarCaptador(org, propiedad, grupo).catch((e) => console.warn("[publicador] avisarCaptador:", e.message));
  }
```

- [ ] **Step 5: Run tests**

Run: `node --test test/publicador-grupos.test.js`
Expected: PASS (los 22 anteriores + 4 nuevos).

- [ ] **Step 6: Commit**

```bash
git add src/groups/publicador.js src/scheduler/publicador-grupos.js test/publicador-grupos.test.js
git commit -m "feat(radar): el publicador saca primero la propiedad de un asesor"
```

---

### Task 7: Vigencia — botones, scheduler y plantilla

**Files:**
- Create: `src/lib/vigencia-asesor.js`
- Create: `src/scheduler/vigencia-asesor.js`
- Create: `scripts/create-vigencia-propiedad-template.mjs`
- Modify: `src/channels/whatsapp.js` (~línea 371, ruteo de botones)
- Modify: `src/server.js` (junto a los otros `start()`)
- Test: `test/vigencia-asesor.test.js`

**Interfaces:**
- Consumes: `aplicarVigencia`, `porPreguntar`, `vencidas`, `marcarPreguntada`, `darDeBaja` (Task 3); `enviarYRegistrar(org, tel, texto, { botones })`, `VENTANA_CERRADA` (`src/lib/mensaje-asesor.js`); `sendWhatsAppTemplate(org, to, { name, bodyParams, buttonPayloads })`.
- Produces: `procesarBotonVigencia(org, phone, botonId)`; `runOnce({ ahora, deps })`, `start()`.

- [ ] **Step 1: Write the failing test**

```js
// test/vigencia-asesor.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const vigencia = require("../src/scheduler/vigencia-asesor");
const boton = require("../src/lib/vigencia-asesor");
const datos = require("../src/data/propiedades-asesor");
const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const ADV = { id: "adv-1", name: "Daiana", phone: "573011880668" };
const LUNES_10AM = new Date("2026-10-19T15:00:00Z");

function deps(over = {}) {
  const log = { textos: [], plantillas: [], preguntadas: [], bajas: [] };
  return {
    log,
    d: {
      orgs: async () => [ORG],
      porPreguntar: async () => [],
      vencidas: async () => [],
      advisor: async () => ADV,
      enviarTexto: async (org, tel, texto, opts) => { log.textos.push({ tel, texto, opts }); return { ok: true }; },
      enviarPlantilla: async (org, tel, p) => { log.plantillas.push(p); return { ok: true }; },
      marcarPreguntada: async (id) => log.preguntadas.push(id),
      darDeBaja: async (id) => log.bajas.push(id),
      ...over,
    },
  };
}

beforeEach(() => { delete process.env.SOFI_VIGENCIA_ASESOR; });

test("pregunta una vez con botones vig: si la ventana esta abierta", async () => {
  const { d, log } = deps({ porPreguntar: async () => [{ id: "p1", ref: "D1001", titulo: "Casa en venta en Belén", captador_id: "adv-1" }] });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(log.textos.length, 1);
  assert.match(log.textos[0].texto, /D1001/);
  assert.deepEqual(log.textos[0].opts.botones.map((b) => b.id), ["vig:si:D1001", "vig:no:D1001"]);
  assert.deepEqual(log.preguntadas, ["p1"]);
});

test("ventana cerrada: usa la plantilla vigencia_propiedad", async () => {
  const { d, log } = deps({
    porPreguntar: async () => [{ id: "p1", ref: "D1001", titulo: "Casa", captador_id: "adv-1" }],
    enviarTexto: async () => ({ ok: false, error: "Re-engagement message: more than 24 hours" }),
  });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(log.plantillas[0].name, "vigencia_propiedad");
  assert.deepEqual(log.plantillas[0].buttonPayloads, ["vig:si:D1001", "vig:no:D1001"]);
  assert.deepEqual(log.preguntadas, ["p1"]);
});

test("vencida: sale del inventario aunque la pregunta este apagada", async () => {
  process.env.SOFI_VIGENCIA_ASESOR = "false";
  const { d, log } = deps({
    porPreguntar: async () => [{ id: "p1", ref: "D1001", captador_id: "adv-1" }],
    vencidas: async () => [{ id: "p2", ref: "D1002", captador_id: "adv-1" }],
  });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.deepEqual(log.bajas, ["p2"]);
  assert.equal(log.preguntadas.length, 0);
});

test("fuera de 9 a. m. a 6 p. m. no pregunta", async () => {
  const { d, log } = deps({ porPreguntar: async () => [{ id: "p1", ref: "D1001", captador_id: "adv-1" }] });
  await vigencia.runOnce({ ahora: new Date("2026-10-19T12:00:00Z"), deps: d }); // 7 a. m.
  assert.equal(log.textos.length, 0);
});

test("boton vig:no da de baja la del asesor y le confirma", async (t) => {
  t.mock.method(advisors, "findByPhone", async () => ADV);
  const aplicar = t.mock.method(datos, "aplicarVigencia", async () => ({ estado: "baja", ref: "D1001" }));
  const envios = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, tel, texto) => { envios.push(texto); return { ok: true }; });
  await boton.procesarBotonVigencia(ORG, ADV.phone, "vig:no:D1001");
  assert.deepEqual(aplicar.mock.calls[0].arguments, ["org-1", "adv-1", "D1001", false]);
  assert.match(envios[0], /sale del inventario/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/vigencia-asesor.test.js`
Expected: FAIL con "Cannot find module '../src/scheduler/vigencia-asesor'".

- [ ] **Step 3: `src/lib/vigencia-asesor.js`**

```js
// Botones "Sigue disponible" / "Ya no está" de la pregunta de vigencia (spec
// 2026-10-19-sofi-publica-propiedad-asesor §6). El id trae la ref
// (vig:si:D1001), asi que se resuelve sin pasar por el modelo, como los
// botones cita: de cita_por_confirmar.
const advisors = require("../data/advisors");
const datos = require("../data/propiedades-asesor");
const mensajeAsesor = require("./mensaje-asesor");

async function procesarBotonVigencia(org, telefono, botonId) {
  const m = /^vig:(si|no):([A-Za-z0-9]+)$/.exec(String(botonId || ""));
  if (!m) return;
  const advisor = await advisors.findByPhone(org.id, telefono).catch(() => null);
  if (!advisor) return;
  const r = await datos.aplicarVigencia(org.id, advisor.id, m[2], m[1] === "si").catch((e) => {
    console.error("[vigencia-asesor] No se pudo aplicar el boton:", e.message);
    return null;
  });
  if (!r) return;
  const texto =
    r.estado === "no_encontrada" ? `No encuentro la ${r.ref} entre las propiedades que publicaste con Sofi.`
      : r.estado === "renovada" ? `Listo: la ${r.ref} sigue publicada 30 días más.`
        : `Listo: la ${r.ref} sale del inventario y de los grupos.`;
  await mensajeAsesor.enviarYRegistrar(org, telefono, texto).catch(() => null);
}

module.exports = { procesarBotonVigencia };
```

- [ ] **Step 4: `src/scheduler/vigencia-asesor.js`**

```js
// Vigencia de las propiedades que publico Sofi a pedido de un asesor (spec
// 2026-10-19-sofi-publica-propiedad-asesor §6). Cada hora:
// - las vencidas salen del inventario (siempre);
// - de 9 a. m. a 6 p. m., a las que les quedan 5 dias se le pregunta al
//   captador UNA vez si siguen disponibles. Excepcion explicita a
//   ASESORA_SOLO_VISITAS (Juan, 2026-10-19); SOFI_VIGENCIA_ASESOR=false la
//   apaga y la propiedad vence igual a los 30 dias.
const { VENTANA_CERRADA } = require("../lib/mensaje-asesor");

const BOGOTA_UTC = 5;
const HORA_INICIO = 9;
const HORA_FIN = 18;

function preguntaActiva() {
  return String(process.env.SOFI_VIGENCIA_ASESOR ?? "").trim().toLowerCase() !== "false";
}

function horaBogota(ahora) {
  return new Date(ahora.getTime() - BOGOTA_UTC * 3600e3).getUTCHours();
}

function depsPorDefecto() {
  const datos = require("../data/propiedades-asesor");
  return {
    orgs: () => require("../data/organizations").listActive(),
    porPreguntar: (org, ahora) => datos.porPreguntar(org.id, ahora),
    vencidas: (org, ahora) => datos.vencidas(org.id, ahora),
    advisor: (org, id) => require("../data/advisors").findById(org.id, id),
    enviarTexto: (org, tel, texto, opts) => require("../lib/mensaje-asesor").enviarYRegistrar(org, tel, texto, opts),
    enviarPlantilla: (org, tel, p) => require("../channels/whatsapp").sendWhatsAppTemplate(org, tel, p),
    marcarPreguntada: (id, ahora) => datos.marcarPreguntada(id, ahora),
    darDeBaja: (id) => datos.darDeBaja(id),
  };
}

async function preguntar(org, p, d, ahora) {
  const advisor = p.captador_id ? await d.advisor(org, p.captador_id).catch(() => null) : null;
  if (advisor && advisor.phone && advisor.activo !== false) {
    const texto = `Hola ${String(advisor.name || "").split(" ")[0]}, tu ${p.ref} (${p.titulo || "propiedad"}) vence en 5 días en nuestro inventario. ¿Sigue disponible?`;
    const botones = [{ id: `vig:si:${p.ref}`, title: "Sigue disponible" }, { id: `vig:no:${p.ref}`, title: "Ya no está" }];
    const r = await d.enviarTexto(org, advisor.phone, texto, { botones }).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok && VENTANA_CERRADA.test(String(r.error || ""))) {
      const t = await d.enviarPlantilla(org, advisor.phone, {
        name: "vigencia_propiedad", bodyParams: [p.ref, p.titulo || "tu propiedad"], buttonPayloads: botones.map((b) => b.id),
      }).catch((e) => ({ ok: false, error: e.message }));
      if (!t || !t.ok) console.warn(`[vigencia-asesor] No salio la plantilla para la ${p.ref}: ${t && t.error}`);
    } else if (!r.ok) {
      console.warn(`[vigencia-asesor] No salio la pregunta para la ${p.ref}: ${r.error}`);
    }
  }
  // Se marca aunque no haya salido: la propiedad vence igual (spec §6) y no
  // se reintenta cada hora contra una plantilla sin aprobar.
  await d.marcarPreguntada(p.id, ahora);
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  const d = deps || depsPorDefecto();
  for (const org of await d.orgs()) {
    try {
      for (const p of await d.vencidas(org, ahora)) {
        await d.darDeBaja(p.id);
        console.log(`[vigencia-asesor] ${p.ref} vencio: sale del inventario`);
      }
      const h = horaBogota(ahora);
      if (!preguntaActiva() || h < HORA_INICIO || h >= HORA_FIN) continue;
      for (const p of await d.porPreguntar(org, ahora)) await preguntar(org, p, d, ahora);
    } catch (e) {
      console.error("[vigencia-asesor] error en", org.name, e.message);
    }
  }
}

function start() {
  const tick = () => runOnce().catch((e) => console.error("[vigencia-asesor] runOnce:", e.message));
  setTimeout(tick, 3 * 60 * 1000);
  setInterval(tick, 60 * 60 * 1000);
  console.log(`[vigencia-asesor] activo — pregunta ${preguntaActiva() ? "prendida" : "apagada"} (SOFI_VIGENCIA_ASESOR)`);
}

module.exports = { runOnce, start };
```

> Verificar que `enviarYRegistrar` acepta `{ botones }` (lo documenta `src/lib/mensaje-asesor.js` como `opts.botones`).

- [ ] **Step 5: Ruteo de botones en `src/channels/whatsapp.js`**

En el bloque `if (botonId) { ... }` (~línea 371), agregar antes del `else`:

```js
        } else if (String(botonId).startsWith("vig:")) {
          // Sigue disponible / Ya no está de la pregunta de vigencia (2026-10-19).
          await require("../lib/vigencia-asesor").procesarBotonVigencia(org, userPhone, botonId);
```

(quedando `if (cita:) {...} else if (vig:) {...} else { procesarBotonRadar(...) }`).

- [ ] **Step 6: Arranque en `src/server.js`**

Después de la línea del publicador:

```js
  // Vigencia de las propiedades que publico un asesor con Sofi (Juan, 2026-10-19).
  if (config.supabaseUrl) require("./scheduler/vigencia-asesor").start();
```

- [ ] **Step 7: Plantilla de Meta** — `scripts/create-vigencia-propiedad-template.mjs`

```js
/**
 * Crea la plantilla "vigencia_propiedad" (spec 2026-10-19-sofi-publica-
 * propiedad-asesor §6). A los 25 dias de publicada una propiedad de asesor,
 * la ventana de 24 h casi seguro esta cerrada: sin plantilla, la pregunta no
 * sale. Se corre UNA vez:
 *   railway run --service diamond node scripts/create-vigencia-propiedad-template.mjs
 * Queda en PENDING hasta que Meta la revise.
 */
const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = "1702397800906189"; // WABA de produccion (+57 304 4653609)
if (!TOKEN) {
  console.error("Falta WHATSAPP_TOKEN.");
  process.exit(1);
}
const payload = {
  name: "vigencia_propiedad",
  language: "es",
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text: "Hola, soy Sofi de Diamond Inmobiliaria. Tu propiedad {{1}} ({{2}}) vence en 5 días en nuestro inventario. ¿Sigue disponible?",
      example: { body_text: [["D1001", "Apartamento amoblado en arriendo en Laureles"]] },
    },
    { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Sigue disponible" }, { type: "QUICK_REPLY", text: "Ya no está" }] },
  ],
};
const res = await fetch(`https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
console.log(res.status, await res.text());
```

- [ ] **Step 8: Run tests**

Run: `node --test test/vigencia-asesor.test.js`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/vigencia-asesor.js src/scheduler/vigencia-asesor.js src/channels/whatsapp.js src/server.js scripts/create-vigencia-propiedad-template.mjs test/vigencia-asesor.test.js
git commit -m "feat(sofi): vigencia de 30 días para la propiedad de un asesor"
```

---

### Task 8: Verificación del radar, suite completa y documentación

**Files:**
- Test: `test/publicable-asesor.test.js`
- Modify: `CLAUDE.md` (§2 Estado actual)

**Interfaces:**
- Consumes: `publicable.esPublicable(match, opts)` (`src/groups/publicable.js`), `withLandingLink` (`src/data/properties.js`).

- [ ] **Step 1: Test de que el radar acepta la ficha de un asesor**

```js
// test/publicable-asesor.test.js
// Una propiedad de asesor tiene como `link` la ficha de la landing. El radar
// exige linkWasi no vacio y un link que no sea de Wasi: con withLandingLink
// la ficha de la landing pasa las dos compuertas.
const { test } = require("node:test");
const assert = require("node:assert");
const { withLandingLink } = require("../src/data/properties");
const publicable = require("../src/groups/publicable");

test("la ficha de la landing de un asesor no cae en sin_link_wasi ni link_ajeno", () => {
  const p = withLandingLink({
    ref: "D1001", titulo: "Casa en venta en Belén", operacion: "Venta", precio: "$450.000.000", zona: "Belén", area: "120m2",
    link: "https://diamondinmobiliaria.com/propiedades/casa-en-venta-en-belen-d1001", disponible: true,
  }, "https://diamondinmobiliaria.com");
  const r = publicable.esPublicable({ ...p, fuente: "diamond", puntaje: 95 }, { syncFresco: true });
  assert.ok(!r.motivos.includes("sin_link_wasi"), JSON.stringify(r.motivos));
  assert.ok(!r.motivos.includes("link_ajeno"), JSON.stringify(r.motivos));
});
```

Run: `node --test test/publicable-asesor.test.js`
Expected: PASS. Si falla por otro motivo de la lista, leer `esPublicable` (`src/groups/publicable.js:69-206`) y ajustar SOLO el fixture (campos que una fila real de asesor sí tiene); no aflojar compuertas.

- [ ] **Step 2: Suite completa**

Run: `npm test`
Expected: todo en verde (2.311 + los nuevos).

- [ ] **Step 3: CLAUDE.md**

Agregar al inicio de "## 2. Estado actual":

```markdown
- **Sofi publica la propiedad de un asesor (rama `sofi-publica-asesor`,
  2026-10-19, SIN desplegar).** Spec
  `docs/superpowers/specs/2026-10-19-sofi-publica-propiedad-asesor-design.md`.
  El asesor le pide a Sofi publicar; ella pide los datos y fotos
  (`preparar_publicacion` / `confirmar_publicacion`), crea la ref `D1001…`
  con ficha en la landing (`origen='asesor'`, captador = el asesor) y el
  publicador la saca primero (categoría `ofertas`). Vence a los 30 días;
  a los 25 se le pregunta (`vig:si|no:<ref>`, plantilla `vigencia_propiedad`).
  Interruptores `SOFI_PUBLICA_ASESOR` y `SOFI_VIGENCIA_ASESOR`.
  **Pendiente:** migración `2026-10-19_propiedades_asesor.sql` (Juan) y crear
  la plantilla con `scripts/create-vigencia-propiedad-template.mjs`.
```

- [ ] **Step 4: Commit**

```bash
git add test/publicable-asesor.test.js CLAUDE.md
git commit -m "docs: estado de Sofi publicando la propiedad de un asesor"
```

# Publicador mixto y acorde al grupo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el publicador de grupos saque 2 posts por grupo al día, solo propiedades que encajan con el grupo (zona, operación, tipo), con la mezcla venta/arriendo en OFERTAS y arriendo con o sin amoblar en los grupos de arriendo.

**Architecture:** Módulo puro nuevo `src/groups/perfil-grupo.js` (perfil desde nombre + override + pedidos del grupo). `src/groups/publicador.js` gana la categoría `arriendos`, el encaje por perfil, franjas y el orden nuevo dentro de `elegir`. El scheduler `src/scheduler/publicador-grupos.js` carga perfiles y pedidos por grupo, lee `RADAR_PUBLICAR_POR_GRUPO`, baja el espaciado y alerta si un grupo que publica no escucha.

**Tech Stack:** Node.js (CommonJS), `node:test`, Supabase.

**Spec:** `docs/superpowers/specs/2026-10-26-publicador-mixto-design.md`

## Global Constraints

- `RADAR_PUBLICAR_POR_GRUPO` default **1** (con 1 el comportamiento de franjas es el de hoy: 8:00–17:59 en cualquier momento). Con 2: post 0 de un grupo solo en 8:00–11:59, post 1 solo en 14:00–17:59 (Bogotá, lunes a sábado).
- Espaciado entre posts: **15–30 min** (antes 20–40).
- Zona (Juan, 2026-10-26): grado `exacta` con `require("./ubicacion").zonaCoincide(p, { zonas })` (exacta o sub-zona); si no, grado `vecina` con `zonaVecina(p, { zonas })`; si no, no entra. En el orden, TODA exacta va antes que cualquier vecina. Solo para publicaciones; el DM al colega no cambia.
- Categoría `arriendos`: `aptaParaKit`, arriendo, precio creíble, mensual (periodo Wasi `mensual`, o sin periodo y sin texto de noche/día: usar `periodoDudoso(p) === false`), con zona, no finca; amoblado o no.
- `ofertas` acepta además todo lo que acepta `arriendos`.
- Mezcla (solo `ofertas`): franja mañana → venta primero; tarde → arriendo primero.
- Nada cambia con `RADAR_PUBLICAR_ACTIVO` apagado. Sin la columna `perfil` no falla (perfil solo por nombre).
- Commits en español con prefijo convencional y una línea `Co-Authored-By:` con el modelo que la escribe.
- Tests: `node --test test/<archivo>.test.js`; suite: `npm test` (hoy 2.901 en verde).

## Archivos

- Create `db/migrations/2026-10-26_publicador_mixto.sql`
- Create `src/groups/perfil-grupo.js`, `test/perfil-grupo.test.js`
- Modify `src/groups/publicador.js`, `test/publicador-grupos.test.js` (+ `test/publicador-mixto.test.js` nuevo)
- Modify `src/scheduler/publicador-grupos.js`
- Modify `.env.example`, `CLAUDE.md`

---

### Task 1: Migración y perfil del grupo

**Files:**
- Create: `db/migrations/2026-10-26_publicador_mixto.sql`
- Create: `src/groups/perfil-grupo.js`
- Test: `test/perfil-grupo.test.js`

**Interfaces — Produces:**
- `perfilDe(grupo, pedidos = []) → { zonas: string[], operacion: "venta"|"arriendo"|null, tipos: string[], pedidos: object[] }`
  - `grupo`: `{ nombre, publica, perfil? }`; `pedidos`: filas de `group_signals` (`operacion, tipo, zona, zonas, precio_max`).
- `ZONAS_POR_PALABRA` (objeto exportado, para tests).

- [ ] **Step 1: Migración**

```sql
-- Publicador mixto y acorde al grupo (spec 2026-10-26-publicador-mixto).
-- 1. Override manual del perfil del grupo: {"zonas":[...],"operacion":"venta|arriendo","tipos":[...]}.
alter table whatsapp_groups add column if not exists perfil jsonb;
-- 2. Categoria nueva: arriendo mensual con o sin amoblar.
alter table whatsapp_groups drop constraint if exists whatsapp_groups_publica_check;
alter table whatsapp_groups add constraint whatsapp_groups_publica_check
  check (publica is null or publica in ('amoblados', 'fincas', 'ofertas', 'arriendos'));
-- 3. ARRIENDOS 7AM 8PM (717 miembros) pasa a arriendos (Juan, 2026-10-26).
update whatsapp_groups set publica = 'arriendos' where jid = '573003371490-1496864741@g.us';
```

- [ ] **Step 2: Test que falla** — `test/perfil-grupo.test.js`:

```js
// Perfil del grupo para el publicador (spec 2026-10-26-publicador-mixto §3).
const { test } = require("node:test");
const assert = require("node:assert");
const { perfilDe } = require("../src/groups/perfil-grupo");

const g = (nombre, publica = "ofertas", perfil = null) => ({ nombre, publica, perfil });

test("OFERTAS SUR POB ENV SAB: Poblado, Envigado, Sabaneta y el sur", () => {
  const p = perfilDe(g("OFERTAS SUR POB ENV SAB"));
  for (const z of ["El Poblado", "Envigado", "Sabaneta", "La Estrella", "Itagüí", "Caldas"]) assert.ok(p.zonas.includes(z), z);
  assert.strictEqual(p.operacion, null);
});

test("sin palabra de zona acepta todas", () => {
  assert.deepStrictEqual(perfilDe(g("OFERTAS 7:00 A.M.8:00P.M.")).zonas, []);
  assert.deepStrictEqual(perfilDe(g("ARRIENDOS 7AM 8PM", "arriendos")).zonas, []);
});

test("palabra completa: 'SABANETA' sí, 'SABADO' no; tildes no importan", () => {
  assert.deepStrictEqual(perfilDe(g("SOLO SABANETA")).zonas, ["Sabaneta"]);
  assert.deepStrictEqual(perfilDe(g("Pedidos del SABADO")).zonas, []);
  assert.deepStrictEqual(perfilDe(g("SOLO BELÉN")).zonas, ["Belén"]);
});

test("NORTE solo con ANT; OCCIDENTE y ORIENTE", () => {
  assert.ok(perfilDe(g("FINCAS NORTE ANT 7AM 8PM", "fincas")).zonas.includes("Bello"));
  assert.deepStrictEqual(perfilDe(g("Bodegas zona NORTE")).zonas, []);
  assert.ok(perfilDe(g("OCCIDENTE 2", "fincas")).zonas.includes("San Jerónimo"));
  assert.ok(perfilDe(g("PEDIDOS ORIENTE", "fincas")).zonas.includes("Rionegro"));
});

test("operación por nombre; si dice venta y renta decide la categoría", () => {
  assert.strictEqual(perfilDe(g("ARRIENDOS 7AM 8PM", "arriendos")).operacion, "arriendo");
  assert.strictEqual(perfilDe(g("SOLO VENTAS", "ofertas")).operacion, "venta");
  assert.strictEqual(perfilDe(g("Renta y Venta Amoblados y Airbnb", "amoblados")).operacion, "arriendo");
  assert.strictEqual(perfilDe(g("Renta y Venta", "ofertas")).operacion, null);
});

test("el override manual manda campo por campo", () => {
  const p = perfilDe(g("OFERTAS SUR POB ENV SAB", "ofertas", { zonas: ["Laureles"], operacion: "venta" }));
  assert.deepStrictEqual(p.zonas, ["Laureles"]);
  assert.strictEqual(p.operacion, "venta");
  assert.deepStrictEqual(perfilDe(g("X", "ofertas", { tipos: ["Casa"] })).tipos, ["Casa"]);
});

test("los pedidos del grupo viajan en el perfil", () => {
  const pedidos = [{ operacion: "venta", zona: "Envigado" }];
  assert.deepStrictEqual(perfilDe(g("X"), pedidos).pedidos, pedidos);
});
```

- [ ] **Step 3: Correr y ver que falla** — `node --test test/perfil-grupo.test.js` → `Cannot find module`.

- [ ] **Step 4: Implementar** — `src/groups/perfil-grupo.js`:

```js
// Perfil de un grupo para el publicador (Juan, 2026-10-26; spec
// docs/superpowers/specs/2026-10-26-publicador-mixto-design.md §3): que zonas,
// que operacion y que tipos acepta. Del nombre del grupo, con override manual
// en whatsapp_groups.perfil. Los pedidos del grupo no restringen: ordenan.
const ZONAS_POR_PALABRA = {
  sur: ["Envigado", "Sabaneta", "La Estrella", "Itagüí", "Caldas"],
  pob: ["El Poblado"], poblado: ["El Poblado"],
  env: ["Envigado"], envigado: ["Envigado"],
  sab: ["Sabaneta"], sabaneta: ["Sabaneta"],
  itagui: ["Itagüí"], estrella: ["La Estrella"],
  laureles: ["Laureles"], belen: ["Belén"],
  oriente: ["Rionegro", "El Retiro", "La Ceja", "Guarne", "Marinilla", "El Carmen de Viboral", "Llanogrande"],
  occidente: ["San Jerónimo", "Santa Fe de Antioquia", "Sopetrán"],
};
const NORTE_ANT = ["Bello", "Copacabana", "Girardota", "Barbosa", "San Pedro de los Milagros", "Santa Rosa de Osos"];

const palabras = (s) =>
  String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function zonasDelNombre(ps) {
  const out = [];
  for (const w of ps) for (const z of ZONAS_POR_PALABRA[w] || []) if (!out.includes(z)) out.push(z);
  if (ps.includes("norte") && ps.includes("ant")) for (const z of NORTE_ANT) if (!out.includes(z)) out.push(z);
  return out;
}

function operacionDelNombre(ps, publica) {
  const arriendo = ps.some((w) => /^(arriendos?|renta|rentas|amoblados?|airbnb)$/.test(w));
  const venta = ps.some((w) => /^ventas?$/.test(w));
  if (arriendo && venta) return publica === "amoblados" || publica === "arriendos" || publica === "fincas" ? "arriendo" : null;
  if (arriendo) return "arriendo";
  if (venta) return "venta";
  return publica === "amoblados" || publica === "arriendos" ? "arriendo" : null;
}

function perfilDe(grupo, pedidos = []) {
  const ps = palabras(grupo && grupo.nombre);
  const o = (grupo && grupo.perfil && typeof grupo.perfil === "object") ? grupo.perfil : {};
  return {
    zonas: Array.isArray(o.zonas) ? o.zonas : zonasDelNombre(ps),
    operacion: o.operacion === "venta" || o.operacion === "arriendo" ? o.operacion : operacionDelNombre(ps, grupo && grupo.publica),
    tipos: Array.isArray(o.tipos) ? o.tipos : [],
    pedidos: Array.isArray(pedidos) ? pedidos : [],
  };
}

module.exports = { perfilDe, ZONAS_POR_PALABRA };
```

- [ ] **Step 5: GREEN** — `node --test test/perfil-grupo.test.js` → 7/7.

- [ ] **Step 6: Commit** — `feat(publicador): perfil del grupo por nombre y override, y migracion de la categoria arriendos`.

---

### Task 2: Encaje, categoría `arriendos`, franjas y orden en `publicador.js`

**Files:**
- Modify: `src/groups/publicador.js`
- Modify: `test/publicador-grupos.test.js` (solo si un nombre de grupo de prueba activa un filtro de zona: renombrar el fixture, no cambiar la intención)
- Test: `test/publicador-mixto.test.js` (nuevo)

**Interfaces:**
- Consumes: `perfilDe` (Task 1); `require("./ubicacion").zonaCoincide(p, c)`.
- Produces (exportar además de lo existente):
  - `aptaPara(p, "arriendos")` funciona.
  - `aptaParaGrupo(p, grupo, perfil) → "exacta" | "vecina" | null`
  - `franjaDe(ahora) → 0 | 1 | null` (0 = 8:00–11:59, 1 = 14:00–17:59, null fuera; con lunes a sábado).
  - `elegir({ ..., porGrupo = 1, perfiles = new Map() })` — `perfiles`: Map `group_id → perfil`; si falta, `perfilDe(grupo)`.

Cambios en `publicador.js`:

1. En `aptaPara`, agregar la rama `arriendos` y extender `ofertas`:

```js
function aptaArriendo(p) {
  if (!aptaParaKit(p) || !esArriendo(p) || !precioArriendoCreible(p)) return false;
  if (esFinca(p) || !String(p.zona || "").trim()) return false;
  return !periodoDudoso(p);
}
// en aptaPara, primera linea:
//   if (categoria === "ofertas") return aptaDeAsesor(p) || aptaVentaWasi(p) || aptaPara(p, "amoblados") || aptaArriendo(p);
//   if (categoria === "arriendos") return aptaArriendo(p);
```

2. Encaje con el perfil:

```js
const { zonaCoincide, zonaVecina } = require("./ubicacion");
const normTipo = (t) => {
  const s = String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  return /^(duplex|penthouse|pent house|loft)$/.test(s) ? "apartamento" : s;
};
// Grado de encaje: "exacta", "vecina" (excepcion de Juan para grupos) o null.
function aptaParaGrupo(p, grupo, perfil) {
  if (!aptaPara(p, grupo.publica)) return null;
  if (perfil.operacion === "venta" && !esVenta(p)) return null;
  if (perfil.operacion === "arriendo" && !esArriendo(p)) return null;
  if (perfil.tipos.length && !perfil.tipos.map(normTipo).includes(normTipo(p.tipo))) return null;
  if (!perfil.zonas.length) return "exacta";
  if (zonaCoincide(p, { zonas: perfil.zonas })) return "exacta";
  if (zonaVecina(p, { zonas: perfil.zonas })) return "vecina";
  return null;
}
```

3. Franjas:

```js
function franjaDe(ahora) {
  if (!enHorario(ahora)) return null;
  const { hora } = partesBogota(ahora);
  if (hora >= 8 && hora < 12) return 0;
  if (hora >= 14 && hora < 18) return 1;
  return null;
}
```

4. Pedidos del grupo que calzan y ficha completa:

```js
function pedidosQueCalzan(p, pedidos) {
  let n = 0;
  for (const s of pedidos || []) {
    const op = /arriend|renta|alquil/i.test(String(s.operacion || "")) ? "arriendo" : /venta/i.test(String(s.operacion || "")) ? "venta" : null;
    if (op === "venta" && !esVenta(p)) continue;
    if (op === "arriendo" && !esArriendo(p)) continue;
    const tieneZona = (Array.isArray(s.zonas) && s.zonas.length) || s.zona;
    if (tieneZona && !zonaCoincide(p, s)) continue;
    if (s.precio_max && precioNumerico(p) > Number(s.precio_max) * 1.1) continue;
    n++;
  }
  return n;
}
function completitud(p) {
  return (parsearArea(p.area) !== null ? 1 : 0) + (String(p.administracion || "").trim() ? 1 : 0) + (Array.isArray(p.images) && p.images.filter(Boolean).length ? 1 : 0);
}
```

5. En `elegir`:
   - Firma: agregar `porGrupo = 1, perfiles = new Map()`.
   - Tope por grupo: `const deHoyGrupo = (id) => deHoy.filter((h) => h.group_id === id).length;` Con `porGrupo === 1`, candidato si `deHoyGrupo(g.id) === 0` (igual que hoy). Con `porGrupo > 1`: `const f = franjaDe(ahora); if (f === null) return { motivo: "entre_franjas" };` y candidato si `deHoyGrupo(g.id) === f` y `f < porGrupo` (así el post 0 solo sale en la mañana y el 1 en la tarde; si la mañana se perdió, la tarde no manda dos).
   - Filtro: reemplazar `aptaPara(p, grupo.publica)` por `aptaParaGrupo(p, grupo, perfil) !== null` con `const perfil = perfiles.get(grupo.id) || perfilDe(grupo);` (require `./perfil-grupo`); guardar el grado por ref (Map) para ordenar.
   - Orden (sort, en este orden): `grado` (exacta 0, vecina 1) → `prioridad` (asesor) → `mezcla` → `salioHoy` → `-calza` → `-completitud` → `ultimoDeRef` → ref.
     - `mezcla(p)`: solo si `grupo.publica === "ofertas"`; con `franja === 1` (tarde, o `porGrupo === 1` y hora ≥ 14) → `esArriendo(p) ? 0 : 1`; si no → `esVenta(p) ? 0 : 1`. En otros grupos 0.
     - `calza(p)`: si `perfil.pedidos.length` → `pedidosQueCalzan(p, perfil.pedidos)`; si no, en `ofertas` y venta → `demandaDe(p, demanda)` (lo de hoy); si no 0.
   - Reemplaza `clase` y `pedidos` actuales (quedan cubiertos por `mezcla` y `calza`).

6. Encabezado: en `encabezado`, tratar `arriendos` como `ofertas` para el texto (la propiedad decide: amoblado → aperturas de amoblados, si no `🔑 {tipo} en arriendo`). Cambiar `if (categoria === "ofertas")` por `if (categoria === "ofertas" || categoria === "arriendos")`.

Tests (`test/publicador-mixto.test.js`, mismo estilo y fixtures que `test/publicador-grupos.test.js`; usar lunes 2026-10-19 10:00 a. m. Bogotá = 15:00Z y 3:00 p. m. = 20:00Z):
- `aptaPara(arriendoSinAmoblar, "arriendos")` true; por noche false; finca false; sin zona false; `ofertas` acepta el arriendo sin amoblar.
- `aptaParaGrupo`: grupo "OFERTAS SUR POB ENV SAB" da `"exacta"` para "El Poblado" y "Envigado"; para una zona contigua según `VECINDAD` de src/lib/zonas.js (elegir una que de verdad sea vecina de alguna del perfil y no esté en él) da `"vecina"`; para una zona lejana (ej. "Bello") da `null`; un grupo sin zonas da `"exacta"` siempre; grupo con perfil `operacion: "venta"` rechaza arriendo; perfil `tipos: ["Casa"]` rechaza apartamento y acepta casa; "Duplex" cuenta como apartamento.
- `franjaDe`: 9:00 → 0, 12:30 → null, 15:00 → 1, 18:00 → null, domingo → null.
- `elegir` con `porGrupo: 2`: en la mañana un grupo sin posts hoy es candidato; con 1 post hoy no lo es; en la tarde con 1 post hoy sí, con 2 no; a las 12:30 → `{ motivo: "entre_franjas" }`; con `porGrupo: 1` a las 12:30 sí publica (comportamiento de hoy).
- Mezcla en `ofertas`: con una venta y un arriendo aptos, mañana elige la venta, tarde el arriendo.
- `calza`: con pedidos del grupo de venta en Envigado ≤ $500 M, entre dos ventas aptas gana la de Envigado a $450 M sobre la de Envigado a $900 M y sobre la de Sabaneta.
- Ficha completa desempata: misma calza, gana la que tiene área y administración.
- Exacta antes que vecina: en un grupo con zonas, si hay una exacta y una vecina aptas, sale la exacta aunque la vecina tenga más pedidos que calzan; si solo hay vecina, sale la vecina; si no hay ni exacta ni vecina, `nada_que_publicar`.

- [ ] Steps: test que falla → implementar → `node --test test/publicador-mixto.test.js test/publicador-grupos.test.js` → `npm test` → commit `feat(publicador): perfil por grupo, categoria arriendos, dos franjas y mezcla venta/arriendo`.

---

### Task 3: Scheduler

**Files:**
- Modify: `src/scheduler/publicador-grupos.js`
- Test: `test/publicador-grupos.test.js` (agregar casos)

**Interfaces — Consumes:** `publicador.elegir({ ..., porGrupo, perfiles })`, `perfilDe` (Task 1/2).

Cambios:
1. `ESPACIO_MIN = 15`, `ESPACIO_MAX = 30`. El espaciado tras reinicio usa `ESPACIO_MIN`.
2. `function porGrupo() { const n = Number(process.env.RADAR_PUBLICAR_POR_GRUPO || 1); return n === 2 ? 2 : 1; }` (solo 1 o 2; cualquier otro valor → 1). Exportarla.
3. `d.grupos(org)`: `select("id, jid, nombre, publica, modo, perfil")`; si el error menciona la columna `perfil`, reintentar sin ella (perfil = null).
4. Nueva dep `d.pedidosPorGrupo(org, ids) → Map group_id → filas`: `group_signals` con `clase = 'demanda'`, `group_id in ids`, últimos 30 días, `select("group_id, operacion, tipo, zona, zonas, precio_max")`, `limit(5000)`. Falla abierta → `new Map()`.
5. En `runParaOrg`: después de cargar grupos, alerta de escucha: `const sordos = grupos.filter((g) => g.publica && g.modo === "ignorar");` si hay y `estado.avisoSordosDia !== hoy` → `console.warn("[publicador] publica pero no escucha:", nombres)` y `await d.alertar("Hay grupos donde publicamos que el radar no escucha.", nombres.join(", "))`; `estado.avisoSordosDia = hoy`. (Agregar `avisoSordosDia` a `estado` y a `_reset`.)
6. Construir `perfiles = new Map(grupos.map((g) => [g.id, perfilDe(g, pedidos.get(g.id) || [])]))` y pasar `porGrupo: porGrupo(), perfiles` a `elegir`.
7. `start()`: log `[publicador] PRENDIDO — máx ${maxDia()} por día, ${porGrupo()} por grupo`.

Tests (con las deps falsas que ya usa `test/publicador-grupos.test.js`):
- Con `RADAR_PUBLICAR_POR_GRUPO=2` y un grupo que ya tuvo su post de la mañana, a las 3 p. m. publica el segundo; a la 1 p. m. no publica (`entre_franjas`).
- Espaciado: tras un envío, `noAntesDe` queda entre 15 y 30 min (con `azar` 0 → 15, 1 → 30).
- Un grupo con `publica` y `modo: "ignorar"` dispara `alertar` una sola vez por día.
- `pedidosPorGrupo` se usa para ordenar (la venta que calza con el pedido del grupo sale primero).
- `porGrupo()` con "3" o vacío → 1.

- [ ] Steps: test que falla → implementar → `node --test test/publicador-grupos.test.js test/publicador-mixto.test.js` → `npm test` → commit `feat(publicador): dos posts por grupo, pedidos del grupo y alerta de grupos que no escuchan`.

---

### Task 4: Configuración y documentación

- `.env.example`: agregar bajo las variables del publicador:

```bash
# Publicador mixto (spec 2026-10-26): 1 o 2 posts por grupo al dia (2 = manana y tarde).
RADAR_PUBLICAR_POR_GRUPO=1
```

- `CLAUDE.md` §2: bullet nuevo arriba del de "Preparación para las primeras visitas":

```markdown
- **Publicador mixto (2026-10-26, rama `publicador-mixto`).** Spec
  `docs/superpowers/specs/2026-10-26-publicador-mixto-design.md`. Cada grupo
  tiene perfil (zonas y operación por el nombre, override en
  `whatsapp_groups.perfil`); solo sale lo que encaja (zona literal, sin
  vecinas). Categoría `arriendos` (con y sin amoblar; ARRIENDOS 7AM 8PM).
  OFERTAS mezcla: venta en la mañana, arriendo en la tarde. Orden por pedidos
  del propio grupo y ficha completa. `RADAR_PUBLICAR_POR_GRUPO=2` (mañana
  8–12, tarde 2–6) y `RADAR_PUBLICAR_MAX_DIA=20`. Migración
  `2026-10-26_publicador_mixto.sql` (Juan).
```

- `npm test` en verde; commit `docs: publicador mixto en CLAUDE.md y .env.example`.

# Plan 2 — Puente colega → Sofi (código en el DM)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el DM del radar lleve dos links a la línea oficial de Sofi ("agendar visita" y "más opciones o dudas") con un código corto del pedido, y que cuando el colega escribe con ese código Sofi lo reconozca como colega, le amarre su teléfono real a su ficha y retome ese pedido.

**Architecture:** Módulo nuevo `src/groups/codigo-colega.js` (generar, asignar, leer, resolver, amarrar). `redactar.mensajesAlColega` recibe `codigo` y arma los links con `linkContactoOficial(org, texto)`. `vivo.js` asigna el código antes de componer en los cuatro caminos. `engine.js` reconoce el código antes que el directorio.

**Tech Stack:** Node.js (CommonJS), `node:test`, Supabase.

Spec: `docs/superpowers/specs/2026-10-07-sofi-vendedora-y-agenda-design.md` §3. Migración ya corrida y verificada (2026-10-07): `group_signals.codigo_colega`, `colega_escribio_at`, índice único `(org_id, codigo_colega)`.

## Global Constraints

- **Los links van solo en el primer mensaje del DM (el del colega), nunca en las fichas:** las fichas se reenvían tal cual al cliente final; un link con el código del colega en una ficha haría que el cliente le escriba a Sofi saltándose al colega. (Ajuste a la spec §3.2.)
- Código: 4 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin 0/O/1/I), único por org.
- Sin código (falla la asignación o el colega lo borra): todo funciona como hoy. Sin número oficial configurado: el DM sale sin links, como hoy.
- Amarre de teléfono: solo si la fila del colega no tiene teléfono; si tiene otro distinto, se registra en log y no se pisa.
- Firma "— Sofi, asistente virtual" sin cambios.
- `npm test` en verde (baseline 2061 al 2026-10-07).

## File Structure

| Archivo | Cambio |
|---|---|
| `src/groups/codigo-colega.js` | nuevo |
| `src/lib/contacto.js` | `linkContactoOficial(org, texto)` |
| `src/groups/redactar.js` | `mensajesAlColega(..., { codigo })` |
| `src/groups/vivo.js` | asignar código en los 4 llamados a `mensajesAlColega` |
| `src/agent/engine.js` | reconocer por código |
| `test/codigo-colega.test.js` | nuevo |
| `test/contacto.test.js`, `test/dm-separados.test.js` | agregar casos |

---

### Task 1: Módulo codigo-colega

**Files:** Create `src/groups/codigo-colega.js`; Test `test/codigo-colega.test.js`

**Interfaces — Produces:**
- `generarCodigo(rand = Math.random) -> string` (4 chars)
- `leerCodigo(texto) -> string|null`
- `asignarCodigo(orgId, signalId) -> Promise<string|null>`
- `resolver(orgId, codigo) -> Promise<signal|null>` (fila de group_signals con `id, autor_nombre, respuesta_destino_lid, respuesta_destino_telefono, texto_original, zona, tipo, operacion, created_at, matches, respuesta_refs, respondida_at, codigo_colega`)
- `reconocer(orgId, telefono, texto) -> Promise<{ colega, senal }|null>`

- [ ] **Step 1: Write the failing test**

```js
// test/codigo-colega.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const cc = require("../src/groups/codigo-colega");

beforeEach(() => {
  memory.groupSignals.length = 0;
  memory.colegasGrupos.length = 0;
});

test("el código tiene 4 caracteres legibles (sin 0, O, 1, I)", () => {
  for (let i = 0; i < 200; i++) assert.match(cc.generarCodigo(), /^[A-HJ-NP-Z2-9]{4}$/);
});

test("lee el código del texto prellenado, sin importar mayúsculas ni tilde", () => {
  assert.strictEqual(cc.leerCodigo("Hola Sofi, quiero agendar una visita para mi PEDIDO (cód. D7K2)"), "D7K2");
  assert.strictEqual(cc.leerCodigo("hola (cod d7k2)"), "D7K2");
  assert.strictEqual(cc.leerCodigo("Hola, me interesa la 10128030"), null);
  assert.strictEqual(cc.leerCodigo(null), null);
});

test("asigna un código a la señal y lo resuelve de vuelta", async () => {
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", autor_nombre: "Laura", respuesta_destino_lid: "111222333444555@lid" });
  const codigo = await cc.asignarCodigo("org-1", "s1");
  assert.match(codigo, /^[A-HJ-NP-Z2-9]{4}$/);
  const s = await cc.resolver("org-1", codigo);
  assert.strictEqual(s.id, "s1");
  assert.strictEqual(await cc.resolver("org-2", codigo), null, "el código es por org");
});

test("si la señal ya tenía código, se reusa", async () => {
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", codigo_colega: "ABCD" });
  assert.strictEqual(await cc.asignarCodigo("org-1", "s1"), "ABCD");
});

test("reconocer: amarra el teléfono al colega que solo tenía lid y marca que escribió", async () => {
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", autor_nombre: "Laura Gómez", respuesta_destino_lid: "111222333444555@lid", codigo_colega: "D7K2" });
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "111222333444555", telefono: null, nombre: "Laura Gómez", grupos: [] });
  const r = await cc.reconocer("org-1", "573125550000", "Hola Sofi, quiero más opciones para mi PEDIDO (cód. D7K2)");
  assert.strictEqual(r.senal.id, "s1");
  assert.deepStrictEqual(r.colega, { lid: "111222333444555", telefono: "573125550000", nombre: "Laura Gómez" });
  assert.strictEqual(memory.colegasGrupos[0].telefono, "573125550000");
  assert.ok(memory.groupSignals[0].colega_escribio_at);
});

test("reconocer: si el colega ya tenía OTRO teléfono, no se pisa", async () => {
  memory.groupSignals.push({ id: "s1", org_id: "org-1", clase: "demanda", autor_nombre: "Laura", respuesta_destino_lid: "111222333444555@lid", codigo_colega: "D7K2" });
  memory.colegasGrupos.push({ id: "c1", org_id: "org-1", lid: "111222333444555", telefono: "573009998877", nombre: "Laura", grupos: [] });
  const r = await cc.reconocer("org-1", "573125550000", "(cód. D7K2)");
  assert.strictEqual(memory.colegasGrupos[0].telefono, "573009998877");
  assert.strictEqual(r.colega.telefono, "573125550000", "igual se lo atiende como colega en esta conversación");
});

test("reconocer: sin código o código desconocido devuelve null", async () => {
  assert.strictEqual(await cc.reconocer("org-1", "573125550000", "hola"), null);
  assert.strictEqual(await cc.reconocer("org-1", "573125550000", "(cód. ZZZZ)"), null);
});
```

- [ ] **Step 2:** `node --test test/codigo-colega.test.js` → FAIL (módulo no existe)

- [ ] **Step 3: Implement**

```js
// src/groups/codigo-colega.js
// El puente del DM del radar a Sofi (spec 2026-10-07 §3). El DM sale por la
// linea de los grupos y casi todos los colegas los tenemos solo por lid (sin
// telefono), asi que cuando escribian a la linea oficial Sofi los trataba como
// clientes. Cada DM lleva un codigo corto en los links a Sofi; cuando el colega
// escribe con ese codigo, Sofi sabe que pedido es y le amarramos el telefono
// real a su ficha (colegas_grupos), para reconocerlo siempre despues.

const supabase = require("../data/supabase");
const memory = require("../data/memory");
const colegas = require("../data/colegas");
const { mismoTelefono } = require("../data/advisors");

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const COLUMNAS = "id, autor_nombre, respuesta_destino_lid, respuesta_destino_telefono, texto_original, zona, tipo, operacion, created_at, matches, respuesta_refs, respondida_at, codigo_colega";

function generarCodigo(rand = Math.random) {
  let c = "";
  for (let i = 0; i < 4; i++) c += ALFABETO[Math.floor(rand() * ALFABETO.length)];
  return c;
}

function leerCodigo(texto) {
  const m = /c[oó]d\.?\s*([A-Za-z0-9]{4})\b/i.exec(String(texto || ""));
  if (!m) return null;
  const c = m[1].toUpperCase();
  return /^[A-HJ-NP-Z2-9]{4}$/.test(c) ? c : null;
}

async function asignarCodigo(orgId, signalId) {
  if (!orgId || !signalId) return null;
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.org_id === orgId && x.id === signalId);
    if (!s) return null;
    if (!s.codigo_colega) s.codigo_colega = generarCodigo();
    return s.codigo_colega;
  }
  try {
    const { data: actual } = await supabase.from("group_signals").select("codigo_colega").eq("org_id", orgId).eq("id", signalId).maybeSingle();
    if (actual && actual.codigo_colega) return actual.codigo_colega;
    for (let intento = 0; intento < 5; intento++) {
      const codigo = generarCodigo();
      const { error } = await supabase.from("group_signals").update({ codigo_colega: codigo }).eq("org_id", orgId).eq("id", signalId);
      if (!error) return codigo;
      if (error.code !== "23505") throw error; // 23505 = choque con el indice unico: otro codigo
    }
    return null;
  } catch (e) {
    // Falla abierta: el DM sale como antes, sin codigo.
    console.warn("[codigo-colega] No se pudo asignar codigo:", e.message);
    return null;
  }
}

async function resolver(orgId, codigo) {
  if (!orgId || !codigo) return null;
  if (!supabase) return memory.groupSignals.find((s) => s.org_id === orgId && s.codigo_colega === codigo) || null;
  const { data, error } = await supabase.from("group_signals").select(COLUMNAS).eq("org_id", orgId).eq("codigo_colega", codigo).maybeSingle();
  if (error) {
    console.warn("[codigo-colega] No se pudo resolver el codigo:", error.message);
    return null;
  }
  return data || null;
}

async function filaPorLid(orgId, lid) {
  if (!supabase) return memory.colegasGrupos.find((c) => c.org_id === orgId && c.lid === lid) || null;
  const { data } = await supabase.from("colegas_grupos").select("lid, telefono, nombre").eq("org_id", orgId).eq("lid", lid).maybeSingle();
  return data || null;
}

async function marcarEscribio(orgId, signalId) {
  const ahora = new Date().toISOString();
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.org_id === orgId && x.id === signalId);
    if (s && !s.colega_escribio_at) s.colega_escribio_at = ahora;
    return;
  }
  await supabase.from("group_signals").update({ colega_escribio_at: ahora }).eq("org_id", orgId).eq("id", signalId).is("colega_escribio_at", null);
}

async function reconocer(orgId, telefono, texto) {
  const codigo = leerCodigo(texto);
  if (!codigo) return null;
  const senal = await resolver(orgId, codigo);
  if (!senal) return null;
  const tel = String(telefono || "").replace(/\D/g, "");
  const lid = String(senal.respuesta_destino_lid || "").replace(/@.*$/, "").replace(/\D/g, "");
  let nombre = senal.autor_nombre || null;

  if (lid) {
    const fila = await filaPorLid(orgId, lid).catch(() => null);
    if (fila && fila.nombre) nombre = fila.nombre;
    if (fila && fila.telefono && !mismoTelefono(fila.telefono, tel)) {
      console.warn(`[codigo-colega] El colega del codigo ${codigo} ya tiene otro telefono; no se pisa.`);
    } else if (tel) {
      await colegas.upsert(orgId, { lid, telefono: tel, nombre });
    }
  }
  await marcarEscribio(orgId, senal.id).catch((e) => console.warn("[codigo-colega] No se pudo marcar colega_escribio_at:", e.message));
  return { colega: { lid: lid || null, telefono: tel, nombre }, senal };
}

module.exports = { generarCodigo, leerCodigo, asignarCodigo, resolver, reconocer };
```

(Verificar antes de implementar: `src/data/supabase.js` exporta el cliente o `null` en modo memoria, y `advisors.mismoTelefono` existe — ambos se usan así en `src/data/colegas.js` y `src/agent/tools.js`. Si el import de supabase en `colegas.js` es distinto, copiar ese mismo.)

- [ ] **Step 4:** `node --test test/codigo-colega.test.js` → PASS
- [ ] **Step 5:** Commit `feat(radar): código corto del DM para reconocer al colega en Sofi`

---

### Task 2: Links con texto prellenado en el primer mensaje del DM

**Files:** Modify `src/lib/contacto.js`, `src/groups/redactar.js`; Test `test/contacto.test.js`, `test/dm-separados.test.js`

**Interfaces:**
- Produces: `linkContactoOficial(org = null, texto = null)`; `mensajesAlColega(senal, publicables, { ..., codigo })`

- [ ] **Step 1: Write the failing tests**

`test/contacto.test.js`, agregar:

```js
test("linkContactoOficial con texto prellenado lo codifica en ?text=", () => {
  const antes = process.env.CONTACT_WHATSAPP_NUMBER;
  process.env.CONTACT_WHATSAPP_NUMBER = "573009998877";
  try {
    assert.strictEqual(
      linkContactoOficial(null, "Hola Sofi (cód. D7K2)"),
      "https://wa.me/573009998877?text=Hola%20Sofi%20(c%C3%B3d.%20D7K2)"
    );
  } finally {
    if (antes === undefined) delete process.env.CONTACT_WHATSAPP_NUMBER;
    else process.env.CONTACT_WHATSAPP_NUMBER = antes;
  }
});
```

`test/dm-separados.test.js`, agregar (usa `PROP` y `redactar` ya definidos en el archivo):

```js
test("con código, el primer mensaje trae los dos links a Sofi y las fichas NO", () => {
  const antes = process.env.CONTACT_WHATSAPP_NUMBER;
  process.env.CONTACT_WHATSAPP_NUMBER = "573009998877";
  try {
    const r = redactar.mensajesAlColega({ autor_nombre: "Laura" }, [PROP("A"), PROP("B")], { codigo: "D7K2" });
    const primero = r.mensajes[0].texto;
    assert.match(primero, /📅 ¿Agendamos una visita\? Escribile a Sofi:\nhttps:\/\/wa\.me\/573009998877\?text=[^\n]*agendar[^\n]*D7K2/);
    assert.match(primero, /🔎 ¿Más opciones o alguna duda\?\nhttps:\/\/wa\.me\/573009998877\?text=[^\n]*m%C3%A1s%20opciones[^\n]*D7K2/);
    assert.match(primero, /— Sofi, asistente virtual/);
    for (const f of r.mensajes.slice(1)) assert.doesNotMatch(f.texto, /D7K2|wa\.me\/573009998877/, "las fichas se reenvían al cliente: sin código");
  } finally {
    if (antes === undefined) delete process.env.CONTACT_WHATSAPP_NUMBER;
    else process.env.CONTACT_WHATSAPP_NUMBER = antes;
  }
});

test("con código y opciones de más, el link de más opciones lo dice", () => {
  const antes = process.env.CONTACT_WHATSAPP_NUMBER;
  process.env.CONTACT_WHATSAPP_NUMBER = "573009998877";
  try {
    const r = redactar.mensajesAlColega({ autor_nombre: "Ana" }, [PROP("A"), PROP("B"), PROP("C"), PROP("D")], { codigo: "D7K2", max: 3 });
    assert.match(r.mensajes[0].texto, /🔎 Tengo 1 opción más para este pedido; pedísela a Sofi:\nhttps:\/\/wa\.me\/\S+D7K2/);
  } finally {
    if (antes === undefined) delete process.env.CONTACT_WHATSAPP_NUMBER;
    else process.env.CONTACT_WHATSAPP_NUMBER = antes;
  }
});

test("sin código, el DM sale exactamente como antes", () => {
  const conCodigoNulo = redactar.mensajesAlColega({ autor_nombre: "Ana" }, [PROP("A")], { codigo: null });
  const sinOpcion = redactar.mensajesAlColega({ autor_nombre: "Ana" }, [PROP("A")], {});
  assert.deepStrictEqual(conCodigoNulo, sinOpcion);
});
```

- [ ] **Step 2:** `node --test test/contacto.test.js test/dm-separados.test.js` → FAIL

- [ ] **Step 3: Implement**

`src/lib/contacto.js`:

```js
function linkContactoOficial(org = null, texto = null) {
  const numero = (org && org.contact_whatsapp_number) || process.env.CONTACT_WHATSAPP_NUMBER;
  const link = linkWhatsapp(numero);
  if (!link || !texto) return link;
  return `${link}?text=${encodeURIComponent(texto)}`;
}
```

`src/groups/redactar.js` — en `mensajesAlColega`, agregar `codigo = null` a las opciones y armar el cierre así (reemplaza el bloque `const linkSofi … const cierre = …`):

```js
  // Con codigo (spec 2026-10-07 §3), el cierre trae dos links a Sofi con texto
  // prellenado: agendar visita y mas opciones/dudas. Van SOLO en este primer
  // mensaje: las fichas se reenvian tal cual al cliente final, y un link con
  // el codigo del colega en una ficha le abriria al cliente la puerta a Sofi
  // saltandose al colega. Sin codigo, el cierre de siempre.
  const linkSofi = linkContactoOficial(org);
  const cuantasMas = restantes === 1 ? "1 opción más" : `${restantes} opciones más`;
  const linkAgendar = codigo ? linkContactoOficial(org, `Hola Sofi, quiero agendar una visita para mi PEDIDO (cód. ${codigo})`) : null;
  const linkMas = codigo ? linkContactoOficial(org, `Hola Sofi, quiero más opciones para mi PEDIDO (cód. ${codigo})`) : null;
  const cierre =
    linkAgendar && linkMas
      ? [
          "Comision compartida.",
          "— Sofi, asistente virtual",
          "",
          "📅 ¿Agendamos una visita? Escribile a Sofi:",
          linkAgendar,
          "",
          restantes > 0 ? `🔎 Tengo ${cuantasMas} para este pedido; pedísela a Sofi:` : "🔎 ¿Más opciones o alguna duda?",
          linkMas,
        ]
      : restantes > 0
        ? [
            "Comision compartida.",
            "— Sofi, asistente virtual",
            "",
            ...(linkSofi
              ? [`Tengo ${cuantasMas} para este pedido; si querés verlas, escribile a Sofi (nuestra línea oficial):`, linkSofi]
              : [`Tengo ${cuantasMas} para este pedido; si querés verlas, decime.`]),
          ]
        : lineasCierre(org);
```

Nota: con 2+ opciones de más el texto del link dice "pedíselas"; ajustar: `restantes > 0 ? \`🔎 Tengo ${cuantasMas} para este pedido; ${restantes === 1 ? "pedísela" : "pedíselas"} a Sofi:\`` y el test de "1 opción más" sigue igual.

- [ ] **Step 4:** `npm test` → 0 fail
- [ ] **Step 5:** Commit `feat(radar): el DM al colega trae links a Sofi para agendar y pedir más opciones`

---

### Task 3: vivo.js asigna el código en los cuatro caminos

**Files:** Modify `src/groups/vivo.js` (llamados a `redactar.mensajesAlColega` en ~654, ~1248, ~1485, ~1712); Test: agregar a `test/codigo-colega.test.js`

- [ ] **Step 1: Write the failing test** (cableado)

```js
const fs = require("node:fs");
const path = require("node:path");
test("vivo.js pide el código antes de cada mensajesAlColega", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "groups", "vivo.js"), "utf8");
  const llamados = fuente.split("redactar.mensajesAlColega(").length - 1;
  const conCodigo = (fuente.match(/codigo: await codigoColega\.asignarCodigo\(/g) || []).length;
  assert.strictEqual(conCodigo, llamados, "cada armado del DM lleva su código");
});
```

- [ ] **Step 2:** FAIL
- [ ] **Step 3: Implement** — `const codigoColega = require("./codigo-colega");` en el encabezado de `vivo.js`, y en cada uno de los cuatro llamados agregar a las opciones `codigo: await codigoColega.asignarCodigo(org.id, signal.id),` (en el camino automático la variable de la señal es `signal`; verificar el nombre en cada llamado y usar el que corresponda).
- [ ] **Step 4:** `npm test` → 0 fail
- [ ] **Step 5:** Commit `feat(radar): cada DM al colega lleva su código`

---

### Task 4: engine reconoce al colega por código

**Files:** Modify `src/agent/engine.js` (~73-84 identificación; ~235-240 `ultimoPedido`); Test: agregar a `test/codigo-colega.test.js`

- [ ] **Step 1: Write the failing test** (cableado; el comportamiento ya está probado en Task 1)

```js
test("engine reconoce por código ANTES del directorio y usa esa señal como último pedido", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "engine.js"), "utf8");
  const iCodigo = fuente.indexOf("codigoColega.reconocer(");
  const iDirectorio = fuente.indexOf("directorio.esColega(");
  assert.ok(iCodigo > -1 && iCodigo < iDirectorio, "primero el código, después el directorio");
  assert.match(fuente, /porCodigo && porCodigo\.senal/, "el pedido del código manda sobre buscarPorTelefono");
});
```

- [ ] **Step 2:** FAIL
- [ ] **Step 3: Implement** en `engine.js`:

```js
const codigoColega = require("../groups/codigo-colega");
```

Antes de `const colega = advisor ? null : await directorio.esColega(...)`:

```js
  // Puente del DM (spec 2026-10-07 §3): si escribe con el codigo de un DM del
  // radar, es ese colega y ese pedido, aunque solo lo tuvieramos por lid.
  // Falla abierta: sin codigo, el flujo de siempre.
  const porCodigo = advisor
    ? null
    : await codigoColega.reconocer(org.id, phone, text).catch((e) => {
        console.warn("[engine] No se pudo reconocer el codigo del colega:", e.message);
        return null;
      });
```

y cambiar la línea del colega a:

```js
  const colega = advisor ? null : (porCodigo && porCodigo.colega) || await directorio.esColega(org.id, phone).catch((e) => {
```

(cerrando igual que hoy). En `ultimoPedido`:

```js
  const ultimoPedido = porCodigo && porCodigo.senal
    ? porCodigo.senal
    : colega
      ? await groupSignals.buscarPorTelefono(org.id, phone).catch((e) => {
          console.warn("[engine] No se pudo traer el ultimo pedido del colega:", e.message);
          return null;
        })
      : null;
```

- [ ] **Step 4:** `npm test` → 0 fail
- [ ] **Step 5:** Commit `feat(sofi): reconoce al colega por el código del DM y retoma ese pedido`

---

### Task 5: Integración y despliegue

- [ ] `npm test` completo; merge a `main`; `git push origin main`; esperar deploy SUCCESS del servicio `diamond`.
- [ ] Verificación en producción (cuando el radar vuelva a tener saldo): primer DM nuevo → `select codigo_colega from group_signals where respondida_at > now() - interval '1 day'` no nulo; el texto del primer mensaje (`respuesta_texto`) trae los dos links.

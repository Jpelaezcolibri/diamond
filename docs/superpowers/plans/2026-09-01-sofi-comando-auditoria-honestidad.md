# Sofi-Comando: auditoría de honestidad + notificación de fallos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Sofi-Comando (el chat interno del Centro de Comando) nunca confirme una acción que no ejecutó de verdad, y que Juan reciba un WhatsApp cuando eso —o un fallo real de una herramienta— pase.

**Architecture:** Dos chequeos deterministas y puros (sin IA, sin I/O) que corren después de cada turno del loop de tool-use ya existente en `src/agent/sofi-comando.js#processMessage`: uno detecta lenguaje de confirmación sin una herramienta mutante exitosa detrás; el otro detecta que una herramienta mutante devolvió un fallo real. Si cualquiera dispara, se le agrega un disclaimer a la respuesta y/o se manda un WhatsApp a Juan por el canal ya existente `RADAR_WATCHDOG_TO`.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert` (suite existente, sin framework nuevo), Supabase (solo lectura, vía `src/data/organizations.js`), Anthropic SDK (ya integrado, sin cambios en el cliente).

## Global Constraints

- Esto vive EXCLUSIVAMENTE en el árbol de Sofi-Comando (`src/agent/sofi-comando*.js`). Nunca se importa desde `src/agent/engine.js` (clientes) ni `src/groups/vivo.js` (colegas) — ver spec §5.
- Reusar `RADAR_WATCHDOG_TO` (mismo parseo CSV que `src/lib/mensaje-asesor.js:36` y `src/scheduler/radar-watchdog.js:38`). Ninguna variable de entorno nueva.
- Solo "No pude..." al inicio de un resultado de herramienta cuenta como fallo real. "Falta...", "Esto solo...", "Esta herramienta..." NO cuentan — son la herramienta pidiendo más info o rechazando el uso, no un problema de sistema.
- Refinamiento sobre el spec (detectado al planear): el catch genérico de `processMessage` (línea ~262 de `sofi-comando.js`) produce el string literal `"Error ejecutando la herramienta: ..."` cuando una tool tira una excepción — un prefijo DISTINTO a "No pude...". Esto también es "algo se rompió de nuestro lado" según la intención del spec §3.2, así que `esFalloDeHerramienta` cubre AMBOS prefijos, no solo "No pude...".
- Todas las funciones de detección son puras: reciben strings/arrays, devuelven objetos planos. Se prueban sin mockear el cliente de Anthropic ni Supabase.

---

### Task 1: Módulo de auditoría pura

**Files:**
- Create: `src/agent/sofi-comando-auditoria.js`
- Test: `test/sofi-comando-auditoria.test.js`

**Interfaces:**
- Produces: `pareceConfirmacion(texto: string): boolean`, `esFalloDeHerramienta(resultado: string): boolean`, `auditar({ textoFinal: string, llamadasMutantes: Array<{nombre: string, resultado: string}> }): { sinConfirmar: boolean, fallos: Array<{nombre: string, resultado: string}>, notificar: boolean }`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/sofi-comando-auditoria.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { pareceConfirmacion, esFalloDeHerramienta, auditar } = require("../src/agent/sofi-comando-auditoria");

test("pareceConfirmacion: detecta el check verde", () => {
  assert.strictEqual(pareceConfirmacion("Guardado ✅\n\nMANDATO DE COMPRA #1"), true);
});

test("pareceConfirmacion: detecta 'guardé'/'guardado' en distintas formas", () => {
  assert.strictEqual(pareceConfirmacion("Listo, guardé el mandato de Sara A"), true);
  assert.strictEqual(pareceConfirmacion("Ya quedó guardado en el sistema"), true);
});

test("pareceConfirmacion: detecta envios ('envié', 'le mandé', 'ya le escribí')", () => {
  assert.strictEqual(pareceConfirmacion("Les envié el mensaje a las dos"), true);
  assert.strictEqual(pareceConfirmacion("Listo, le mandé el resumen a Natalia"), true);
  assert.strictEqual(pareceConfirmacion("Ya le escribí a Catherine"), true);
});

test("pareceConfirmacion: detecta 'registré'/'registrado'", () => {
  assert.strictEqual(pareceConfirmacion("Registré el resultado del pedido"), true);
});

test("pareceConfirmacion: un texto que no confirma nada da false", () => {
  assert.strictEqual(pareceConfirmacion("¿Me confirmás el nombre del cliente antes de guardarlo?"), false);
  assert.strictEqual(pareceConfirmacion("Hoy no tenés pendientes urgentes."), false);
});

test("esFalloDeHerramienta: 'No pude...' es un fallo real", () => {
  assert.strictEqual(esFalloDeHerramienta("No pude guardar el mandato — avisale a Juan, puede ser que falte correr una migración."), true);
});

test("esFalloDeHerramienta: el prefijo generico de excepcion tambien es un fallo real", () => {
  assert.strictEqual(esFalloDeHerramienta("Error ejecutando la herramienta: timeout"), true);
});

test("esFalloDeHerramienta: pedir mas informacion NO es un fallo", () => {
  assert.strictEqual(esFalloDeHerramienta("Falta el nombre del cliente. Preguntale de quién es el mandato antes de registrarlo."), false);
});

test("esFalloDeHerramienta: rechazar el uso NO es un fallo", () => {
  assert.strictEqual(esFalloDeHerramienta("Esto solo lo puede usar un admin."), false);
  assert.strictEqual(esFalloDeHerramienta("Esta herramienta es interna del equipo: solo un asesor de la casa puede registrar un mandato de compra."), false);
});

test("auditar: confirmacion sin ninguna tool mutante llamada -> sospecha", () => {
  const r = auditar({ textoFinal: "Guardado ✅ MANDATO DE COMPRA #1", llamadasMutantes: [] });
  assert.strictEqual(r.sinConfirmar, true);
  assert.deepStrictEqual(r.fallos, []);
  assert.strictEqual(r.notificar, true);
});

test("auditar: confirmacion CON una tool mutante exitosa -> no hay sospecha", () => {
  const r = auditar({
    textoFinal: "Listo, guardé el mandato de Sara A: · Compra lote hasta $600.000.000",
    llamadasMutantes: [{ nombre: "registrar_mandato_compra", resultado: "Listo, guardé el mandato de Sara A: · Compra lote hasta $600.000.000" }],
  });
  assert.strictEqual(r.sinConfirmar, false);
  assert.strictEqual(r.notificar, false);
});

test("auditar: tool mutante que fallo, pero el texto confirma de todas formas -> sospecha Y fallo", () => {
  const r = auditar({
    textoFinal: "Guardado ✅",
    llamadasMutantes: [{ nombre: "registrar_mandato_compra", resultado: "No pude guardar el mandato — avisale a Juan." }],
  });
  assert.strictEqual(r.sinConfirmar, true);
  assert.strictEqual(r.fallos.length, 1);
  assert.strictEqual(r.notificar, true);
});

test("auditar: tool mutante que fallo, texto honesto (sin lenguaje de confirmacion) -> fallo pero no sospecha", () => {
  const r = auditar({
    textoFinal: "No pude guardar el mandato, avisale a Juan por si falta una migración.",
    llamadasMutantes: [{ nombre: "registrar_mandato_compra", resultado: "No pude guardar el mandato — avisale a Juan." }],
  });
  assert.strictEqual(r.sinConfirmar, false);
  assert.strictEqual(r.fallos.length, 1);
  assert.strictEqual(r.notificar, true);
});

test("auditar: sin ninguna tool mutante y sin lenguaje de confirmacion -> todo tranquilo", () => {
  const r = auditar({ textoFinal: "Hoy no tenés pendientes urgentes.", llamadasMutantes: [] });
  assert.strictEqual(r.sinConfirmar, false);
  assert.strictEqual(r.fallos.length, 0);
  assert.strictEqual(r.notificar, false);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/sofi-comando-auditoria.test.js`
Expected: FAIL — `Cannot find module '../src/agent/sofi-comando-auditoria'`

- [ ] **Step 3: Implementación mínima**

Crear `src/agent/sofi-comando-auditoria.js`:

```js
// Auditoria de honestidad del Centro de Comando: dos chequeos deterministas,
// sin IA ni I/O, sobre lo que paso en UN turno del loop de tool-use de
// src/agent/sofi-comando.js#processMessage. Mismo patron que
// src/groups/politica.js: funciones puras, testeables exhaustivamente.
//
// SOLO para Sofi-Comando (chat interno). src/agent/engine.js (clientes) y
// src/groups/vivo.js (colegas) NUNCA importan este archivo -- ver
// docs/superpowers/specs/2026-09-01-sofi-comando-auditoria-honestidad-design.md.

const PATRONES_CONFIRMACION = [
  /✅/,
  /\bguard[eé]\b/i,
  /\bguardado\b/i,
  /\benvi[eé]\b/i,
  /\bregistr[eé]\b/i,
  /\bregistrado\b/i,
  /listo,?\s+le\s+mand[eé]/i,
  /ya\s+le\s+escrib[ií]/i,
];

function pareceConfirmacion(texto) {
  const t = String(texto || "");
  return PATRONES_CONFIRMACION.some((re) => re.test(t));
}

// "No pude..." (usado en ~15 lugares de src/agent/tools.js y
// sofi-comando-tools.js) y el prefijo generico de excepcion que arma
// sofi-comando.js ("Error ejecutando la herramienta: ...") son las dos formas
// en que el codigo ya dice "algo se rompio de nuestro lado". Deliberadamente
// NO cuentan "Falta...", "Esto solo...", "Esta herramienta..." -- son la
// herramienta pidiendo mas info o rechazando el uso, un flujo normal.
function esFalloDeHerramienta(resultado) {
  const r = String(resultado || "").trim();
  return /^No pude\b/.test(r) || /^Error ejecutando la herramienta:/.test(r);
}

function auditar({ textoFinal, llamadasMutantes = [] } = {}) {
  const fallos = llamadasMutantes.filter((l) => esFalloDeHerramienta(l.resultado));
  const huboExitoMutante = llamadasMutantes.length > fallos.length;
  const sinConfirmar = pareceConfirmacion(textoFinal) && !huboExitoMutante;

  return { sinConfirmar, fallos, notificar: sinConfirmar || fallos.length > 0 };
}

module.exports = { pareceConfirmacion, esFalloDeHerramienta, auditar };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/sofi-comando-auditoria.test.js`
Expected: PASS — 14 tests, 0 fallos

- [ ] **Step 5: Commit**

```bash
git add src/agent/sofi-comando-auditoria.js test/sofi-comando-auditoria.test.js
git commit -m "feat(sofi-comando): auditoria pura de confirmaciones y fallos de herramientas"
```

---

### Task 2: Set de herramientas "mutantes"

**Files:**
- Modify: `src/agent/sofi-comando-tools.js`
- Test: `test/sofi-comando-mutating-tools.test.js`

**Interfaces:**
- Consumes: `COMMAND_TOOL_DEFINITIONS` (ya existe en `sofi-comando-tools.js`, lista de `{name, description, input_schema}`)
- Produces: `MUTATING_TOOLS: Set<string>`, exportado junto a `COMMAND_TOOL_DEFINITIONS`, `executeCommandTool`, `toolsForScope`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/sofi-comando-mutating-tools.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const { MUTATING_TOOLS, COMMAND_TOOL_DEFINITIONS } = require("../src/agent/sofi-comando-tools");

test("MUTATING_TOOLS contiene las herramientas que escriben o mandan mensajes", () => {
  for (const nombre of [
    "registrar_mandato_compra", "enviar_whatsapp_equipo", "crear_recordatorio_equipo",
    "registrar_resultado_radar", "aprobar_pedido_radar", "enviar_matches_pendientes_equipo",
    "cerrar_lead", "registrar_propiedad_colega", "marcar_propiedad",
    "marcar_prioridad_venta", "crear_recordatorio", "completar_recordatorio",
  ]) {
    assert.ok(MUTATING_TOOLS.has(nombre), `${nombre} deberia estar en MUTATING_TOOLS`);
  }
});

test("MUTATING_TOOLS NO contiene herramientas de solo lectura", () => {
  for (const nombre of [
    "consultar_seguimientos", "metricas_leads", "buscar_inventario",
    "resumen_lead", "trazabilidad_radar", "consultar_recordatorios",
  ]) {
    assert.ok(!MUTATING_TOOLS.has(nombre), `${nombre} es de solo lectura, no deberia estar en MUTATING_TOOLS`);
  }
});

test("cada nombre de MUTATING_TOOLS corresponde a una tool declarada de verdad", () => {
  const nombresDeclarados = new Set(COMMAND_TOOL_DEFINITIONS.map((t) => t.name));
  for (const nombre of MUTATING_TOOLS) {
    assert.ok(nombresDeclarados.has(nombre), `${nombre} esta en MUTATING_TOOLS pero no existe como tool declarada`);
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/sofi-comando-mutating-tools.test.js`
Expected: FAIL — `MUTATING_TOOLS is not a function` o `undefined has no method 'has'` (el export todavia no existe)

- [ ] **Step 3: Implementación mínima**

En `src/agent/sofi-comando-tools.js`, junto a la declaración existente de `ADMIN_ONLY_TOOLS` (buscar `const ADMIN_ONLY_TOOLS = new Set([`), agregar justo debajo:

```js
// Herramientas que escriben en base o mandan un WhatsApp -- las que Sofi
// puede "mentir" sobre haber ejecutado. El resto (consultar_*, buscar_*,
// metricas_leads, resumen_lead, trazabilidad_radar, etc.) son de solo lectura
// y quedan fuera: no hay nada que puedan fingir haber hecho.
// Usado por src/agent/sofi-comando.js#processMessage junto con
// src/agent/sofi-comando-auditoria.js -- ver el spec del 2026-09-01.
const MUTATING_TOOLS = new Set([
  "registrar_mandato_compra", "enviar_whatsapp_equipo", "crear_recordatorio_equipo",
  "registrar_resultado_radar", "aprobar_pedido_radar", "enviar_matches_pendientes_equipo",
  "cerrar_lead", "registrar_propiedad_colega", "marcar_propiedad",
  "marcar_prioridad_venta", "crear_recordatorio", "completar_recordatorio",
]);
```

Y en el `module.exports` al final del archivo (buscar `module.exports = { COMMAND_TOOL_DEFINITIONS, executeCommandTool, toolsForScope };`), agregar `MUTATING_TOOLS`:

```js
module.exports = { COMMAND_TOOL_DEFINITIONS, executeCommandTool, toolsForScope, MUTATING_TOOLS };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test test/sofi-comando-mutating-tools.test.js`
Expected: PASS — 3 tests, 0 fallos

- [ ] **Step 5: Correr toda la suite para confirmar que no se rompio nada**

Run: `node --test test/*.test.js`
Expected: PASS — todos los tests existentes siguen en verde (agregar un `Set` y un export no cambia comportamiento de nada mas)

- [ ] **Step 6: Commit**

```bash
git add src/agent/sofi-comando-tools.js test/sofi-comando-mutating-tools.test.js
git commit -m "feat(sofi-comando): declarar el set de herramientas mutantes"
```

---

### Task 3: Notificación a Juan

**Files:**
- Create: `src/agent/notificar-fallo-comando.js`
- Test: `test/notificar-fallo-comando.test.js`

**Interfaces:**
- Consumes: `organizations.findById(orgId): Promise<Org|null>` (ya existe, `src/data/organizations.js`), `canalWhatsapp.sendWhatsApp(org, to, texto): Promise<{ok, wamid, error}>` (ya existe, `src/channels/whatsapp.js`), la forma `{ sinConfirmar, fallos, notificar }` que devuelve `auditar()` (Task 1)
- Produces: `notificarFalloComando(scope: {orgId}, { userName, textoUsuario, reply, auditoria }): Promise<void>`, y las puras `textoSinConfirmar`, `textoFallo` (exportadas para test directo del formato del mensaje)

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/notificar-fallo-comando.test.js`:

```js
const { test } = require("node:test");
const assert = require("node:assert");
const organizations = require("../src/data/organizations");
const canalWhatsapp = require("../src/channels/whatsapp");
const {
  notificarFalloComando, textoSinConfirmar, textoFallo,
} = require("../src/agent/notificar-fallo-comando");

test("textoSinConfirmar: arma un mensaje claro con quien, que pidio y que contesto Sofi", () => {
  const texto = textoSinConfirmar({
    userName: "Juan",
    textoUsuario: "guardalas como mandatos de compra",
    reply: "Guardado ✅ MANDATO DE COMPRA #1",
  });
  assert.match(texto, /posible acci[oó]n no confirmada/i);
  assert.match(texto, /Juan/);
  assert.match(texto, /guardalas como mandatos de compra/);
  assert.match(texto, /Guardado ✅/);
});

test("textoSinConfirmar: recorta textos muy largos, no manda el chat completo", () => {
  const texto = textoSinConfirmar({ userName: "Juan", textoUsuario: "x".repeat(500), reply: "y".repeat(500) });
  assert.ok(texto.length < 700, "el mensaje deberia quedar acotado, no crecer sin limite");
});

test("textoFallo: lista cada herramienta que fallo con su resultado", () => {
  const texto = textoFallo({
    userName: "Juan",
    fallos: [{ nombre: "registrar_mandato_compra", resultado: "No pude guardar el mandato — avisale a Juan." }],
  });
  assert.match(texto, /fallo real de herramienta/i);
  assert.match(texto, /registrar_mandato_compra/);
  assert.match(texto, /No pude guardar el mandato/);
});

test("notificarFalloComando: sin RADAR_WATCHDOG_TO configurado, no intenta mandar nada", async (t) => {
  delete process.env.RADAR_WATCHDOG_TO;
  let llamado = false;
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => { llamado = true; return { ok: true }; });

  await notificarFalloComando(
    { orgId: "org-1" },
    { userName: "Juan", textoUsuario: "x", reply: "y", auditoria: { sinConfirmar: true, fallos: [], notificar: true } }
  );

  assert.strictEqual(llamado, false);
});

test("notificarFalloComando: con destino configurado, manda el mensaje de 'sin confirmar'", async (t) => {
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  const enviados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => {
    enviados.push({ org, to, texto });
    return { ok: true, wamid: "wm-1" };
  });

  await notificarFalloComando(
    { orgId: "org-1" },
    { userName: "Juan", textoUsuario: "guardalos", reply: "Guardado ✅", auditoria: { sinConfirmar: true, fallos: [], notificar: true } }
  );

  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].to, "573001112233");
  assert.match(enviados[0].texto, /posible acci[oó]n no confirmada/i);
  t.after(() => { delete process.env.RADAR_WATCHDOG_TO; });
});

test("notificarFalloComando: manda los DOS mensajes si hay sospecha Y fallos a la vez", async (t) => {
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  const enviados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => {
    enviados.push(texto);
    return { ok: true };
  });

  await notificarFalloComando(
    { orgId: "org-1" },
    {
      userName: "Juan", textoUsuario: "guardalos", reply: "Guardado ✅",
      auditoria: {
        sinConfirmar: true,
        fallos: [{ nombre: "registrar_mandato_compra", resultado: "No pude guardar el mandato." }],
        notificar: true,
      },
    }
  );

  assert.strictEqual(enviados.length, 2);
  t.after(() => { delete process.env.RADAR_WATCHDOG_TO; });
});

test("notificarFalloComando: sin org resuelta, no revienta -- solo no manda nada", async (t) => {
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => null);
  let llamado = false;
  t.mock.method(canalWhatsapp, "sendWhatsApp", async () => { llamado = true; return { ok: true }; });

  await notificarFalloComando(
    { orgId: "org-inexistente" },
    { userName: "Juan", textoUsuario: "x", reply: "y", auditoria: { sinConfirmar: true, fallos: [], notificar: true } }
  );

  assert.strictEqual(llamado, false);
  t.after(() => { delete process.env.RADAR_WATCHDOG_TO; });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/notificar-fallo-comando.test.js`
Expected: FAIL — `Cannot find module '../src/agent/notificar-fallo-comando'`

- [ ] **Step 3: Implementación mínima**

Crear `src/agent/notificar-fallo-comando.js`:

```js
// Aviso a Juan por WhatsApp cuando Sofi-Comando confirma algo que no ejecuto
// de verdad, o cuando una herramienta mutante devuelve un fallo real. Best
// effort a proposito: un fallo notificando NUNCA puede tumbar la respuesta
// del chat (quien llama a esto ya lo hace con .catch()).
//
// Reusa RADAR_WATCHDOG_TO -- el mismo canal que ya usan src/lib/mensaje-asesor.js
// y src/scheduler/radar-watchdog.js. Sin variable de entorno nueva.
const organizations = require("../data/organizations");
const canalWhatsapp = require("../channels/whatsapp");

function destinos() {
  return (process.env.RADAR_WATCHDOG_TO || "").split(",").map((t) => t.trim()).filter(Boolean);
}

function recorte(s, n) {
  const str = String(s || "");
  return str.length > n ? `${str.slice(0, n)}...` : str;
}

function textoSinConfirmar({ userName, textoUsuario, reply }) {
  return [
    "⚠️ Sofi-Comando: posible acción no confirmada",
    "",
    `Quien: ${userName || "sin nombre"}`,
    `Pidió: "${recorte(textoUsuario, 200)}"`,
    `Sofi contestó (sin llamar ninguna herramienta real):`,
    `"${recorte(reply, 300)}"`,
    "",
    "Revisá si esto se ejecutó de verdad.",
  ].join("\n");
}

function textoFallo({ userName, fallos }) {
  const detalle = fallos.map((f) => `- ${f.nombre}: ${recorte(f.resultado, 200)}`).join("\n");
  return [
    "⚠️ Sofi-Comando: fallo real de herramienta",
    "",
    `Quien: ${userName || "sin nombre"}`,
    detalle,
  ].join("\n");
}

async function notificarFalloComando(scope, { userName, textoUsuario, reply, auditoria }) {
  const to = destinos();
  if (to.length === 0) return;

  const org = await organizations.findById(scope.orgId);
  if (!org) return;

  const mensajes = [];
  if (auditoria.sinConfirmar) mensajes.push(textoSinConfirmar({ userName, textoUsuario, reply }));
  if (auditoria.fallos.length > 0) mensajes.push(textoFallo({ userName, fallos: auditoria.fallos }));

  for (const texto of mensajes) {
    for (const destino of to) {
      await canalWhatsapp.sendWhatsApp(org, destino, texto).catch((e) =>
        console.warn(`[sofi-comando] no se pudo notificar a ${destino}:`, e.message)
      );
    }
  }
}

module.exports = { notificarFalloComando, textoSinConfirmar, textoFallo };
```

**OJO antes de este step:** confirmar la firma real de `organizations.findById` — en `src/data/organizations.js` el export es `findById` pero revisar si toma `(id)` o `(orgId, algoMas)`. Ejecutar: `grep -n "async function findById" src/data/organizations.js` y ajustar la llamada si la firma difiere de `findById(orgId)`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/notificar-fallo-comando.test.js`
Expected: PASS — 7 tests, 0 fallos

- [ ] **Step 5: Commit**

```bash
git add src/agent/notificar-fallo-comando.js test/notificar-fallo-comando.test.js
git commit -m "feat(sofi-comando): notificar a Juan por WhatsApp ante acciones sin confirmar o fallos reales"
```

---

### Task 4: Integración en el loop de `processMessage`

**Files:**
- Modify: `src/agent/sofi-comando.js`
- Test: `test/sofi-comando-tool-loop.test.js` (extender el archivo existente)

**Interfaces:**
- Consumes: `auditar` (Task 1), `MUTATING_TOOLS` (Task 2), `notificarFalloComando` (Task 3), y lo que ya existe en `sofi-comando.js`: `executeCommandTool`, `toolsForScope`, `_setClientForTests` de `src/lib/anthropic.js`
- Produces: ningún cambio en la firma pública de `processMessage(scope, sessionId, text, opts)` — sigue devolviendo `{ reply }`. El comportamiento nuevo es interno.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/sofi-comando-tool-loop.test.js` (después del último `test(...)` existente, mismo archivo):

```js
const { _setClientForTests: _setClient } = require("../src/lib/anthropic");
const canalWhatsapp = require("../src/channels/whatsapp");
const organizations = require("../src/data/organizations");

test("si Sofi confirma una accion sin haber llamado ninguna herramienta, se agrega el disclaimer y se notifica", async (t) => {
  _setClient({
    messages: {
      create: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Guardado ✅ MANDATO DE COMPRA #1 — Cliente de Daiana Zea" }],
      }),
    },
  });
  mockSesion(t);
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  const notificados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => {
    notificados.push({ to, texto });
    return { ok: true };
  });

  const { reply } = await sofiComando.processMessage(SCOPE, "sess-1", "guardalo como mandato", {});

  assert.match(reply, /Guardado ✅ MANDATO DE COMPRA #1/, "no se oculta lo que Sofi intento decir");
  assert.match(reply, /No pude confirmar que esto se haya ejecutado/i);
  assert.strictEqual(notificados.length, 1);
  assert.match(notificados[0].texto, /posible acci[oó]n no confirmada/i);

  t.after(() => { _setClient(null); delete process.env.RADAR_WATCHDOG_TO; });
});

test("si Sofi llama una herramienta mutante de verdad, NO se agrega disclaimer ni se notifica", async (t) => {
  let llamada = 0;
  _setClient({
    messages: {
      create: async () => {
        llamada++;
        if (llamada === 1) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "call-1", name: "crear_recordatorio", input: { descripcion: "llamar a Sara A" } }],
          };
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Listo, te dejé el recordatorio de llamar a Sara A." }] };
      },
    },
  });
  mockSesion(t);
  t.mock.method(require("../src/agent/sofi-comando-tools"), "executeCommandTool", async () => "Listo, guardé el recordatorio.");
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  const notificados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => { notificados.push(texto); return { ok: true }; });

  const { reply } = await sofiComando.processMessage(SCOPE, "sess-1", "recordame llamar a Sara A", {});

  assert.doesNotMatch(reply, /No pude confirmar/i);
  assert.strictEqual(notificados.length, 0);

  t.after(() => { _setClient(null); delete process.env.RADAR_WATCHDOG_TO; });
});

test("si una herramienta mutante devuelve un fallo real, se notifica aunque el texto de Sofi sea honesto", async (t) => {
  let llamada = 0;
  _setClient({
    messages: {
      create: async () => {
        llamada++;
        if (llamada === 1) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "call-1", name: "registrar_mandato_compra", input: { cliente_nombre: "Sara A", operacion: "Venta" } }],
          };
        }
        return { stop_reason: "end_turn", content: [{ type: "text", text: "No pude guardar el mandato, avisale a Juan por si falta una migración." }] };
      },
    },
  });
  mockSesion(t);
  t.mock.method(require("../src/agent/sofi-comando-tools"), "executeCommandTool", async () => "No pude guardar el mandato — avisale a Juan, puede ser que falte correr una migración.");
  process.env.RADAR_WATCHDOG_TO = "573001112233";
  t.mock.method(organizations, "findById", async () => ({ id: "org-1", name: "Diamond" }));
  const notificados = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, to, texto) => { notificados.push(texto); return { ok: true }; });

  const { reply } = await sofiComando.processMessage(SCOPE, "sess-1", "guardalo como mandato", {});

  assert.doesNotMatch(reply, /No pude confirmar que esto se haya ejecutado/i, "el texto ya es honesto, no hace falta el disclaimer");
  assert.strictEqual(notificados.length, 1);
  assert.match(notificados[0], /fallo real de herramienta/i);

  t.after(() => { _setClient(null); delete process.env.RADAR_WATCHDOG_TO; });
});
```

**OJO:** `t.mock.method(require("../src/agent/sofi-comando-tools"), "executeCommandTool", ...)` reemplaza la funcion en el objeto exportado (mismo modulo que ya importa `sofi-comando.js` internamente vía `require("./sofi-comando-tools")` — Node cachea el módulo, así que es la MISMA referencia). Si esto no intercepta la llamada real (verificar en Step 2), la alternativa es mockear más abajo en la cadena: `t.mock.method(require("../src/data/command"), ...)` no aplica acá porque `registrar_mandato_compra` no pasa por `command.js` — en ese caso, mockear en su lugar `require("../src/agent/tools").registrarMandatoCompra` o los data-layer que usa (`src/data/advisors.js#findByAuthUserId`, `src/data/mandatos.js#crear`) siguiendo el mismo patrón `t.mock.method`.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test test/sofi-comando-tool-loop.test.js`
Expected: FAIL en los 3 tests nuevos — el disclaimer nunca aparece y `sendWhatsApp` nunca se llama, porque `processMessage` todavía no tiene la auditoría integrada. Si el segundo o tercer test fallan por otra razón (el mock de `executeCommandTool` no intercepta), ajustar el mock según la nota de arriba ANTES de seguir — no avanzar con un test que falla por la razón equivocada.

- [ ] **Step 3: Implementación**

En `src/agent/sofi-comando.js`, agregar los imports nuevos junto a los existentes (después de `const { executeCommandTool, toolsForScope } = require("./sofi-comando-tools");`):

```js
const { executeCommandTool, toolsForScope, MUTATING_TOOLS } = require("./sofi-comando-tools");
const { auditar } = require("./sofi-comando-auditoria");
const { notificarFalloComando } = require("./notificar-fallo-comando");
```

Dentro de `processMessage`, declarar `llamadasMutantes` junto a `textParts`/`iterations` (buscar `const textParts = [];`):

```js
  const textParts = [];
  const llamadasMutantes = [];
  let iterations = 0;
```

Dentro del `for (const block of toolUseBlocks)`, justo después de que `result` queda calculado (buscar `toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });`), agregar ANTES de ese push:

```js
    for (const block of toolUseBlocks) {
      let result;
      try {
        result = await executeCommandTool(block.name, block.input, ctx);
      } catch (e) {
        console.error(`[sofi-comando] Error en tool ${block.name}:`, e.message);
        result = `Error ejecutando la herramienta: ${e.message}`;
      }
      if (MUTATING_TOOLS.has(block.name)) llamadasMutantes.push({ nombre: block.name, resultado: result });
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
```

Después de que `reply` queda armado y ANTES de `await command.appendCommandMessage(sessionId, "assistant", reply);` (buscar ese bloque completo: `if (!reply) { reply = agotoIteraciones ? ... : ...; }`), agregar:

```js
  const auditoria = auditar({ textoFinal: reply, llamadasMutantes });
  if (auditoria.sinConfirmar) {
    reply += "\n\n⚠️ No pude confirmar que esto se haya ejecutado de verdad — no llamé ninguna herramienta real en este turno. Volvé a pedírmelo así lo intento de nuevo.";
  }
  if (auditoria.notificar) {
    notificarFalloComando(scope, { userName, textoUsuario: text, reply, auditoria }).catch((e) =>
      console.warn("[sofi-comando] no se pudo notificar el fallo:", e.message)
    );
  }
```

El orden final de esa sección de la función queda:

```js
  const finalText = extractText(response);
  if (finalText) textParts.push(finalText);
  let reply = textParts.join("\n").trim();
  if (!reply) {
    reply = agotoIteraciones
      ? 'Ya hice varias de las acciones que me pediste, pero llegue al limite de pasos para un solo mensaje. Decime "segui" y continuo con el resto.'
      : "No pude procesar eso. ¿Lo intentamos de otra forma?";
  }

  const auditoria = auditar({ textoFinal: reply, llamadasMutantes });
  if (auditoria.sinConfirmar) {
    reply += "\n\n⚠️ No pude confirmar que esto se haya ejecutado de verdad — no llamé ninguna herramienta real en este turno. Volvé a pedírmelo así lo intento de nuevo.";
  }
  if (auditoria.notificar) {
    notificarFalloComando(scope, { userName, textoUsuario: text, reply, auditoria }).catch((e) =>
      console.warn("[sofi-comando] no se pudo notificar el fallo:", e.message)
    );
  }

  await command.appendCommandMessage(sessionId, "assistant", reply);
  return { reply };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/sofi-comando-tool-loop.test.js`
Expected: PASS — todos los tests del archivo (los 3 viejos + los 3 nuevos), 0 fallos

- [ ] **Step 5: Correr toda la suite**

Run: `node --test test/*.test.js`
Expected: PASS — todos los tests del proyecto en verde, ningún regresivo

- [ ] **Step 6: Commit**

```bash
git add src/agent/sofi-comando.js test/sofi-comando-tool-loop.test.js
git commit -m "feat(sofi-comando): integrar la auditoria de honestidad en el loop de tool-use"
```

---

### Task 5: Deploy y verificación en producción

**Files:** ninguno (solo push + verificación operativa, sin cambios de código)

- [ ] **Step 1: Push a main**

```bash
git push origin main
```

Esto dispara auto-deploy en Railway (servicio `diamond`) y Vercel (CRM) — mismo mecanismo que ya se usó hoy para el fix de `alerta-asesor.js`.

- [ ] **Step 2: Verificar el deploy**

Usar `railway deployment list` (proyecto `ca2b2fb9-f4eb-45fe-9e60-b6cd17ef3337`, environment `10f374aa-f477-45d3-b85f-eaf4e0014246`, servicio `diamond` = `2360e9b8-5ec2-43f0-bb41-7e0fe7665f1f`) y esperar `status: SUCCESS` con el `commitHash` del último commit de este plan.

- [ ] **Step 3: Smoke test real contra el Centro de Comando**

Repetir la llamada que ya se usó para diagnosticar el problema original: `POST /api/assistant/session` y `/api/assistant/message` contra `https://diamond-production-a713.up.railway.app`, con `x-api-key: $BOT_API_KEY`, `viewerUid` de una cuenta admin real, pidiéndole a Sofi que "guarde" algo con datos incompletos a propósito (por ejemplo, un mandato sin nombre de cliente) para confirmar que:
1. Si Sofi NO llama la herramienta y confirma igual, el disclaimer aparece.
2. `RADAR_WATCHDOG_TO` recibe el WhatsApp de aviso.

Si el smoke test no dispara ninguna de las dos rutas (porque el modelo esta vez sí se comporta bien), no es un fallo del plan — es evidencia de que el chequeo es una red de seguridad para el caso raro, no algo que deba dispararse siempre. Confirmar en ese caso al menos que una consulta de solo lectura (`"como va todo hoy"`) sigue funcionando exactamente igual que antes (sin disclaimers de más).

---

## Self-Review

**Cobertura del spec:** §3.1 (Task 2) · §3.2 (Task 1) · §3.3 (Task 4) · §3.4 alcance-solo-comando (documentado en Global Constraints y en el comentario de cabecera de `sofi-comando-auditoria.js`, Task 1) · §5 testing (cada Task trae sus tests, Task 4 reutiliza el arnés existente de `sofi-comando-tool-loop.test.js`) · §6 fuera de alcance (no se tocó, queda para los próximos dos planes ya identificados).

**Placeholders:** ninguno — cada step trae código completo o el comando exacto a correr.

**Consistencia de tipos:** `auditar()` devuelve `{sinConfirmar, fallos, notificar}` en Task 1 y se consume con esos mismos tres campos en Task 3 (tests) y Task 4 (integración). `notificarFalloComando(scope, {userName, textoUsuario, reply, auditoria})` mantiene la misma firma entre Task 3 (definición) y Task 4 (llamada real). `MUTATING_TOOLS` se define en Task 2 y se usa sin transformación en Task 4.

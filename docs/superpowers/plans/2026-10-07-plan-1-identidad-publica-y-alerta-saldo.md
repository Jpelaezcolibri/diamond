# Plan 1 — Identidad pública del asesor y alerta de saldo de Anthropic

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ningún mensaje hacia un colega o cliente lleve el nombre real ni el celular de una asesora (usa `advisors.alias_publico`, "Asesor N"), y que un error de saldo de Anthropic avise a Juan por un canal que no depende de la línea de la asesora.

**Architecture:** Un módulo puro `src/lib/identidad-publica.js` arma todos los textos hacia afuera que nombran a un asesor; `tools.js`, `prompts.js` y `engine.js` lo usan. Un módulo `src/lib/alerta-saldo.js` observa los errores del cliente Anthropic compartido (`src/lib/anthropic.js`) y avisa a `ALERTA_TECNICA_TO` (texto; si la ventana está cerrada, plantilla `alerta_tecnica`).

**Tech Stack:** Node.js (CommonJS), `node:test`, Supabase, WhatsApp Cloud API.

Spec: `docs/superpowers/specs/2026-10-07-sofi-vendedora-y-agenda-design.md` §2. Plan 1 de 4 (siguientes: puente colega→Sofi, agenda, vendedora senior).

## Global Constraints

- Hacia afuera (colega/cliente): nunca nombre real ni celular de asesor; si no hay `alias_publico`: "un asesor de {org.name}".
- Firma de los mensajes del radar: se mantiene "— Sofi, asistente virtual" (decisión de Juan 2026-08-20, `src/groups/redactar.js:349`). No se agrega "de Diamond".
- Hacia adentro (avisos a la asesora, CRM, Sofi-Comando): sin cambios.
- Quien inicia el contacto humano es la asesora: Sofi no da celulares.
- La alerta de saldo NO se apaga con `ASESORA_SOLO_VISITAS` y no va a `RADAR_WATCHDOG_TO`.
- Suite completa: `npm test` (baseline 2051 pass, 0 fail al 2026-10-07).
- Commits en español con prefijo convencional y la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/identidad-publica.js` (nuevo) | `aliasPublico`, textos hacia afuera que nombran asesor |
| `src/agent/tools.js` (modificar) | confirmar_cita, transferir_a_asesor, pedir_contacto_asesora usan el módulo |
| `src/agent/prompts.js` (modificar) | bloque COORDINA LAS VISITAS sin nombre ni celular; reglas del prompt de colega |
| `src/agent/engine.js` (modificar) | `coordinador` = `{ alias }` |
| `src/lib/alerta-saldo.js` (nuevo) | detectar error de saldo y avisar, con enfriamiento |
| `src/lib/anthropic.js` (modificar) | envolver `messages.create` para observar errores |
| `test/identidad-publica.test.js`, `test/alerta-saldo.test.js` (nuevos) | |
| `test/colega-pide-asesora.test.js`, `test/citas-colega.test.js` (modificar) | |

---

### Task 1: Módulo de identidad pública

**Files:**
- Create: `src/lib/identidad-publica.js`
- Test: `test/identidad-publica.test.js`

**Interfaces:**
- Produces:
  - `aliasPublico(advisor, org) -> string`
  - `textoCitaConfirmada({ cuando, ref, advisor, org }) -> string`
  - `instruccionTransferencia({ especialidad, advisor, org }) -> string`

- [ ] **Step 1: Write the failing test**

```js
// test/identidad-publica.test.js
// Hacia afuera nadie ve el nombre real ni el celular de una asesora (Juan,
// 2026-10-07): se nombra "Asesor N" y quien inicia el contacto es ella.
const { test } = require("node:test");
const assert = require("node:assert");
const { aliasPublico, textoCitaConfirmada, instruccionTransferencia } = require("../src/lib/identidad-publica");

const ORG = { id: "org-1", name: "Diamond" };
const REAL = { id: "a1", name: "ZZNombreReal Apellido", phone: "573000000000", alias_publico: "Asesor 2" };
const SIN_ALIAS = { id: "a2", name: "ZZOtraReal", phone: "573111111111", alias_publico: null };

const sinFiltrar = (texto) => {
  assert.doesNotMatch(texto, /ZZNombreReal|ZZOtraReal/, "no lleva el nombre real");
  assert.doesNotMatch(texto, /573000000000|573111111111|300 000 0000/, "no lleva el celular");
};

test("aliasPublico usa el alias y, sin alias, un genérico con el nombre de la org", () => {
  assert.strictEqual(aliasPublico(REAL, ORG), "Asesor 2");
  assert.strictEqual(aliasPublico(SIN_ALIAS, ORG), "un asesor de Diamond");
  assert.strictEqual(aliasPublico(null, ORG), "un asesor de Diamond");
});

test("la confirmación de visita nombra al alias y no da celular", () => {
  const t = textoCitaConfirmada({ cuando: "del jueves 9 de octubre a las 3:00 p. m.", ref: "10012722", advisor: REAL, org: ORG });
  assert.strictEqual(t, "Tu visita del jueves 9 de octubre a las 3:00 p. m. a la ref 10012722 quedó CONFIRMADA. Te recibe Asesor 2.");
  sinFiltrar(t);
});

test("la confirmación sin ref no deja un hueco", () => {
  const t = textoCitaConfirmada({ cuando: "acordada", ref: null, advisor: SIN_ALIAS, org: ORG });
  assert.strictEqual(t, "Tu visita acordada quedó CONFIRMADA. Te recibe un asesor de Diamond.");
});

test("la transferencia no le da link ni celular al cliente: el asesor lo contacta", () => {
  const t = instruccionTransferencia({ especialidad: "venta", advisor: REAL, org: ORG });
  assert.match(t, /Asesor 2/);
  assert.match(t, /te va a contactar|lo va a contactar/);
  assert.match(t, /NO le des ningún link ni número/);
  assert.doesNotMatch(t, /wa\.me/);
  sinFiltrar(t);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/identidad-publica.test.js`
Expected: FAIL with `Cannot find module '../src/lib/identidad-publica'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/identidad-publica.js
// Identidad publica del asesor (Juan, 2026-10-07): hacia colegas y clientes los
// asesores no se identifican por nombre sino como "Asesor 1", "Asesor 2"...
// (advisors.alias_publico), y nadie recibe el celular de una asesora: si
// alguien pide una persona, Sofi le avisa a la asesora y es ella quien escribe
// o llama. Todo texto hacia afuera que nombre a un asesor sale de aca, para
// que la regla viva en un solo lugar. Hacia adentro (avisos a la asesora,
// CRM) se sigue usando el nombre real.
// Spec: docs/superpowers/specs/2026-10-07-sofi-vendedora-y-agenda-design.md §2.

function aliasPublico(advisor, org) {
  const alias = advisor && String(advisor.alias_publico || "").trim();
  if (alias) return alias;
  return `un asesor de ${(org && org.name) || "la inmobiliaria"}`;
}

function textoCitaConfirmada({ cuando, ref, advisor, org }) {
  const refLinea = ref ? ` a la ref ${ref}` : "";
  return `Tu visita ${cuando}${refLinea} quedó CONFIRMADA. Te recibe ${aliasPublico(advisor, org)}.`;
}

function instruccionTransferencia({ especialidad, advisor, org }) {
  const alias = aliasPublico(advisor, org);
  return (
    `Transferencia registrada al asesor de ${especialidad} (${alias}). Ya fue alertado con el resumen del cliente. ` +
    `En tu respuesta despedite brevemente y decile que ${alias} lo va a contactar por este medio o por llamada. ` +
    `NO le des ningún link ni número de teléfono: el contacto lo inicia el asesor.`
  );
}

module.exports = { aliasPublico, textoCitaConfirmada, instruccionTransferencia };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/identidad-publica.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/identidad-publica.js test/identidad-publica.test.js
git commit -m "feat(identidad): textos hacia afuera con alias del asesor y sin celular"
```

---

### Task 2: confirmar_cita y transferir_a_asesor usan el alias

**Files:**
- Modify: `src/agent/tools.js` (bloque `textoCliente` cerca de la línea 972; return de `transferir_a_asesor` cerca de la 849-850)
- Test: `test/identidad-publica.test.js` (agregar test de cableado)

**Interfaces:**
- Consumes: `textoCitaConfirmada`, `instruccionTransferencia` (Task 1)

- [ ] **Step 1: Write the failing test** (agregar al final de `test/identidad-publica.test.js`)

```js
const fs = require("node:fs");
const path = require("node:path");
const fuenteTools = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "tools.js"), "utf8");

test("tools.js arma la confirmación y la transferencia con identidad-publica", () => {
  assert.match(fuenteTools, /textoCitaConfirmada\(/);
  assert.match(fuenteTools, /instruccionTransferencia\(/);
  assert.doesNotMatch(fuenteTools, /Te recibe \$\{ctx\.advisor\.name\}/, "el nombre real ya no va al cliente");
  assert.doesNotMatch(fuenteTools, /link EXACTO para que el cliente hable directo con el asesor/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/identidad-publica.test.js`
Expected: FAIL en "tools.js arma la confirmación…"

- [ ] **Step 3: Implement**

En `src/agent/tools.js`, junto a los otros `require` del encabezado:

```js
const { textoCitaConfirmada, instruccionTransferencia } = require("../lib/identidad-publica");
```

Reemplazar:

```js
    const textoCliente = `Tu visita ${cuando}${refLinea} quedó CONFIRMADA. Te recibe ${ctx.advisor.name}${
      ctx.advisor.phone ? `, +${ctx.advisor.phone}` : ""
    }.`;
```

por:

```js
    // Hacia el cliente/colega va el alias, nunca el nombre ni el celular (identidad-publica.js).
    const textoCliente = textoCitaConfirmada({ cuando, ref: cita.ref, advisor: ctx.advisor, org: ctx.org });
```

Reemplazar:

```js
    const link = buildClientLink(advisor, ctx.lead, ctx.propertyInteres, ctx.cita);
    return `Transferencia registrada al asesor de ${especialidad}: ${advisor.name}. Ya fue alertado con el resumen del cliente. En tu respuesta despidete brevemente e incluye este link EXACTO para que el cliente hable directo con el asesor:\n${link}`;
```

por:

```js
    // Sin link ni celular del asesor (Juan, 2026-10-07): el asesor contacta al cliente.
    return instruccionTransferencia({ especialidad, advisor, org: ctx.org });
```

Quitar `buildClientLink` de la desestructuración del `require("../notifications/advisor")` en la línea 9 (la función sigue exportada y probada en `test/advisor.test.js` y `test/lead-idioma.test.js`; no se borra).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, 0 fail. Si algún test fijaba "Te recibe <nombre>" o el link del asesor en la transferencia, actualizar la aserción a `/Te recibe Asesor/` o `/lo va a contactar/` respectivamente.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.js test/identidad-publica.test.js
git commit -m "feat(identidad): confirmación de visita y transferencia sin nombre ni celular del asesor"
```

---

### Task 3: pedir_contacto_asesora sin nombre ni celular

**Files:**
- Modify: `src/agent/tools.js` (`pedirContactoAsesora`, ~líneas 1633-1700)
- Modify: `test/colega-pide-asesora.test.js`

**Interfaces:**
- Consumes: `aliasPublico` (Task 1)

- [ ] **Step 1: Update the tests first**

En `test/colega-pide-asesora.test.js`:

```js
const DAIANA = { id: "adv-daiana", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1" };
```

Reemplazar en "un colega pide hablar con alguien…":

```js
  assert.match(out, /^Listo: ya le avisé a Daiana Zea/);
  assert.match(out, /\+57 301 188 0668/);
```

por:

```js
  assert.match(out, /^Listo: ya le avisé a Asesor 1/);
  assert.doesNotMatch(out, /Daiana|301 188 0668|573011880668/, "Sofi no recibe nombre real ni celular");
  assert.match(out, /NO le des ningún número/);
```

En "si lo vuelve a pedir en 30 minutos…": `/^Ya le avisé a Asesor 1 hace un rato/` y agregar `assert.doesNotMatch(out, /301 188 0668/);`.

En "si el aviso no llega…": reemplazar `/^NO le llegó el aviso a Daiana Zea/` por `/^NO le llegó el aviso a Asesor 1/` y agregar:

```js
  assert.doesNotMatch(out, /301 188 0668|573011880668/, "ni siquiera cuando falla se le da el celular");
  assert.match(out, /el equipo le va a escribir/);
```

El aviso A LA ASESORA (`envios[0].texto`) no cambia: sigue con el contacto del colega.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/colega-pide-asesora.test.js`
Expected: FAIL (los textos aún traen nombre y celular)

- [ ] **Step 3: Implement**

En `pedirContactoAsesora` (`src/agent/tools.js`), agregar el require tardío junto a los demás del cuerpo y cambiar las tres salidas a Sofi:

```js
  const { aliasPublico } = require("../lib/identidad-publica");
  const alias = aliasPublico(asesora, ctx.org);
```

(colocarlo justo después de verificar `asesora`, y eliminar `nombreAsesora`/`celularAsesora` de los textos que vuelven a Sofi; `nombreAsesora` sigue sirviendo para el `console.warn`).

```js
  if (antes && Date.now() - antes < VENTANA_REPETIDO_CONTACTO_MS) {
    return `Ya le avisé a ${alias} hace un rato; no hace falta otro aviso. Decile al colega que ya tiene el aviso y que ${alias} le va a escribir o llamar. NO le des ningún número.`;
  }
```

```js
  if (!principal || !principal.ok) {
    console.warn(`[tools] No le llego a ${nombreAsesora} el pedido de contacto del colega:`, principal && principal.error);
    return `NO le llegó el aviso a ${alias} (WhatsApp lo rechazó). NO le digas al colega que ya le avisaste ni le des ningún número: decile que quedó registrado y que el equipo le va a escribir apenas pueda.`;
  }

  pedidosContactoRecientes.set(clave, Date.now());
  return `Listo: ya le avisé a ${alias} y se va a comunicar con el colega. Decíselo así, con ese nombre (${alias}). NO le des ningún número: el contacto lo inicia ${alias}.`;
```

`celularLegible` sigue usándose para el teléfono del colega en el aviso a la asesora; no se borra.

- [ ] **Step 4: Run tests**

Run: `node --test test/colega-pide-asesora.test.js` → PASS; luego `npm test` → 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.js test/colega-pide-asesora.test.js
git commit -m "feat(identidad): el colega que pide una persona recibe el alias, no el celular"
```

---

### Task 4: Prompt del colega sin nombre ni celular de quien coordina

**Files:**
- Modify: `src/agent/prompts.js` (líneas 126, 139 del bloque estable de `promptColega`; bloque `bloqueCoordinador` ~175-184)
- Modify: `src/agent/engine.js` (~líneas 250-258)
- Modify: `test/citas-colega.test.js` (tests "el contacto de quien coordina se INYECTA…" y "sin coordinador resuelto…")

**Interfaces:**
- Consumes: `aliasPublico` (Task 1)
- Produces: `coordinador` pasa de `{ nombre, telefono }` a `{ alias }`

- [ ] **Step 1: Update the tests first**

Reemplazar el test "el contacto de quien coordina se INYECTA, no se hardcodea" por:

```js
test("quien coordina se INYECTA con su alias, sin nombre real ni celular", () => {
  const bloques = buildSystemPrompt({
    org: ORG,
    lead: { id: "l1", estado: "nuevo" },
    qualified: false,
    now: null,
    colega: { nombre: "Esteban Higuita" },
    coordinador: { alias: "Asesor 1" },
  });
  const estable = bloques[0].text;
  const volatil = bloques[bloques.length - 1].text;
  assert.match(volatil, /COORDINA LAS VISITAS: Asesor 1/, "va en el bloque volatil");
  assert.doesNotMatch(volatil, /celular|\+57|57300/i, "sin celular");
  assert.doesNotMatch(estable, /pasale el nombre y el celular/i, "el prompt ya no le pide dar celulares");
  assert.match(estable, /NUNCA le des el celular de nadie del equipo/);
});
```

En "sin coordinador resuelto…", cambiar la última aserción por:

```js
  assert.match(bloques[0].text, /si abajo no aparece ninguno/i, "el prompt tiene que decirle que hacer cuando no hay quien coordine");
```

Agregar al test de engine:

```js
  assert.match(fuente, /aliasPublico/, "engine pasa el alias, no el nombre ni el telefono");
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/citas-colega.test.js`
Expected: FAIL

- [ ] **Step 3: Implement**

`src/agent/prompts.js`, línea 126 — reemplazar la frase final:

`... y ahi usa pedir_contacto_asesora y pasale el nombre y el celular que te devuelva. Nunca digas que ya avisaste sin haberla usado.`

por:

`... y ahi usa pedir_contacto_asesora y decile el nombre que te devuelva (es un alias como "Asesor 1"): esa persona es la que le escribe o lo llama. NUNCA le des el celular de nadie del equipo. Nunca digas que ya avisaste sin haberla usado.`

Línea 139 — reemplazar:

`... que quien coordina las visitas valida la disponibilidad y lo contacta para confirmarla, y pasale el nombre y el celular de quien coordina las visitas (los tenes abajo en el contexto, en COORDINA LAS VISITAS) para que pueda hablarle directo. NUNCA inventes ese nombre ni ese numero: si abajo no aparece ninguno, decile solamente que del equipo le escriben para coordinar.`

por:

`... que quien coordina las visitas valida la disponibilidad y lo contacta para confirmarla. Nombrala como aparece abajo en el contexto, en COORDINA LAS VISITAS (es un alias como "Asesor 1"). NUNCA le des el celular de nadie del equipo ni inventes un nombre: si abajo no aparece ninguno, decile solamente que del equipo le escriben para coordinar.`

`bloqueCoordinador`:

```js
  // Quien coordina las visitas, con su ALIAS publico (Juan, 2026-10-07): hacia
  // el colega no va el nombre real ni el celular; lo contacta ella. Inyectado
  // en el bloque volatil: es un dato del tenant (engine.js).
  const bloqueCoordinador =
    coordinador && coordinador.alias
      ? `\n\nCOORDINA LAS VISITAS: ${coordinador.alias}. Es quien valida la visita y le escribe o lo llama para confirmarla.`
      : "";
```

Actualizar el comentario de arriba (líneas 175-181) para que diga que desde 2026-10-07 va el alias.

`src/agent/engine.js`:

```js
  const { aliasPublico } = require("../lib/identidad-publica");
  const coordinador = colega
    ? await advisors
        .findAsesorPrincipalRadar(org)
        .then((a) => (a ? { alias: aliasPublico(a, org) } : null))
        .catch((e) => {
          console.warn("[engine] No se pudo resolver quien coordina las visitas del colega:", e.message);
          return null;
        })
    : null;
```

(el `require` va con los demás del encabezado de `engine.js`).

- [ ] **Step 4: Run tests**

Run: `node --test test/citas-colega.test.js test/colega-escribe-a-sofi.test.js` → PASS; `npm test` → 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts.js src/agent/engine.js test/citas-colega.test.js
git commit -m "feat(identidad): Sofi nombra a quien coordina por su alias y no da celulares"
```

---

### Task 5: Alerta de saldo de Anthropic

**Files:**
- Create: `src/lib/alerta-saldo.js`
- Modify: `src/lib/anthropic.js`
- Modify: `.env.example` (raíz)
- Test: `test/alerta-saldo.test.js`

**Interfaces:**
- Produces:
  - `esErrorDeSaldo(err) -> boolean`
  - `observarError(err, { ahora?, enviar? }) -> Promise<boolean>` (true si avisó)
  - `_reset()` (tests)

- [ ] **Step 1: Write the failing test**

```js
// test/alerta-saldo.test.js
// 2026-09-25 -> 2026-10-07: la cuenta de Anthropic se quedo sin saldo y Sofi y
// el radar callaron 12 dias. Nadie se entero porque las alertas tecnicas iban
// a la linea de la asesora y ASESORA_SOLO_VISITAS las apaga.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const alerta = require("../src/lib/alerta-saldo");

const SALDO = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), { status: 400 });
const TOPE = new Error("400 You have reached your specified API usage limits. You will regain access on 2026-10-01");
const OTRO = new Error("529 overloaded");

let enviados;
const enviar = async (texto) => { enviados.push(texto); return true; };
beforeEach(() => { enviados = []; alerta._reset(); });

test("reconoce saldo agotado y tope de gasto, y nada mas", () => {
  assert.strictEqual(alerta.esErrorDeSaldo(SALDO), true);
  assert.strictEqual(alerta.esErrorDeSaldo(TOPE), true);
  assert.strictEqual(alerta.esErrorDeSaldo(OTRO), false);
  assert.strictEqual(alerta.esErrorDeSaldo(null), false);
});

test("avisa una vez y no repite durante el enfriamiento", async () => {
  const t0 = new Date("2026-10-07T12:00:00Z");
  assert.strictEqual(await alerta.observarError(SALDO, { ahora: t0, enviar }), true);
  assert.strictEqual(await alerta.observarError(SALDO, { ahora: new Date(t0.getTime() + 60 * 60 * 1000), enviar }), false);
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0], /sin saldo|tope de gasto/i);
  assert.match(enviados[0], /Sofi y el radar/);
});

test("pasado el enfriamiento (6 h) vuelve a avisar", async () => {
  const t0 = new Date("2026-10-07T12:00:00Z");
  await alerta.observarError(SALDO, { ahora: t0, enviar });
  await alerta.observarError(SALDO, { ahora: new Date(t0.getTime() + 6 * 60 * 60 * 1000 + 1), enviar });
  assert.strictEqual(enviados.length, 2);
});

test("un error que no es de saldo no avisa", async () => {
  assert.strictEqual(await alerta.observarError(OTRO, { enviar }), false);
  assert.strictEqual(enviados.length, 0);
});

test("el cliente compartido observa los errores y los vuelve a lanzar", async () => {
  const anthropic = require("../src/lib/anthropic");
  const vistos = [];
  const original = alerta.observarError;
  alerta.observarError = async (e) => { vistos.push(e); return true; };
  try {
    anthropic._setClientForTests({ messages: { create: async () => { throw SALDO; } } });
    await assert.rejects(() => anthropic.getClient().messages.create({}), /credit balance/);
    assert.strictEqual(vistos.length, 1);
  } finally {
    alerta.observarError = original;
    anthropic._setClientForTests(null);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/alerta-saldo.test.js`
Expected: FAIL `Cannot find module '../src/lib/alerta-saldo'`

- [ ] **Step 3: Implement**

```js
// src/lib/alerta-saldo.js
// Aviso de saldo/tope de Anthropic por un canal que NO es la linea de la
// asesora (2026-10-07). Del 25-sep al 7-oct la cuenta se quedo sin saldo:
// Sofi y el radar callaron 12 dias y nadie se entero, porque el vigilante
// avisa a RADAR_WATCHDOG_TO (el numero de Daiana) y ASESORA_SOLO_VISITAS lo
// apaga. Este aviso va a ALERTA_TECNICA_TO (Juan) y no lo apaga nada.
//
// Por WhatsApp oficial (no depende de Anthropic). Si la ventana de 24 h con
// ese numero esta cerrada, sale la plantilla `alerta_tecnica`. Enfriamiento
// de 6 h (ALERTA_SALDO_CADA_MIN) para no repetir en cada mensaje fallido.

const PATRON = /credit balance is too low|specified API usage limits/i;
const CADA_MIN = Number(process.env.ALERTA_SALDO_CADA_MIN || 360);
let ultimoAviso = 0;

function esErrorDeSaldo(err) {
  if (!err) return false;
  const texto = [err.message, err.error && err.error.error && err.error.error.message].filter(Boolean).join(" ");
  return PATRON.test(texto);
}

function destinos() {
  return String(process.env.ALERTA_TECNICA_TO || "").split(",").map((t) => t.replace(/\D/g, "")).filter(Boolean);
}

async function enviarPorWhatsapp(texto) {
  const lista = destinos();
  if (lista.length === 0) {
    console.error(`[alerta-saldo] ALERTA_TECNICA_TO vacio. ${texto}`);
    return false;
  }
  // Requires tardios: whatsapp.js arrastra engine.js, que usa anthropic.js.
  const canal = require("../channels/whatsapp");
  const organizations = require("../data/organizations");
  const org = await organizations.getDefault();
  let alguno = false;
  for (const to of lista) {
    let r = await canal.sendWhatsApp(org, to, texto).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) {
      r = await canal
        .sendWhatsAppTemplate(org, to, { name: "alerta_tecnica", bodyParams: ["Anthropic sin saldo o con tope de gasto: Sofi y el radar no responden."] })
        .catch((e) => ({ ok: false, error: e.message }));
    }
    if (r && r.ok) alguno = true;
    else console.error(`[alerta-saldo] NO se pudo avisar a ${to}: ${r && r.error}`);
  }
  return alguno;
}

async function observarError(err, { ahora = new Date(), enviar = enviarPorWhatsapp } = {}) {
  if (!esErrorDeSaldo(err)) return false;
  if (ultimoAviso && ahora.getTime() - ultimoAviso < CADA_MIN * 60 * 1000) return false;
  ultimoAviso = ahora.getTime();
  const texto =
    "🚨 Anthropic sin saldo o con tope de gasto: Sofi y el radar no están respondiendo. " +
    "Recargá en console.anthropic.com → Plans & Billing. Detalle: " +
    String(err.message || "").slice(0, 160);
  console.error(`[alerta-saldo] ${texto}`);
  return enviar(texto).catch((e) => {
    console.error("[alerta-saldo] fallo el envio:", e.message);
    return false;
  });
}

function _reset() {
  ultimoAviso = 0;
}

module.exports = { esErrorDeSaldo, observarError, _reset };
```

`src/lib/anthropic.js` — reemplazar `getClient` por:

```js
// Todo error de la API pasa por alerta-saldo antes de seguir su camino: si es
// saldo agotado o tope de gasto, avisa a ALERTA_TECNICA_TO (2026-10-07). El
// error se vuelve a lanzar igual; observar nunca cambia el comportamiento.
function conVigilancia(c) {
  if (!c || !c.messages || c.messages.__vigilado) return c;
  const original = c.messages.create.bind(c.messages);
  c.messages.create = async (...args) => {
    try {
      return await original(...args);
    } catch (e) {
      try {
        require("./alerta-saldo").observarError(e).catch(() => {});
      } catch {
        // Observar nunca puede romper la llamada.
      }
      throw e;
    }
  };
  c.messages.__vigilado = true;
  return c;
}

function getClient() {
  if (testClient) return conVigilancia(testClient);
  if (!client) client = conVigilancia(new Anthropic({ apiKey: config.anthropicApiKey, timeout: DEFAULT_TIMEOUT_MS }));
  return client;
}
```

Nota: el test reemplaza `alerta.observarError`; por eso `conVigilancia` lo lee en cada error con `require("./alerta-saldo").observarError` y no lo captura al cargar.

`.env.example` (raíz), agregar:

```
# Aviso de saldo/tope de Anthropic (Juan). NO es la linea de la asesora y no lo apaga ASESORA_SOLO_VISITAS.
ALERTA_TECNICA_TO=
# Minutos entre avisos repetidos (default 360)
ALERTA_SALDO_CADA_MIN=360
```

- [ ] **Step 4: Run tests**

Run: `node --test test/alerta-saldo.test.js test/anthropic-cache.test.js` → PASS; `npm test` → 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alerta-saldo.js src/lib/anthropic.js test/alerta-saldo.test.js .env.example
git commit -m "feat(alertas): aviso de saldo de Anthropic a ALERTA_TECNICA_TO, fuera de la línea de la asesora"
```

---

### Task 6: Despliegue y configuración

- [ ] **Step 1:** Subir la plantilla `alerta_tecnica` a la WABA `1702397800906189` (UTILITY, `es`): cuerpo "Alerta técnica de Diamond: {{1}} Revisá la consola y los logs.", ejemplo `["Anthropic sin saldo o con tope de gasto: Sofi y el radar no responden."]`.
- [ ] **Step 2:** Variable en Railway servicio `diamond`: `ALERTA_TECNICA_TO=<número de Juan, solo dígitos>` (pedírselo a Juan; no es un número de asesora).
- [ ] **Step 3:** `npm test` completo en verde; `git push origin main`; esperar el deploy SUCCESS del servicio `diamond`.
- [ ] **Step 4:** Verificación en producción: con `railway run --service diamond node -e` llamar `require('./src/lib/alerta-saldo').observarError(new Error('credit balance is too low'))` y confirmar que llega el WhatsApp a Juan.

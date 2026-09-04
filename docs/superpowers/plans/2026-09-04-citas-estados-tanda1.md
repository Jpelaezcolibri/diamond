# Citas con colegas — Tanda 1: el registro deja de mentir

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una cita cancelada quede cancelada de verdad — fuera del calendario, fuera de la agenda del asesor, y con el colega avisado.

**Architecture:** `leads.cita` es un jsonb sin estado real: se escribe una vez como `"solicitada"` y nadie lo vuelve a leer. Se agrega una máquina de estados en un módulo propio (`src/data/citas.js`), se la hace respetar en los tres lugares que hoy la ignoran (el anti-choque de la agenda, el calendario del CRM y el registro), y se le da al equipo una vía para cancelar que además le avisa al colega con una cascada de canales.

**Tech Stack:** Node.js 22 + CommonJS (bot), Next.js 16 + TypeScript (CRM), Supabase, `node:test` + `node:assert`. Sin frameworks de test.

**Spec:** [2026-09-04-citas-colega-y-atribuciones-sofi-design.md](../specs/2026-09-04-citas-colega-y-atribuciones-sofi-design.md) — esta es la **Tanda 1** de las dos que define la sección 10. La Tanda 2 (Sofi en el circuito) va en un plan aparte.

## Global Constraints

- Idioma del código: inglés. Comentarios y mensajes al usuario: español.
- Commits en español con prefijo convencional (`feat:`, `fix:`, `docs:`).
- `npm test` completo en verde antes de cada commit. Si el CRM se toca, además `npx tsc --noEmit` dentro de `crm/`.
- **`leads.cita` es jsonb: no hay migración SQL.** Una cita vieja sin `estado` se lee como `confirmada` — es lo que el equipo asumió todo este tiempo. Nunca se inventa un backfill.
- **Sofi nunca escribe `confirmada`.** Solo una persona, desde el CRM.
- Cancelar **siempre** cambia el registro, aunque el aviso al colega falle. Una agenda que miente es el problema que este plan viene a arreglar.
- El mensaje al colega nunca nombra a "Diamond" ni lleva el link de la landing (regla del mensaje blanqueado).
- Todo aviso es best-effort: un fallo notificando no puede tumbar la cancelación.

---

### Task 1: La máquina de estados

**Files:**
- Create: `src/data/citas.js`
- Test: `test/citas-estados.test.js`

**Interfaces:**
- Produces:
  - `ESTADOS` = `["propuesta", "confirmada", "cancelada", "reprogramada"]`
  - `estadoDe(cita)` → string. Una cita sin `estado`, o con uno desconocido, devuelve `"confirmada"`.
  - `estaViva(cita)` → boolean. `false` para `cancelada`; `true` para el resto.
  - `esValido(estado)` → boolean.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/citas-estados.test.js`:

```js
// LA CITA NO TENIA ESTADO (Juan, 2026-09-04). `leads.cita.estado` se escribia
// UNA vez como "solicitada" (src/agent/tools.js) y nadie lo volvia a tocar: no
// habia forma de cancelar nada. El calendario del equipo ni siquiera leia el
// campo, asi que la visita cancelada de hoy se seguia mostrando como si fuera
// a ocurrir.
const { test } = require("node:test");
const assert = require("node:assert");
const citas = require("../src/data/citas");

// RETROCOMPATIBILIDAD: las citas que ya estan en la base no tienen estado.
// Se leen como confirmada porque es lo que el equipo asumio todo este tiempo
// — inventar otra cosa seria reescribir la historia.
test("una cita sin estado se lee como confirmada", () => {
  assert.strictEqual(citas.estadoDe({ fecha_hora: "2026-09-10T15:00:00-05:00" }), "confirmada");
  assert.strictEqual(citas.estadoDe({ estado: "solicitada" }), "confirmada");
});

test("un estado desconocido tampoco rompe: se lee como confirmada", () => {
  assert.strictEqual(citas.estadoDe({ estado: "cualquier-cosa" }), "confirmada");
});

test("los cuatro estados validos se leen tal cual", () => {
  for (const e of citas.ESTADOS) assert.strictEqual(citas.estadoDe({ estado: e }), e);
});

// `estaViva` es lo que van a consultar el calendario y el anti-choque de la
// agenda: una cancelada no ocupa espacio ni se muestra.
test("solo la cancelada deja de estar viva", () => {
  assert.strictEqual(citas.estaViva({ estado: "cancelada" }), false);
  assert.strictEqual(citas.estaViva({ estado: "propuesta" }), true);
  assert.strictEqual(citas.estaViva({ estado: "confirmada" }), true);
  assert.strictEqual(citas.estaViva({ estado: "reprogramada" }), true);
  assert.strictEqual(citas.estaViva({}), true, "una cita vieja sigue viva");
});

test("una cita nula no esta viva y no revienta", () => {
  assert.strictEqual(citas.estaViva(null), false);
  assert.strictEqual(citas.estadoDe(null), "confirmada");
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/citas-estados.test.js`
Expected: FAIL — `Cannot find module '../src/data/citas'`.

- [ ] **Step 3: Escribir el módulo**

Crear `src/data/citas.js`:

```js
// El estado de una cita, y quien puede moverlo.
//
// POR QUE EXISTE (Juan, 2026-09-04). `leads.cita` es un jsonb que se escribia
// UNA sola vez con estado "solicitada" (src/agent/tools.js#agendar_cita) y que
// nadie volvia a tocar: no habia forma de cancelar ni de reprogramar. El
// calendario del equipo (crm/lib/calendar-events.ts) ni siquiera tenia el
// campo en su tipo, asi que una cita cancelada se seguia mostrando.
//
// El caso que lo destapo: el 2026-09-04 un colega pidio una visita para las
// 16:00 del mismo dia, se cancelo, y el registro siguio diciendo "solicitada".
//
// RETROCOMPATIBILIDAD, y es lo que evita una migracion: una cita sin `estado`
// —todas las que ya existen— se lee como `confirmada`. Es lo que el equipo
// asumio todo este tiempo; inventarle otro estado seria reescribir la
// historia. Por eso `estadoDe` nunca falla ni devuelve null.
const ESTADOS = ["propuesta", "confirmada", "cancelada", "reprogramada"];

function esValido(estado) {
  return ESTADOS.includes(estado);
}

function estadoDe(cita) {
  const e = cita && cita.estado;
  return esValido(e) ? e : "confirmada";
}

// Lo que consultan el calendario y el anti-choque de la agenda. Una cancelada
// no ocupa espacio ni se muestra; una propuesta SI ocupa —todavia puede
// confirmarse, y dos personas no pueden reservar la misma hora.
function estaViva(cita) {
  if (!cita) return false;
  return estadoDe(cita) !== "cancelada";
}

module.exports = { ESTADOS, esValido, estadoDe, estaViva };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/citas-estados.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/citas.js test/citas-estados.test.js
git commit -m "feat(citas): la cita gana estados, y una vieja sin estado se lee como confirmada"
```

---

### Task 2: Una cita cancelada deja de ocupar la agenda

**Files:**
- Modify: `src/data/appointments.js:56-81` (`hayChoque` y `citasDeLaOrg`)
- Test: `test/appointments.test.js`

**Interfaces:**
- Consumes: `citas.estaViva(cita)` de la Task 1.
- Produces: `checkAvailability` y `proximoDisponible` sin cambio de firma; ya no consideran citas canceladas.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/appointments.test.js`:

```js
// SI NO SE LIBERA EL ESPACIO, CANCELAR NO SIRVE (Juan, 2026-09-04).
// hayChoque miraba TODAS las citas del lead sin importar su estado, asi que
// una cancelada seguia bloqueando esa hora en la agenda del asesor. Cancelar
// habria sido cosmetico: el registro cambiaba y la agenda seguia ocupada.
test("una cita cancelada no bloquea esa hora en la agenda", async () => {
  const appointments = require("../src/data/appointments");
  const advisorId = "auth-user-1";
  const cuando = "2026-09-10T15:00:00-05:00";
  const cancelada = [{ id: "lead-1", cita: { advisor_id: advisorId, fecha_hora: cuando, estado: "cancelada" } }];
  assert.strictEqual(appointments.hayChoque(cancelada, advisorId, cuando), false);
});

// Una propuesta SI ocupa: todavia puede confirmarse, y dos personas no pueden
// reservar la misma hora.
test("una cita propuesta si bloquea esa hora", async () => {
  const appointments = require("../src/data/appointments");
  const advisorId = "auth-user-1";
  const cuando = "2026-09-10T15:00:00-05:00";
  const propuesta = [{ id: "lead-1", cita: { advisor_id: advisorId, fecha_hora: cuando, estado: "propuesta" } }];
  assert.strictEqual(appointments.hayChoque(propuesta, advisorId, cuando), true);
});

// Una cita vieja sin estado sigue ocupando: es lo que el equipo asumio.
test("una cita sin estado sigue bloqueando", async () => {
  const appointments = require("../src/data/appointments");
  const advisorId = "auth-user-1";
  const cuando = "2026-09-10T15:00:00-05:00";
  const vieja = [{ id: "lead-1", cita: { advisor_id: advisorId, fecha_hora: cuando } }];
  assert.strictEqual(appointments.hayChoque(vieja, advisorId, cuando), true);
});
```

Si `hayChoque` no está exportado, agregarlo a `module.exports` de
`src/data/appointments.js` en el Step 3.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/appointments.test.js`
Expected: FAIL — la cancelada devuelve `true` (bloquea).

- [ ] **Step 3: Filtrar por estado**

En `src/data/appointments.js`, dentro de `hayChoque`, después de la línea
`if (l.id === excludeLeadId) return false;`:

```js
    // Una cancelada no ocupa espacio (Juan, 2026-09-04): si no se libera la
    // hora, cancelar es cosmetico — el registro cambia y la agenda sigue
    // bloqueada. Una PROPUESTA si ocupa: todavia puede confirmarse y dos
    // personas no pueden reservar la misma hora.
    if (!citasData.estaViva(l.cita)) return false;
```

Agregar arriba del archivo: `const citasData = require("./citas");`

Exportar `hayChoque` si no lo estaba.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/appointments.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/appointments.js test/appointments.test.js
git commit -m "fix(citas): una cita cancelada deja de bloquear la agenda del asesor"
```

---

### Task 3: Cancelar una cita, con el aviso al colega en cascada

**Files:**
- Create: `src/groups/cancelar-cita.js`
- Test: `test/cancelar-cita.test.js`

**Interfaces:**
- Consumes: `citas.estadoDe` / `citas.estaViva` (Task 1).
- Produces: `cancelar(org, leadId, { motivo, sesion })` →
  `{ ok, resultado, aviso }` donde `resultado` ∈ `"cancelada" | "no_encontrada" | "ya_cancelada"` y
  `aviso` ∈ `"oficial" | "linea_natalia" | "no_se_pudo"`.

**Por qué un módulo propio:** el orden de la cascada y la regla de "cancelar
siempre, avisar después" son la lógica de negocio de esta función. Metida
dentro de una ruta del CRM quedaría imposible de probar sin HTTP.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/cancelar-cita.test.js`:

```js
// CANCELAR SIEMPRE CAMBIA EL REGISTRO (Juan, 2026-09-04), aunque el aviso al
// colega falle. Una agenda que miente es el problema que esto viene a
// arreglar: no se puede dejar sin cancelar porque no pudimos escribir.
//
// La cascada del aviso: linea oficial de Sofi (donde el colega ya habla,
// sujeta a la ventana de 24 h de Meta) -> linea de Natalia por WAHA (sin
// ventana, y un numero que el colega conoce de los grupos) -> alerta al
// equipo.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));

let leadGuardado = null;
let enviosOficial = [];
let enviosWaha = [];
let alertas = [];
let oficialFalla = false;
let wahaFalla = false;

function instalar(citaInicial) {
  leadGuardado = null;
  enviosOficial = [];
  enviosWaha = [];
  alertas = [];

  require.cache[RUTA("data/leads.js")] = {
    exports: {
      findById: async () => ({ id: "lead-1", nombre: "Miguel", phone: "573147815403", cita: citaInicial }),
      update: async (id, patch) => { leadGuardado = patch; return { id, ...patch }; },
    },
  };
  require.cache[RUTA("channels/whatsapp.js")] = {
    exports: {
      sendWhatsApp: async (org, to, texto) => {
        enviosOficial.push({ to, texto });
        return oficialFalla ? { ok: false, error: "ventana cerrada" } : { ok: true, wamid: "wm-1" };
      },
    },
  };
  require.cache[RUTA("lib/waha.js")] = {
    exports: {
      enviarDm: async (sesion, telefono, texto, opts) => {
        enviosWaha.push({ telefono, texto, lid: opts && opts.lid });
        return wahaFalla ? { ok: false, error: "sin sesion" } : { ok: true, wamid: "wm-2" };
      },
    },
  };
  require.cache[RUTA("lib/mensaje-asesor.js")] = {
    exports: { enviarYRegistrar: async (org, to, texto) => { alertas.push({ to, texto }); return { ok: true }; } },
  };

  delete require.cache[RUTA("groups/cancelar-cita.js")];
  return require("../src/groups/cancelar-cita");
}

beforeEach(() => { oficialFalla = false; wahaFalla = false; });

const ORG = { id: "org-1", name: "Diamond" };
const CITA = { fecha_hora: "2026-09-10T15:00:00-05:00", tipo: "visita", estado: "confirmada", ref: "9702941" };

test("cancela, deja el estado en cancelada y avisa por la linea oficial", async () => {
  const mod = instalar(CITA);
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "la propiedad ya no esta disponible" });
  assert.strictEqual(r.resultado, "cancelada");
  assert.strictEqual(r.aviso, "oficial");
  assert.strictEqual(leadGuardado.cita.estado, "cancelada");
  assert.strictEqual(enviosOficial.length, 1);
  assert.match(enviosOficial[0].texto, /cancel/i);
  assert.strictEqual(enviosWaha.length, 0, "no se molesta a la linea de Natalia si la oficial funciono");
});

test("con la ventana cerrada cae a la linea de Natalia", async () => {
  oficialFalla = true;
  const mod = instalar(CITA);
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "x", sesion: "RADA-NATALIA" });
  assert.strictEqual(r.resultado, "cancelada");
  assert.strictEqual(r.aviso, "linea_natalia");
  assert.strictEqual(enviosWaha.length, 1);
});

// Lo mas importante del modulo: el registro cambia IGUAL.
test("si los dos canales fallan, la cita queda cancelada y se alerta al equipo", async () => {
  oficialFalla = true;
  wahaFalla = true;
  const mod = instalar(CITA);
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "x", sesion: "RADA-NATALIA" });
  assert.strictEqual(r.resultado, "cancelada");
  assert.strictEqual(r.aviso, "no_se_pudo");
  assert.strictEqual(leadGuardado.cita.estado, "cancelada", "el registro cambia aunque nadie se entere");
  assert.strictEqual(alertas.length, 1);
  assert.match(alertas[0].texto, /no le pudimos avisar/i);
});

test("una cita ya cancelada no se vuelve a cancelar ni se reavisa", async () => {
  const mod = instalar({ ...CITA, estado: "cancelada" });
  const r = await mod.cancelar(ORG, "lead-1", { motivo: "x" });
  assert.strictEqual(r.resultado, "ya_cancelada");
  assert.strictEqual(enviosOficial.length, 0);
});

// Regla del mensaje blanqueado: al colega nunca se le nombra a Diamond.
test("el mensaje al colega no nombra a Diamond", async () => {
  const mod = instalar(CITA);
  await mod.cancelar(ORG, "lead-1", { motivo: "x" });
  assert.ok(!/diamond/i.test(enviosOficial[0].texto), enviosOficial[0].texto);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/cancelar-cita.test.js`
Expected: FAIL — `Cannot find module '../src/groups/cancelar-cita'`.

- [ ] **Step 3: Escribir el módulo**

Crear `src/groups/cancelar-cita.js`:

```js
// Cancela una cita y le avisa al colega.
//
// DOS REGLAS, en este orden (Juan, 2026-09-04):
//
//   1. CANCELAR SIEMPRE CAMBIA EL REGISTRO, aunque el aviso falle. Una agenda
//      que miente es el problema que esto viene a arreglar; dejar la cita en
//      pie porque no pudimos escribir seria conservar el problema.
//   2. El aviso va en cascada, y el orden importa:
//        a. Linea oficial de Sofi — donde el colega ya esta hablando. Sujeta
//           a la ventana de 24 h de Meta: si el no escribio en ese plazo,
//           Meta lo rechaza.
//        b. Linea de Natalia (WAHA) — no tiene ventana, y es un numero que el
//           colega conoce de los grupos, no uno anonimo. Gasta de los ~300
//           mensajes/mes que WhatsApp le impone a esa linea.
//        c. Ninguna funciono -> se alerta al equipo para que avise a mano.
const leads = require("../data/leads");
const citas = require("../data/citas");
const canalWhatsapp = require("../channels/whatsapp");
const waha = require("../lib/waha");
const mensajeAsesor = require("../lib/mensaje-asesor");

const ALERTA_TO = () => (process.env.RADAR_WATCHDOG_TO || "").split(",").map((t) => t.trim()).filter(Boolean);

// Sin "Diamond" y sin link de la landing: el colega puede reenviarle este
// mensaje a su propio cliente (regla del mensaje blanqueado, 2026-08-18).
function textoParaColega(cita, motivo) {
  const cuando = cita && cita.fecha_hora ? new Date(cita.fecha_hora).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : null;
  return [
    `Hola, te escribo para avisarte que la visita${cuando ? ` del ${cuando}` : ""} queda cancelada.`,
    motivo ? `Motivo: ${motivo}.` : null,
    "Disculpá el inconveniente. Si querés, te busco otras opciones parecidas.",
  ].filter(Boolean).join("\n\n");
}

async function cancelar(org, leadId, { motivo = null, sesion = null } = {}) {
  const lead = await leads.findById(leadId).catch(() => null);
  if (!lead || !lead.cita) return { ok: false, resultado: "no_encontrada", aviso: null };
  if (citas.estadoDe(lead.cita) === "cancelada") {
    return { ok: true, resultado: "ya_cancelada", aviso: null };
  }

  // PRIMERO el registro. Si el proceso muere en la linea siguiente, la cita ya
  // quedo cancelada y el calendario dice la verdad.
  const cita = { ...lead.cita, estado: "cancelada", cancelada_at: new Date().toISOString(), cancelada_motivo: motivo };
  await leads.update(leadId, { cita });

  const texto = textoParaColega(cita, motivo);
  let aviso = "no_se_pudo";

  const oficial = await canalWhatsapp.sendWhatsApp(org, lead.phone, texto).catch((e) => ({ ok: false, error: e.message }));
  if (oficial && oficial.ok) aviso = "oficial";
  else if (sesion) {
    const porWaha = await waha.enviarDm(sesion, lead.phone, texto).catch((e) => ({ ok: false, error: e.message }));
    if (porWaha && porWaha.ok) aviso = "linea_natalia";
  }

  if (aviso === "no_se_pudo") {
    const quien = lead.nombre || `+${lead.phone}`;
    const alerta = `⚠️ Cita cancelada y NO le pudimos avisar a ${quien}. Escribile vos: la ventana de 24 h esta cerrada y la linea del radar tampoco pudo.`;
    for (const to of ALERTA_TO()) {
      await mensajeAsesor.enviarYRegistrar(org, to, alerta).catch((e) =>
        console.warn("[citas] no se pudo alertar del aviso fallido:", e.message)
      );
    }
  }

  return { ok: true, resultado: "cancelada", aviso };
}

module.exports = { cancelar, textoParaColega };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/cancelar-cita.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/groups/cancelar-cita.js test/cancelar-cita.test.js
git commit -m "feat(citas): cancelar avisa al colega en cascada y el registro cambia igual"
```

---

### Task 4: El endpoint del bot para cancelar

**Files:**
- Modify: `src/api/crm.js` (agregar la ruta)
- Test: `test/cancelar-cita-endpoint.test.js`

**Interfaces:**
- Consumes: `cancelar(org, leadId, { motivo, sesion })` de la Task 3.
- Produces: `POST /api/citas/cancelar` con cuerpo `{ leadId, motivo }` →
  `200 { ok, resultado, aviso }` · `400` sin `leadId` · `404` si no existe.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/cancelar-cita-endpoint.test.js` siguiendo el patrón de
`test/senal-responder-dm-endpoint.test.js` (mismo repo): monta el router con
`express`, inyecta un doble de `src/groups/cancelar-cita.js` en el cache de
módulos, y verifica:

```js
test("POST /api/citas/cancelar sin leadId responde 400", async () => { /* ... */ });
test("cancela y devuelve el resultado y por donde salio el aviso", async () => { /* ... */ });
test("una cita que no existe responde 404", async () => { /* ... */ });
test("exige la x-api-key como el resto de /api", async () => { /* ... */ });
```

Copiá la estructura exacta de mocks de `test/senal-responder-dm-endpoint.test.js`
— no inventes un patrón nuevo.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/cancelar-cita-endpoint.test.js`
Expected: FAIL — la ruta responde 404 porque no existe.

- [ ] **Step 3: Agregar la ruta**

En `src/api/crm.js`, junto a las otras rutas de grupos:

```js
// CANCELAR UNA CITA (Juan, 2026-09-04). La dispara una persona desde el CRM:
// Sofi nunca cancela sola. La sesion de WAHA viaja para que cancelar-cita
// pueda caer a la linea de Natalia si la ventana de 24 h esta cerrada.
router.post("/api/citas/cancelar", async (req, res) => {
  const { leadId, motivo } = req.body || {};
  if (!leadId) return res.status(400).json({ error: "Falta leadId" });
  try {
    const org = await organizations.getDefault();
    const sesiones = await whatsappGroups.listSessions(org.id).catch(() => []);
    const activa = sesiones.find((s) => s.estado === "activa") || (sesiones.length === 1 ? sesiones[0] : null);
    const r = await require("../groups/cancelar-cita").cancelar(org, leadId, {
      motivo: motivo || null,
      sesion: activa ? activa.nombre : null,
    });
    if (r.resultado === "no_encontrada") return res.status(404).json({ error: "No se encontro esa cita" });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test test/cancelar-cita-endpoint.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/crm.js test/cancelar-cita-endpoint.test.js
git commit -m "feat(citas): endpoint para cancelar una cita desde el CRM"
```

---

### Task 5: El calendario del equipo respeta los estados

**Files:**
- Modify: `crm/lib/calendar-events.ts`
- Modify: `crm/app/(dashboard)/calendario/page.tsx`

**Interfaces:**
- Produces: `CalendarEvent` gana `estado: "propuesta" | "confirmada"`. Las
  canceladas **no entran** en el array de eventos.

- [ ] **Step 1: Agregar el estado al tipo y filtrar las canceladas**

En `crm/lib/calendar-events.ts`:

En el tipo `Cita`, agregar `estado?: string | null;`

En el tipo `CalendarEvent`, agregar:

```ts
  /** Estado de la cita (Juan, 2026-09-04). Una "propuesta" la pidió un colega
   *  y NADIE la confirmó todavía: no es un compromiso y el calendario tiene
   *  que decirlo. Las canceladas no llegan hasta acá — se filtran antes.
   *  Una cita vieja sin estado se lee como "confirmada": es lo que el equipo
   *  asumió todo este tiempo. */
  estado: "propuesta" | "confirmada";
```

Agregar el helper, espejo de `src/data/citas.js#estadoDe`:

```ts
// Espejo de src/data/citas.js#estadoDe. Se duplica a propósito: el CRM no
// comparte código con el bot, y una cita sin estado —todas las que ya
// existen— tiene que leerse igual en los dos lados.
function estadoDeCita(cita: Cita | null): "propuesta" | "confirmada" | "cancelada" | "reprogramada" {
  const e = cita?.estado;
  if (e === "propuesta" || e === "cancelada" || e === "reprogramada") return e;
  return "confirmada";
}
```

Donde se mapea cada lead con cita a un `CalendarEvent`, saltear las canceladas
y poner el estado:

```ts
    const estado = estadoDeCita(lead.cita);
    if (estado === "cancelada") continue; // no se muestra: fue cancelada
```

y en el objeto del evento: `estado: estado === "propuesta" ? "propuesta" : "confirmada",`

Los otros dos orígenes (`recordatorio_equipo`, `avance_colega`) llevan
`estado: "confirmada"` — no tienen ciclo de vida propio.

- [ ] **Step 2: Mostrar la diferencia en la página**

En `crm/app/(dashboard)/calendario/page.tsx`, donde se pinta cada evento,
agregar el rótulo cuando `evento.estado === "propuesta"`:

```tsx
{evento.estado === "propuesta" && (
  <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
    propuesta — sin confirmar
  </span>
)}
```

Seguí las clases de Tailwind que ya usa esa página para el resto de los
badges; no introduzcas un sistema de color nuevo.

- [ ] **Step 3: Verificar tipos y build**

Run: `cd crm && npx tsc --noEmit`
Expected: sin errores.

Run: `cd crm && npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add crm/lib/calendar-events.ts "crm/app/(dashboard)/calendario/page.tsx"
git commit -m "feat(crm): el calendario oculta las citas canceladas y marca las propuestas"
```

---

### Task 6: El botón de cancelar en el CRM

**Files:**
- Create: `crm/app/api/citas/cancelar/route.ts`
- Modify: `crm/app/(dashboard)/calendario/page.tsx`

**Interfaces:**
- Consumes: `POST /api/citas/cancelar` del bot (Task 4), vía `callBot`.

- [ ] **Step 1: La ruta del CRM**

Crear `crm/app/api/citas/cancelar/route.ts`, siguiendo exactamente el patrón de
`crm/app/api/grupos/sesion/route.ts` (auth con `supabase.auth.getUser()`,
`callBot`, mismos códigos de error):

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callBot } from "@/lib/bot";

// Cancelar una cita (Juan, 2026-09-04). Cualquiera del equipo logueado puede
// hacerlo — a diferencia de vincular una línea, que es solo admin: cancelar
// una visita es trabajo diario del asesor que la tiene, no una decisión de
// riesgo.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { leadId, motivo } = await request.json().catch(() => ({}));
  if (!leadId) return NextResponse.json({ error: "Falta leadId" }, { status: 400 });

  const r = await callBot("/api/citas/cancelar", { leadId, motivo: motivo || null });
  return r.ok ? NextResponse.json(r.data) : NextResponse.json({ error: r.error }, { status: r.status });
}
```

- [ ] **Step 2: El botón**

En la página del calendario, para los eventos con `origen === "cita_cliente"`,
agregar un botón "Cancelar" que pida el motivo con `prompt()`, llame a la ruta
y refresque. Seguí el patrón de manejo de estado y mensajes que ya usa
`crm/components/vincular-linea.tsx` (estado `ocupado`, mensaje de resultado).

Al volver, mostrar de dónde salió el aviso: `aviso === "oficial"` → "Cancelada,
le avisamos"; `"linea_natalia"` → "Cancelada, le avisamos por la línea del
radar"; `"no_se_pudo"` → **"Cancelada, pero NO le pudimos avisar — escribile
vos"**, en rojo. Ese último caso es el que no puede pasar desapercibido.

- [ ] **Step 3: Verificar tipos y build**

Run: `cd crm && npx tsc --noEmit`
Expected: sin errores.

Run: `cd crm && npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add crm/app/api/citas/cancelar/route.ts "crm/app/(dashboard)/calendario/page.tsx"
git commit -m "feat(crm): boton para cancelar una cita desde el calendario"
```

---

### Task 7: Reprogramar desde el CRM

**Files:**
- Modify: `src/groups/cancelar-cita.js` (agregar `reprogramar`)
- Modify: `src/api/crm.js` (agregar la ruta)
- Test: `test/cancelar-cita.test.js`

**Interfaces:**
- Consumes: `citas.estadoDe` (Task 1), `appointments.checkAvailability`, y la
  cascada de aviso de la Task 3.
- Produces: `reprogramar(org, leadId, { nuevaFechaHora, motivo, sesion })` →
  `{ ok, resultado, aviso }` con `resultado` ∈
  `"reprogramada" | "no_encontrada" | "hora_ocupada" | "fecha_invalida"`.

**Modelo, porque no es obvio:** `leads.cita` es UN objeto, no una lista — no
hay "la vieja" y "la nueva". Reprogramar **cambia `fecha_hora` en el mismo
objeto**, pone `estado: "reprogramada"` y guarda la hora anterior en
`reprogramada_desde`. Así el calendario muestra la nueva y no se pierde de
dónde venía.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/cancelar-cita.test.js` (reusa el `instalar()` que ya está ahí;
agregarle un doble de `src/data/appointments.js` que devuelva
`{ disponible: true }` por defecto y `{ disponible: false, motivo: "ocupado" }`
cuando una bandera del test lo pida):

```js
test("reprogramar mueve la hora, deja la anterior y avisa al colega", async () => {
  const mod = instalar(CITA);
  const r = await mod.reprogramar(ORG, "lead-1", { nuevaFechaHora: "2026-09-11T10:00:00-05:00" });
  assert.strictEqual(r.resultado, "reprogramada");
  assert.strictEqual(leadGuardado.cita.estado, "reprogramada");
  assert.strictEqual(leadGuardado.cita.fecha_hora, "2026-09-11T10:00:00-05:00");
  assert.strictEqual(leadGuardado.cita.reprogramada_desde, CITA.fecha_hora);
  assert.strictEqual(enviosOficial.length, 1);
});

// La hora nueva pasa por la MISMA validacion que una cita puesta a mano: si el
// asesor ya tiene algo ahi, no se mueve nada y se lo dice a quien la mueve.
test("una hora ocupada no mueve la cita", async () => {
  horaOcupada = true;
  const mod = instalar(CITA);
  const r = await mod.reprogramar(ORG, "lead-1", { nuevaFechaHora: "2026-09-11T10:00:00-05:00" });
  assert.strictEqual(r.resultado, "hora_ocupada");
  assert.strictEqual(leadGuardado, null, "no se toca el registro");
  assert.strictEqual(enviosOficial.length, 0, "y no se le avisa nada al colega");
});

test("una fecha invalida se rechaza antes de tocar nada", async () => {
  const mod = instalar(CITA);
  const r = await mod.reprogramar(ORG, "lead-1", { nuevaFechaHora: "mañana por la tarde" });
  assert.strictEqual(r.resultado, "fecha_invalida");
  assert.strictEqual(leadGuardado, null);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/cancelar-cita.test.js`
Expected: FAIL — `mod.reprogramar is not a function`.

- [ ] **Step 3: Implementar**

En `src/groups/cancelar-cita.js`:

```js
// REPROGRAMAR (Juan, 2026-09-04). `leads.cita` es UN objeto, no una lista: no
// existe "la vieja" y "la nueva". Se mueve la hora en el mismo objeto y se
// guarda de donde venia en `reprogramada_desde` — asi el calendario muestra la
// nueva sin perder el rastro.
//
// La hora nueva pasa por la MISMA validacion que una cita puesta a mano
// (appointments.checkAvailability): mover una cita encima de otra del mismo
// asesor seria crear el problema que el anti-choque existe para evitar.
function textoReprogramada(cita, motivo) {
  const cuando = cita && cita.fecha_hora ? new Date(cita.fecha_hora).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : null;
  return [
    `Hola, te escribo para avisarte que la visita quedó reprogramada${cuando ? ` para el ${cuando}` : ""}.`,
    motivo ? `Motivo: ${motivo}.` : null,
    "Si no te sirve ese horario, decime y lo movemos.",
  ].filter(Boolean).join("\n\n");
}

async function reprogramar(org, leadId, { nuevaFechaHora, motivo = null, sesion = null } = {}) {
  if (!nuevaFechaHora || isNaN(new Date(nuevaFechaHora).getTime())) {
    return { ok: false, resultado: "fecha_invalida", aviso: null };
  }
  const lead = await leads.findById(leadId).catch(() => null);
  if (!lead || !lead.cita) return { ok: false, resultado: "no_encontrada", aviso: null };

  const advisorId = lead.cita.advisor_id || null;
  if (advisorId) {
    const dispo = await appointments
      .checkAvailability(org.id, { auth_user_id: advisorId }, nuevaFechaHora, { excludeLeadId: leadId })
      .catch(() => ({ disponible: true }));
    if (!dispo.disponible) return { ok: false, resultado: "hora_ocupada", aviso: null, motivo: dispo.motivo };
  }

  const cita = {
    ...lead.cita,
    fecha_hora: nuevaFechaHora,
    estado: "reprogramada",
    reprogramada_desde: lead.cita.fecha_hora || null,
    reprogramada_at: new Date().toISOString(),
  };
  await leads.update(leadId, { cita });

  const texto = textoReprogramada(cita, motivo);
  let aviso = "no_se_pudo";
  const oficial = await canalWhatsapp.sendWhatsApp(org, lead.phone, texto).catch((e) => ({ ok: false, error: e.message }));
  if (oficial && oficial.ok) aviso = "oficial";
  else if (sesion) {
    const porWaha = await waha.enviarDm(sesion, lead.phone, texto).catch((e) => ({ ok: false, error: e.message }));
    if (porWaha && porWaha.ok) aviso = "linea_natalia";
  }

  return { ok: true, resultado: "reprogramada", aviso };
}
```

Agregar arriba: `const appointments = require("../data/appointments");`
Y exportar: `module.exports = { cancelar, reprogramar, textoParaColega, textoReprogramada };`

- [ ] **Step 4: La ruta del bot**

En `src/api/crm.js`, junto a `/api/citas/cancelar`:

```js
router.post("/api/citas/reprogramar", async (req, res) => {
  const { leadId, nuevaFechaHora, motivo } = req.body || {};
  if (!leadId || !nuevaFechaHora) return res.status(400).json({ error: "Falta leadId o nuevaFechaHora" });
  try {
    const org = await organizations.getDefault();
    const sesiones = await whatsappGroups.listSessions(org.id).catch(() => []);
    const activa = sesiones.find((s) => s.estado === "activa") || (sesiones.length === 1 ? sesiones[0] : null);
    const r = await require("../groups/cancelar-cita").reprogramar(org, leadId, {
      nuevaFechaHora, motivo: motivo || null, sesion: activa ? activa.nombre : null,
    });
    if (r.resultado === "no_encontrada") return res.status(404).json({ error: "No se encontro esa cita" });
    if (r.resultado === "fecha_invalida") return res.status(400).json({ error: "Fecha u hora invalida" });
    if (r.resultado === "hora_ocupada") return res.status(409).json({ error: "El asesor ya tiene algo a esa hora" });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `node --test test/cancelar-cita.test.js`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/groups/cancelar-cita.js src/api/crm.js test/cancelar-cita.test.js
git commit -m "feat(citas): reprogramar valida la hora nueva y avisa al colega"
```

---

### Task 8: Cancelar la cita del 2026-09-04 y verificar en producción

**Files:** ninguno — es operación.

- [ ] **Step 1: Desplegar**

```bash
npm test
git push origin main
```

- [ ] **Step 2: Cancelar la cita real**

La visita del 2026-09-04 a las 16:00 (lead `9060e2e8-71b0-4c21-8987-abcbecb7c61e`,
colega Miguel Longas, ref 9702941) sigue en el calendario como si fuera a
ocurrir. Cancelarla **desde el botón del CRM**, no por SQL: es la primera
prueba real del camino completo.

Motivo: "la propiedad ya no está disponible".

- [ ] **Step 3: Verificar**

- La cita desaparece del calendario del equipo.
- El estado en la base es `cancelada` (consulta REST a `leads`).
- El resultado dice por dónde salió el aviso.

Si dice `no_se_pudo`, **es correcto**: la visita ya se canceló por otro medio y
la ventana pudo cerrarse. Lo que importa es que el registro quede limpio.

## Verificación final

Contra los criterios de aceptación del spec que cubre **esta tanda**:

| # | Criterio | Tarea |
|---|---|---|
| 3 | Una `propuesta` se ve distinta de una `confirmada` | Task 5 |
| 4 | Una `cancelada` no aparece en el calendario | Task 5 |
| 6 | Ventana cerrada → registro cancelado, aviso por Natalia, o alerta | Task 3 |
| 9 | Ningún mensaje al colega nombra a Diamond | Task 3 |

Los criterios **1, 2, 5, 7 y 8** son de la Tanda 2 (antelación mínima,
calificación, escalado, lectura de agenda) y no se tocan acá.

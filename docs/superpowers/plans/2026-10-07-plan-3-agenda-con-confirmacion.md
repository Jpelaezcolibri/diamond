# Plan 3 — Agenda con reglas y confirmación por rotación horaria

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Sofi solo proponga visitas con ≥ 24 h de anticipación y sin pisar la agenda (60 min de visita + 90 de traslado por asesor), que la cita llegue a un asesor de la rotación con la plantilla `cita_por_confirmar` (botones Confirmar / Otro horario), y que pase al siguiente asesor cada hora hasta que alguien confirme o llegue el corte (4 h antes).

**Architecture:** Reglas puras en `src/lib/agenda-reglas.js`; rotación en `src/data/rotacion-citas.js`; aviso por plantilla en `src/notifications/aviso-cita.js`; confirmación compartida (tool y botón) en `src/lib/confirmar-cita.js`; worker `src/scheduler/citas-escalera.js`. La cita guarda `asesor_id` (= `advisors.id`, porque Claudia no tiene usuario del CRM) además del `advisor_id` (auth) de siempre. Si ningún asesor tiene `recibe_citas`, todo sigue como hoy.

**Tech Stack:** Node.js (CommonJS), `node:test`, WhatsApp Cloud API (plantillas con quick replies).

Spec: `docs/superpowers/specs/2026-10-07-sofi-vendedora-y-agenda-design.md` §4. Plantillas aprobadas: `cita_por_confirmar` (botones *Confirmar* / *Otro horario*), `cita_no_confirmada`. Datos: Asesor 1 Daiana (auth), Asesor 2 Claudia (SIN auth), Asesor 3 Catherine (auth); 8024 respaldo de entrega de Asesor 1.

## Global Constraints

- Anticipación mínima `CITAS_ANTICIPACION_MIN_H=24`; bloqueo por cita `CITAS_DURACION_MIN=60` + `CITAS_TRASLADO_MIN=90` (dos inicios del mismo asesor a ≥ 150 min).
- Rotación cada `ESCALERA_PASO_MIN=60`; ciclo 1→2→3→1 hasta confirmar; pausa 20:00–08:00 (Bogotá); corte = inicio − 4 h → cancelar y ofrecer otro horario al cliente/colega.
- Cualquiera del ciclo puede confirmar; la cita queda de quien confirma; a los demás que la tuvieron se les avisa.
- "Otro horario" del asesor = la cita se cancela (`motivo: asesor_pidio_otro_horario`) y Sofi le ofrece otro horario al cliente/colega.
- Hacia afuera: alias, nunca nombre ni celular (Plan 1).
- Sin asesores con `recibe_citas=true` → flujo actual intacto.
- `npm test` en verde (baseline 2074).

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/lib/agenda-reglas.js` (nuevo) | validar hora, alternativas, silencio, corte |
| `src/data/rotacion-citas.js` (nuevo) | asesores del ciclo, citas de un asesor, elegir asesor, siguiente |
| `src/channels/whatsapp.js` (mod) | `sendWhatsAppTemplate` con payloads de botón; ruteo de botones `cita:` |
| `src/notifications/aviso-cita.js` (nuevo) | aviso por plantilla con respaldo de texto |
| `src/lib/confirmar-cita.js` (nuevo) | confirmar / pedir otro horario (tool y botón) |
| `src/agent/tools.js` (mod) | agendar_cita con reglas y rotación; texto sin celular; confirmar_cita usa el módulo |
| `src/scheduler/citas-escalera.js` (nuevo) + `src/server.js` (mod) | worker de rotación y corte |
| `src/data/leads.js` (mod) | `listCitasPropuestasEnRotacion`; el recordatorio viejo ignora citas con `asesor_id` |

---

### Task 0: agendar_cita deja de pasarle al colega el nombre y el celular

**Files:** Modify `src/agent/tools.js` (bloque `comoDecirlo`, ~778-787); Test `test/identidad-publica.test.js`

- [ ] **Step 1: test** (agregar)

```js
test("agendar_cita no le pasa a Sofi el celular de quien coordina", () => {
  assert.doesNotMatch(fuenteTools, /puede escribirle a \+\$\{coordinador\.phone\}/);
  assert.doesNotMatch(fuenteTools, /coordinador\?\.name \|\| "la asesora"/);
});
```

- [ ] **Step 2:** FAIL. **Step 3:** reemplazar en `comoDecirlo` (rama colega):

```js
    const comoDecirlo = ctx.colega
      ? `Decile al colega que la visita quedo SOLICITADA${cita.fecha_hora ? ` para ${cita.fecha_hora}` : ""} y que en breve ${
          aliasPublico(coordinador, ctx.org)
        } la confirma y le escribe. NO le des ningún número. Nunca digas "confirmada".`
      : /* rama cliente sin cambios */
```

con `const { aliasPublico } = require("../lib/identidad-publica");` agregado al import del encabezado (junto a `textoCitaConfirmada`).
- [ ] **Step 4:** `npm test` → 0 fail. **Step 5:** commit `fix(identidad): agendar_cita no le pasa al colega el celular de quien coordina`

---

### Task 1: Reglas de agenda (puras)

**Files:** Create `src/lib/agenda-reglas.js`; Test `test/agenda-reglas.test.js`

**Interfaces — Produces:**
- `BLOQUE_MIN` (150), `ANTICIPACION_MIN` (1440)
- `validarHora({ fechaHoraIso, ahora, horario, ocupadas }) -> { ok: true } | { ok: false, motivo: "anticipacion"|"fuera_de_horario"|"choque"|"fecha_invalida" }` — `ocupadas`: array de ISO de citas vivas del asesor.
- `alternativas({ ahora, horario, ocupadas, n = 3, pasoMin = 30 }) -> string[]` (ISO)
- `enSilencio(fecha) -> boolean` (20:00–08:00 Bogotá)
- `corteDe(fechaHoraIso) -> string` (ISO, inicio − 4 h)

- [ ] **Step 1: test**

```js
// test/agenda-reglas.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const r = require("../src/lib/agenda-reglas");

const AHORA = new Date("2026-10-07T15:00:00Z"); // martes 10:00 Bogotá
const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };

test("menos de 24 h de anticipación no se puede", () => {
  assert.deepStrictEqual(r.validarHora({ fechaHoraIso: "2026-10-08T14:00:00Z", ahora: AHORA, horario: H, ocupadas: [] }), { ok: false, motivo: "anticipacion" });
  assert.deepStrictEqual(r.validarHora({ fechaHoraIso: "2026-10-08T15:00:00Z", ahora: AHORA, horario: H, ocupadas: [] }), { ok: true });
});

test("fuera del horario del asesor no se puede", () => {
  // 19:00 Bogotá
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T00:00:00Z", ahora: AHORA, horario: H, ocupadas: [] }).motivo, "fuera_de_horario");
});

test("dos citas del mismo asesor tienen que estar a 150 min (60 de visita + 90 de traslado)", () => {
  const ocupadas = ["2026-10-09T14:00:00Z"]; // 9:00 Bogotá
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T16:00:00Z", ahora: AHORA, horario: H, ocupadas }).motivo, "choque"); // 11:00
  assert.deepStrictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T16:30:00Z", ahora: AHORA, horario: H, ocupadas }), { ok: true }); // 11:30
  assert.strictEqual(r.validarHora({ fechaHoraIso: "2026-10-09T12:00:00Z", ahora: AHORA, horario: H, ocupadas }).motivo, "choque"); // 7:00 antes: 120 min
});

test("alternativas: las primeras 3 horas válidas desde las 24 h, cada 30 min", () => {
  const alt = r.alternativas({ ahora: AHORA, horario: H, ocupadas: ["2026-10-08T15:00:00Z"] });
  assert.strictEqual(alt.length, 3);
  for (const iso of alt) assert.deepStrictEqual(r.validarHora({ fechaHoraIso: iso, ahora: AHORA, horario: H, ocupadas: ["2026-10-08T15:00:00Z"] }), { ok: true });
  assert.strictEqual(alt[0], "2026-10-08T17:30:00.000Z", "10:00 está ocupada; la primera libre es 12:30 Bogotá");
});

test("silencio de 20:00 a 08:00 en Bogotá", () => {
  assert.strictEqual(r.enSilencio(new Date("2026-10-08T01:30:00Z")), true); // 20:30
  assert.strictEqual(r.enSilencio(new Date("2026-10-08T12:59:00Z")), true); // 07:59
  assert.strictEqual(r.enSilencio(new Date("2026-10-08T13:00:00Z")), false); // 08:00
});

test("el corte es 4 h antes de la visita", () => {
  assert.strictEqual(r.corteDe("2026-10-09T20:00:00Z"), "2026-10-09T16:00:00.000Z");
});
```

- [ ] **Step 2:** FAIL. **Step 3: implement**

```js
// src/lib/agenda-reglas.js
// Reglas de agenda (Juan, 2026-10-07; spec §4.1): ninguna visita a menos de
// 24 h (es el colchon para que un asesor la confirme), dentro del horario del
// asesor, y cada cita bloquea 60 min de visita + 90 de traslado en la agenda
// de ESE asesor. Puras: sin base, para poder probarlas y reusarlas.
const { partesBogota, DEFAULT_HORARIO } = require("../data/appointments");

const ANTICIPACION_MIN = Number(process.env.CITAS_ANTICIPACION_MIN_H || 24) * 60;
const DURACION_MIN = Number(process.env.CITAS_DURACION_MIN || 60);
const TRASLADO_MIN = Number(process.env.CITAS_TRASLADO_MIN || 90);
const BLOQUE_MIN = DURACION_MIN + TRASLADO_MIN;
const MIN = 60 * 1000;

const aMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
};

function dentroDeHorario(horario, iso) {
  const h = horario || DEFAULT_HORARIO;
  const p = partesBogota(iso);
  if (!p) return false;
  const dias = Array.isArray(h.dias) ? h.dias : DEFAULT_HORARIO.dias;
  if (!dias.includes(p.dia)) return false;
  return p.minutos >= aMin(h.desde || DEFAULT_HORARIO.desde) && p.minutos + DURACION_MIN <= aMin(h.hasta || DEFAULT_HORARIO.hasta);
}

function validarHora({ fechaHoraIso, ahora = new Date(), horario = null, ocupadas = [] }) {
  const t = new Date(fechaHoraIso).getTime();
  if (isNaN(t)) return { ok: false, motivo: "fecha_invalida" };
  if (t - ahora.getTime() < ANTICIPACION_MIN * MIN) return { ok: false, motivo: "anticipacion" };
  if (!dentroDeHorario(horario, fechaHoraIso)) return { ok: false, motivo: "fuera_de_horario" };
  const choca = (ocupadas || []).some((o) => {
    const u = new Date(o).getTime();
    return !isNaN(u) && Math.abs(u - t) < BLOQUE_MIN * MIN;
  });
  return choca ? { ok: false, motivo: "choque" } : { ok: true };
}

function alternativas({ ahora = new Date(), horario = null, ocupadas = [], n = 3, pasoMin = 30, horizonteDias = 14 }) {
  const paso = pasoMin * MIN;
  let ms = Math.ceil((ahora.getTime() + ANTICIPACION_MIN * MIN) / paso) * paso;
  const limite = ahora.getTime() + horizonteDias * 24 * 60 * MIN;
  const out = [];
  while (ms <= limite && out.length < n) {
    const iso = new Date(ms).toISOString();
    if (validarHora({ fechaHoraIso: iso, ahora, horario, ocupadas }).ok) out.push(iso);
    ms += paso;
  }
  return out;
}

function enSilencio(fecha = new Date()) {
  const p = partesBogota(fecha.toISOString());
  return !p || p.minutos >= 20 * 60 || p.minutos < 8 * 60;
}

function corteDe(fechaHoraIso) {
  return new Date(new Date(fechaHoraIso).getTime() - 4 * 60 * MIN).toISOString();
}

module.exports = { ANTICIPACION_MIN, DURACION_MIN, TRASLADO_MIN, BLOQUE_MIN, validarHora, alternativas, enSilencio, corteDe, dentroDeHorario };
```

(`partesBogota` y `DEFAULT_HORARIO` ya los exporta `src/data/appointments.js`; verificar el `module.exports` y agregarlos si faltan.)
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(agenda): reglas de 24 h y 150 min por asesor`

---

### Task 2: Rotación de citas (datos)

**Files:** Create `src/data/rotacion-citas.js`; Test `test/rotacion-citas.test.js`

**Interfaces — Produces:**
- `asesoresDelCiclo(orgId) -> advisor[]` (activos con `recibe_citas`, por `orden_citas`)
- `ocupadasDe(citasOrg, advisor, { excluirLeadId }) -> string[]` — citas vivas cuyo `cita.asesor_id === advisor.id` o (`advisor.auth_user_id` y `cita.advisor_id === advisor.auth_user_id`)
- `elegirAsesor({ ciclo, citasOrg, fechaHoraIso, ahora, excluirLeadId }) -> advisor|null` — entre los que tienen la hora libre, el de menos citas vivas a futuro; empate por `orden_citas`
- `siguiente({ ciclo, actualId, citasOrg, fechaHoraIso, ahora, excluirLeadId }) -> advisor|null` — el próximo en orden circular después de `actualId` con la hora libre (si nadie más la tiene libre, vuelve al actual)

- [ ] **Step 1: test**

```js
// test/rotacion-citas.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const rot = require("../src/data/rotacion-citas");

const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", name: "Daiana", auth_user_id: "u1", orden_citas: 1, horario: H };
const A2 = { id: "a2", name: "Claudia", auth_user_id: null, orden_citas: 2, horario: H };
const A3 = { id: "a3", name: "Catherine", auth_user_id: "u3", orden_citas: 3, horario: H };
const CICLO = [A1, A2, A3];
const AHORA = new Date("2026-10-07T15:00:00Z");
const VISITA = "2026-10-09T16:00:00Z";

test("ocupadas reconoce la cita por asesor_id y, en las viejas, por el auth del CRM", () => {
  const citas = [
    { id: "l1", cita: { asesor_id: "a2", fecha_hora: "2026-10-09T14:00:00Z", estado: "propuesta" } },
    { id: "l2", cita: { advisor_id: "u1", fecha_hora: "2026-10-09T18:00:00Z", estado: "confirmada" } },
    { id: "l3", cita: { asesor_id: "a2", fecha_hora: "2026-10-09T20:00:00Z", estado: "cancelada" } },
  ];
  assert.deepStrictEqual(rot.ocupadasDe(citas, A2, {}), ["2026-10-09T14:00:00Z"]);
  assert.deepStrictEqual(rot.ocupadasDe(citas, A1, {}), ["2026-10-09T18:00:00Z"]);
});

test("elegirAsesor: el que tiene la hora libre y menos citas", () => {
  const citas = [{ id: "l1", cita: { asesor_id: "a1", fecha_hora: "2026-10-10T14:00:00Z", estado: "confirmada" } }];
  assert.strictEqual(rot.elegirAsesor({ ciclo: CICLO, citasOrg: citas, fechaHoraIso: VISITA, ahora: AHORA }).id, "a2");
});

test("elegirAsesor: salta al que tiene la hora ocupada", () => {
  const citas = [
    { id: "l1", cita: { asesor_id: "a2", fecha_hora: VISITA, estado: "propuesta" } },
  ];
  assert.strictEqual(rot.elegirAsesor({ ciclo: CICLO, citasOrg: citas, fechaHoraIso: VISITA, ahora: AHORA }).id, "a1");
});

test("siguiente: circular 1→2→3→1 saltando al que tiene la hora ocupada", () => {
  assert.strictEqual(rot.siguiente({ ciclo: CICLO, actualId: "a1", citasOrg: [], fechaHoraIso: VISITA, ahora: AHORA }).id, "a2");
  assert.strictEqual(rot.siguiente({ ciclo: CICLO, actualId: "a3", citasOrg: [], fechaHoraIso: VISITA, ahora: AHORA }).id, "a1");
  const ocupaA2 = [{ id: "x", cita: { asesor_id: "a2", fecha_hora: VISITA, estado: "confirmada" } }];
  assert.strictEqual(rot.siguiente({ ciclo: CICLO, actualId: "a1", citasOrg: ocupaA2, fechaHoraIso: VISITA, ahora: AHORA }).id, "a3");
});

test("siguiente: con un solo asesor posible, se queda en el actual", () => {
  assert.strictEqual(rot.siguiente({ ciclo: [A1], actualId: "a1", citasOrg: [], fechaHoraIso: VISITA, ahora: AHORA }).id, "a1");
});
```

- [ ] **Step 2:** FAIL. **Step 3: implement**

```js
// src/data/rotacion-citas.js
// Rotacion de citas por confirmar (Juan, 2026-10-07; spec §4.2-4.3): las
// citas van a los asesores con recibe_citas, en orden (Asesor 1, 2, 3), y si
// uno no confirma en una hora pasa al siguiente. La cita se ata al asesor por
// advisors.id (cita.asesor_id): Claudia no tiene usuario del CRM, asi que el
// auth_user_id (cita.advisor_id) no alcanza. Las citas viejas solo tienen el
// auth; ocupadasDe reconoce las dos.
const supabase = require("./supabase");
const memory = require("./memory");
const citasData = require("./citas");
const { validarHora } = require("../lib/agenda-reglas");

async function asesoresDelCiclo(orgId) {
  if (!supabase) {
    return memory.advisors
      .filter((a) => a.org_id === orgId && a.activo && a.recibe_citas)
      .sort((a, b) => (a.orden_citas || 99) - (b.orden_citas || 99));
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("activo", true)
    .eq("recibe_citas", true)
    .order("orden_citas", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

function esDe(cita, advisor) {
  if (!cita || !advisor) return false;
  if (cita.asesor_id) return cita.asesor_id === advisor.id;
  return Boolean(advisor.auth_user_id) && cita.advisor_id === advisor.auth_user_id;
}

function ocupadasDe(citasOrg, advisor, { excluirLeadId = null } = {}) {
  return (citasOrg || [])
    .filter((l) => l.id !== excluirLeadId && l.cita && l.cita.fecha_hora && citasData.estaViva(l.cita) && esDe(l.cita, advisor))
    .map((l) => l.cita.fecha_hora);
}

function libre(advisor, { citasOrg, fechaHoraIso, ahora, excluirLeadId }) {
  return validarHora({ fechaHoraIso, ahora, horario: advisor.horario, ocupadas: ocupadasDe(citasOrg, advisor, { excluirLeadId }) }).ok;
}

function elegirAsesor({ ciclo, citasOrg, fechaHoraIso, ahora = new Date(), excluirLeadId = null }) {
  const futuras = (a) => ocupadasDe(citasOrg, a, { excluirLeadId }).filter((f) => new Date(f).getTime() > ahora.getTime()).length;
  const candidatos = (ciclo || []).filter((a) => libre(a, { citasOrg, fechaHoraIso, ahora, excluirLeadId }));
  if (candidatos.length === 0) return null;
  return candidatos.slice().sort((a, b) => futuras(a) - futuras(b) || (a.orden_citas || 99) - (b.orden_citas || 99))[0];
}

function siguiente({ ciclo, actualId, citasOrg, fechaHoraIso, ahora = new Date(), excluirLeadId = null }) {
  const lista = ciclo || [];
  if (lista.length === 0) return null;
  const i = lista.findIndex((a) => a.id === actualId);
  for (let paso = 1; paso <= lista.length; paso++) {
    const a = lista[(Math.max(i, 0) + paso) % lista.length];
    if (a.id === actualId) return a;
    if (libre(a, { citasOrg, fechaHoraIso, ahora, excluirLeadId })) return a;
  }
  return lista.find((a) => a.id === actualId) || null;
}

module.exports = { asesoresDelCiclo, ocupadasDe, elegirAsesor, siguiente, esDe };
```

Nota: `libre` usa `validarHora`, que exige 24 h desde `ahora`. En la rotación (`siguiente`, llamada horas después), la visita puede estar a menos de 24 h: pasar `ahora` como el `creada_at` de la cita al llamarlo desde el worker (Task 6), para que solo cuenten horario y choque. `memory.advisors` existe en `src/data/memory.js` (lo usa `advisors.js`).
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(agenda): rotación de asesores para las citas`

---

### Task 3: Plantilla con botones y ruteo del botón `cita:`

**Files:** Modify `src/channels/whatsapp.js`; Test `test/boton-cita.test.js`

**Interfaces — Produces:**
- `sendWhatsAppTemplate(org, to, { name, language, bodyParams, buttonPayloads = [], fromPhoneId })`
- `botonDeMensaje(message) -> string|null` — id/payload de `interactive.button_reply` **o** de `type: "button"` (respuesta a plantilla: `message.button.payload`)
- En el webhook: si el id empieza con `cita:` → `require("../lib/confirmar-cita").procesarBotonCita(org, userPhone, id)`; si no, `procesarBotonRadar` como hoy.

- [ ] **Step 1: test**

```js
// test/boton-cita.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const wa = require("../src/channels/whatsapp");

test("botonDeMensaje lee el botón interactivo y el de plantilla", () => {
  assert.strictEqual(wa.botonDeMensaje({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "radar_si:s1" } } }), "radar_si:s1");
  assert.strictEqual(wa.botonDeMensaje({ type: "button", button: { payload: "cita:l1:confirmar", text: "Confirmar" } }), "cita:l1:confirmar");
  assert.strictEqual(wa.botonDeMensaje({ type: "text", text: { body: "hola" } }), null);
});

test("el webhook manda los botones cita: a confirmar-cita", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "channels", "whatsapp.js"), "utf8");
  assert.match(fuente, /startsWith\("cita:"\)/);
  assert.match(fuente, /procesarBotonCita\(/);
});

test("sendWhatsAppTemplate arma los quick replies con su payload", async (t) => {
  let cuerpo = null;
  t.mock.method(global, "fetch", async (_url, opts) => {
    cuerpo = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ messages: [{ id: "wamid.1" }] }) };
  });
  await wa.sendWhatsAppTemplate({ whatsapp_token: "t", whatsapp_phone_id: "p" }, "573001112233", {
    name: "cita_por_confirmar", bodyParams: ["1", "2", "3", "4"], buttonPayloads: ["cita:l1:confirmar", "cita:l1:otro"],
  });
  const botones = cuerpo.template.components.filter((c) => c.type === "button");
  assert.deepStrictEqual(botones, [
    { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "cita:l1:confirmar" }] },
    { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "cita:l1:otro" }] },
  ]);
});
```

(Si `graphSendMessage` usa otro mecanismo que `fetch` global, mockear ese; leerlo antes de escribir el test.)

- [ ] **Step 2:** FAIL. **Step 3: implement** — en `sendWhatsAppTemplate`:

```js
async function sendWhatsAppTemplate(org, to, { name, language = "es", bodyParams = [], buttonPayloads = [], fromPhoneId } = {}) {
  // ... igual hasta armar `body`
  const components = [];
  if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: String(t) })) });
  // Quick replies (2026-10-07): el payload vuelve en el webhook como
  // message.button.payload; asi el toque dice que cita y que accion es.
  buttonPayloads.forEach((payload, i) =>
    components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }] })
  );
  const body = { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: language }, ...(components.length ? { components } : {}) } };
  return graphSendMessage(phoneId, token, body, `plantilla ${name}`);
}

function botonDeMensaje(message) {
  if (!message) return null;
  if (message.type === "interactive" && message.interactive?.type === "button_reply") return message.interactive.button_reply?.id || null;
  if (message.type === "button") return message.button?.payload || null;
  return null;
}
```

En el webhook, reemplazar el cálculo de `botonId` por `const botonId = botonDeMensaje(message);` y:

```js
      if (botonId) {
        if (String(botonId).startsWith("cita:")) {
          // Require tardio (ciclo whatsapp -> engine -> tools -> confirmar-cita -> whatsapp).
          await require("../lib/confirmar-cita").procesarBotonCita(org, userPhone, botonId);
        } else {
          await procesarBotonRadar(org, userPhone, botonId, message.interactive?.button_reply?.title, phoneNumberId);
        }
        return;
      }
```

Exportar `botonDeMensaje`. (Task 5 crea `confirmar-cita.js`; hasta entonces el test de ruteo solo lee la fuente.)
- [ ] **Step 4:** `npm test` → 0 fail. **Step 5:** commit `feat(whatsapp): plantillas con quick replies y ruteo de botones de cita`

---

### Task 4: Aviso de cita por plantilla

**Files:** Create `src/notifications/aviso-cita.js`; Test `test/aviso-cita.test.js`

**Interfaces — Produces:** `avisarCitaPorConfirmar({ org, advisor, lead, cita, deps? }) -> { ok, via: "plantilla"|"texto", error? }`
- Parámetros de la plantilla: `[ref || "sin ref", cuando, quien, corte]` con `formatCitaFechaHora`; `quien` = `lead.nombre || "+" + lead.phone` más " (colega)" si `lead.source === "colega"`.
- Payloads: `cita:<lead.id>:confirmar`, `cita:<lead.id>:otro`.
- Si la plantilla falla → `entregarConRespaldo(org, advisor, texto)` con el texto de siempre + "Respondé *OK CONFIRMADA*".

- [ ] **Step 1: test** (inyectando `deps = { plantilla, respaldo }`)

```js
// test/aviso-cita.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { avisarCitaPorConfirmar } = require("../src/notifications/aviso-cita");

const ORG = { id: "org-1", name: "Diamond" };
const ADV = { id: "a2", name: "Claudia Valencia", phone: "573000008113" };
const LEAD = { id: "l1", nombre: "Laura", phone: "573125550000", source: "colega" };
const CITA = { fecha_hora: "2026-10-09T20:00:00Z", ref: "10012722", corte_at: "2026-10-09T16:00:00Z" };

test("sale por plantilla con los dos botones de esa cita", async () => {
  const llamadas = [];
  const r = await avisarCitaPorConfirmar({ org: ORG, advisor: ADV, lead: LEAD, cita: CITA, deps: {
    plantilla: async (...a) => { llamadas.push(a); return { ok: true }; },
    respaldo: async () => { throw new Error("no debía usarse"); },
  } });
  assert.deepStrictEqual(r, { ok: true, via: "plantilla" });
  const [, to, opts] = llamadas[0];
  assert.strictEqual(to, "573000008113");
  assert.strictEqual(opts.name, "cita_por_confirmar");
  assert.strictEqual(opts.bodyParams[0], "10012722");
  assert.match(opts.bodyParams[2], /Laura \(colega\)/);
  assert.deepStrictEqual(opts.buttonPayloads, ["cita:l1:confirmar", "cita:l1:otro"]);
});

test("si la plantilla falla, cae al texto con respaldo", async () => {
  const r = await avisarCitaPorConfirmar({ org: ORG, advisor: ADV, lead: LEAD, cita: CITA, deps: {
    plantilla: async () => ({ ok: false, error: "template not approved" }),
    respaldo: async (_org, _adv, texto) => { assert.match(texto, /OK CONFIRMADA/); return { ok: true }; },
  } });
  assert.deepStrictEqual(r, { ok: true, via: "texto" });
});
```

- [ ] **Step 2:** FAIL. **Step 3: implement**

```js
// src/notifications/aviso-cita.js
// Aviso de cita por confirmar (spec 2026-10-07 §4.4): plantilla de Meta con
// botones Confirmar / Otro horario, que llega aunque la ventana de 24 h este
// cerrada. Si la plantilla falla (no aprobada, error de Meta), cae al texto de
// siempre con respaldo (entregarConRespaldo: el 8024 para Asesor 1).
const { formatCitaFechaHora } = require("./advisor");

function cuando(iso) {
  const fh = formatCitaFechaHora(iso);
  return fh ? `${fh.fecha}, ${fh.hora}` : "por definir";
}

async function avisarCitaPorConfirmar({ org, advisor, lead, cita, deps = {} }) {
  const plantilla = deps.plantilla || ((...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a));
  const respaldo = deps.respaldo || ((...a) => require("../lib/entrega-asesor").entregarConRespaldo(...a));
  const tel = String(advisor && advisor.phone || "").replace(/\D/g, "");
  const quien = `${lead.nombre || `+${lead.phone}`}${lead.source === "colega" ? " (colega)" : ""}`;
  const params = [cita.ref || "sin ref", cuando(cita.fecha_hora), quien, cuando(cita.corte_at)];

  const r = await plantilla(org, tel, {
    name: "cita_por_confirmar",
    bodyParams: params,
    buttonPayloads: [`cita:${lead.id}:confirmar`, `cita:${lead.id}:otro`],
  }).catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok) return { ok: true, via: "plantilla" };

  console.warn(`[aviso-cita] Plantilla no salio a ${advisor && advisor.name}: ${r && r.error}. Va por texto.`);
  const texto = [
    `📅 Nueva visita por confirmar`,
    `Propiedad: ref ${params[0]}`,
    `Fecha y hora: ${params[1]}`,
    `Solicitada por: ${params[2]}`,
    `Si no se confirma antes de ${params[3]}, se cancela.`,
    ``,
    `Respondé *OK CONFIRMADA* para confirmarla.`,
  ].join("\n");
  const t = await respaldo(org, advisor, texto).catch((e) => ({ ok: false, error: e.message }));
  return t && t.ok ? { ok: true, via: "texto" } : { ok: false, via: "texto", error: t && t.error };
}

module.exports = { avisarCitaPorConfirmar };
```

- [ ] **Step 4:** PASS. **Step 5:** commit `feat(agenda): aviso de cita por plantilla con botones y respaldo de texto`

---

### Task 5: Confirmar / otro horario (tool y botón)

**Files:** Create `src/lib/confirmar-cita.js`; Modify `src/agent/tools.js` (handler `confirmar_cita`), `src/data/appointments.js` (`citasPendientesDeConfirmar` acepta asesor); Test `test/confirmar-cita-boton.test.js`

**Interfaces — Produces:**
- `confirmar({ org, lead, advisor, deps? }) -> { ok, texto }` — estado `confirmada`, `confirmada_por` (nombre real, interno), `asesor_id = advisor.id`, `advisor_id = advisor.auth_user_id || cita.advisor_id`; avisa al cliente/colega con `textoCitaConfirmada` por la línea oficial (respeta `solo_llamada` como hoy); avisa por texto a los otros asesores del `historial` "La visita de X ya la confirmó Asesor N".
- `pedirOtroHorario({ org, lead, advisor, deps? })` — `estado: "cancelada"`, `motivo: "asesor_pidio_otro_horario"`; al cliente/colega: plantilla `cita_no_confirmada` (o texto si la ventana está abierta).
- `procesarBotonCita(org, userPhone, botonId)` — `cita:<leadId>:confirmar|otro`; el asesor se resuelve con `advisors.findByPhone` y debe estar **activo** (Natalia inactiva comparte el 8024); si el que toca es el respaldo (`Daiana Zea (línea 2)`, alias igual al de un asesor del ciclo), se resuelve al asesor del ciclo con el mismo `alias_publico`; si la cita ya no está `propuesta`, le contesta "esa visita ya estaba {estado}".

- [ ] **Step 1: test** (memoria + mocks del canal)

```js
// test/confirmar-cita-boton.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const cc = require("../src/lib/confirmar-cita");

const ORG = { id: "org-1", name: "Diamond" };
const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, auth_user_id: "u1" };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, auth_user_id: null };
const RESPALDO = { id: "a1b", org_id: "org-1", name: "Daiana Zea (línea 2)", phone: "573001878024", alias_publico: "Asesor 1", activo: true, recibe_citas: false };
const NATALIA = { id: "n", org_id: "org-1", name: "Natalia Velez", phone: "573001878024", activo: false };

let enviados;
const deps = () => ({
  texto: async (_o, to, t) => { enviados.push({ to, t }); return { ok: true }; },
  plantilla: async (_o, to, opts) => { enviados.push({ to, plantilla: opts.name }); return { ok: true }; },
  soloLlamada: async () => false,
});

beforeEach(() => {
  enviados = [];
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push(A1, A2, RESPALDO, NATALIA);
  memory.leads.push({ id: "l1", org_id: "org-1", nombre: "Laura", phone: "573125550000", source: "colega",
    cita: { estado: "propuesta", fecha_hora: "2026-10-09T20:00:00Z", ref: "10012722", asesor_id: "a2", advisor_id: null,
      historial: [{ asesor_id: "a1", desde: "x", hasta: "y" }, { asesor_id: "a2", desde: "y" }] } });
});

test("confirmar: queda de quien confirma, el colega recibe el alias y el anterior se entera", async () => {
  const r = await cc.confirmar({ org: ORG, lead: memory.leads[0], advisor: A1, deps: deps() });
  assert.strictEqual(r.ok, true);
  const c = memory.leads[0].cita;
  assert.strictEqual(c.estado, "confirmada");
  assert.strictEqual(c.asesor_id, "a1");
  assert.strictEqual(c.advisor_id, "u1");
  const alColega = enviados.find((e) => e.to === "573125550000");
  assert.match(alColega.t, /Te recibe Asesor 1\./);
  assert.doesNotMatch(alColega.t, /Daiana|573011880668/);
  assert.ok(enviados.find((e) => e.to === "573000008113" && /ya la confirmó Asesor 1/.test(e.t)), "Claudia se entera");
});

test("botón desde el 8024: se resuelve a Asesor 1 activo, no a Natalia", async () => {
  await cc.procesarBotonCita(ORG, "573001878024", "cita:l1:confirmar", { deps: deps() });
  assert.strictEqual(memory.leads[0].cita.asesor_id, "a1");
  assert.strictEqual(memory.leads[0].cita.confirmada_por, "Daiana Zea");
});

test("otro horario: se cancela y al colega le sale la plantilla cita_no_confirmada", async () => {
  await cc.procesarBotonCita(ORG, "573000008113", "cita:l1:otro", { deps: deps() });
  assert.strictEqual(memory.leads[0].cita.estado, "cancelada");
  assert.strictEqual(memory.leads[0].cita.motivo, "asesor_pidio_otro_horario");
  assert.ok(enviados.find((e) => e.to === "573125550000" && e.plantilla === "cita_no_confirmada"));
});

test("una cita que ya no está propuesta no se vuelve a confirmar", async () => {
  memory.leads[0].cita.estado = "confirmada";
  await cc.procesarBotonCita(ORG, "573000008113", "cita:l1:confirmar", { deps: deps() });
  assert.ok(enviados.find((e) => e.to === "573000008113" && /ya estaba confirmada/.test(e.t)));
});
```

- [ ] **Step 2:** FAIL. **Step 3: implement**

```js
// src/lib/confirmar-cita.js
// Confirmar u "otro horario" para una cita propuesta (spec 2026-10-07 §4.4-4.5).
// Lo usan el boton de la plantilla cita_por_confirmar y la tool confirmar_cita
// ("OK CONFIRMADA" escrito). La cita queda de quien confirma, aunque ya haya
// rotado: cualquiera del ciclo puede confirmar.
const leads = require("../data/leads");
const advisors = require("../data/advisors");
const colegas = require("../data/colegas");
const { formatCitaFechaHora } = require("../notifications/advisor");
const { textoCitaConfirmada, aliasPublico } = require("./identidad-publica");

function canal(deps) {
  return {
    texto: deps.texto || ((...a) => require("../channels/whatsapp").sendWhatsApp(...a)),
    plantilla: deps.plantilla || ((...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a)),
    soloLlamada: deps.soloLlamada || ((orgId, tel) => colegas.esSoloLlamada(orgId, { telefono: tel })),
  };
}

function cuandoDe(cita) {
  const fh = formatCitaFechaHora(cita.fecha_hora);
  return fh ? `del ${fh.fecha} a las ${fh.hora}` : cita.descripcion || "acordada";
}

async function confirmar({ org, lead, advisor, deps = {} }) {
  const c = canal(deps);
  const cita = {
    ...lead.cita,
    estado: "confirmada",
    confirmada_at: new Date().toISOString(),
    confirmada_por: advisor.name,
    asesor_id: advisor.id,
    advisor_id: advisor.auth_user_id || lead.cita.advisor_id || null,
  };
  await leads.update(lead.id, { cita });
  lead.cita = cita;

  const quien = lead.nombre || `+${lead.phone}`;
  const solo = lead.source === "colega" ? await c.soloLlamada(org.id, lead.phone).catch(() => null) : false;
  let alCliente = "no_se_aviso";
  if (solo === false) {
    const r = await c.texto(org, lead.phone, textoCitaConfirmada({ cuando: cuandoDe(cita), ref: cita.ref, advisor, org })).catch((e) => ({ ok: false, error: e.message }));
    alCliente = r && r.ok ? "avisado" : "ventana_cerrada";
  }

  // Los que la tuvieron antes en la rotacion se enteran (texto interno).
  const otros = [...new Set((cita.historial || []).map((h) => h.asesor_id))].filter((id) => id && id !== advisor.id);
  for (const id of otros) {
    const a = await advisors.findById(org.id, id).catch(() => null);
    if (a && a.phone) {
      await c.texto(org, a.phone, `La visita de ${quien} ${cuandoDe(cita)} ya la confirmó ${aliasPublico(advisor, org)}. No hace falta que hagas nada.`).catch(() => {});
    }
  }
  const texto =
    solo !== false
      ? `Confirmada la cita con ${quien} para ${cuandoDe(cita)} — pidió contacto solo por llamada: avisale vos por llamada.`
      : alCliente === "avisado"
        ? `Confirmada la cita con ${quien} para ${cuandoDe(cita)}. Ya le avisé por WhatsApp.`
        : `Confirmada en el sistema la cita con ${quien} para ${cuandoDe(cita)}, pero no le pude avisar por acá (probablemente la ventana de 24h está cerrada) — avisale vos.`;
  return { ok: true, texto };
}

async function pedirOtroHorario({ org, lead, advisor, deps = {} }) {
  const c = canal(deps);
  const cita = { ...lead.cita, estado: "cancelada", cancelada_at: new Date().toISOString(), motivo: "asesor_pidio_otro_horario", cancelada_por: advisor.name };
  await leads.update(lead.id, { cita });
  lead.cita = cita;
  const fh = formatCitaFechaHora(cita.fecha_hora);
  const r = await c.plantilla(org, lead.phone, {
    name: "cita_no_confirmada",
    bodyParams: [lead.nombre || "", fh ? `${fh.fecha} a las ${fh.hora}` : "acordada", cita.ref || "sin ref"],
  }).catch((e) => ({ ok: false, error: e.message }));
  return { ok: true, texto: r && r.ok ? "Listo: le ofrecí otro horario." : "Quedó cancelada, pero no le pude escribir: avisale vos." };
}

async function asesorDelBoton(org, userPhone) {
  const fila = await advisors.findByPhone(org.id, userPhone).catch(() => null);
  if (!fila || !fila.activo) return null;
  if (fila.recibe_citas) return fila;
  // El respaldo (ej. "Daiana Zea (línea 2)") actua como el asesor del ciclo con el mismo alias.
  if (fila.alias_publico) {
    const ciclo = await require("../data/rotacion-citas").asesoresDelCiclo(org.id).catch(() => []);
    return ciclo.find((a) => a.alias_publico === fila.alias_publico) || fila;
  }
  return fila;
}

async function procesarBotonCita(org, userPhone, botonId, { deps = {} } = {}) {
  const [, leadId, accion] = String(botonId).split(":");
  const c = canal(deps);
  const advisor = await asesorDelBoton(org, userPhone);
  if (!advisor) {
    console.warn(`[confirmar-cita] Boton de cita desde un numero que no es asesor activo: ${userPhone}`);
    return;
  }
  const lead = await leads.findById(org.id, leadId).catch(() => null);
  if (!lead || !lead.cita) return;
  const estado = (lead.cita.estado || "confirmada");
  if (estado !== "propuesta") {
    await c.texto(org, userPhone, `Esa visita ya estaba ${estado}. No hace falta hacer nada.`).catch(() => {});
    return;
  }
  const r = accion === "otro" ? await pedirOtroHorario({ org, lead, advisor, deps }) : await confirmar({ org, lead, advisor, deps });
  await c.texto(org, userPhone, r.texto).catch(() => {});
}

module.exports = { confirmar, pedirOtroHorario, procesarBotonCita };
```

(Verificar que `advisors.findById(orgId, id)` existe con esa firma — está exportada en `src/data/advisors.js`.)

En `tools.js`, handler `confirmar_cita`: reemplazar desde `const lead = pendientes[0];` hasta el `return` final del handler por:

```js
    const lead = pendientes[0];
    const r = await require("../lib/confirmar-cita").confirmar({ org: ctx.org, lead, advisor: ctx.advisor }).catch((e) => {
      console.warn("[tools] No se pudo confirmar la cita:", e.message);
      return null;
    });
    return r ? r.texto : "No pude confirmar la cita en el sistema ahorita, intentá de nuevo.";
```

Y `citasPendientesDeConfirmar(orgId, advisorId)` pasa a recibir el advisor completo cuando se lo llama desde la tool: `citasPendientesDeConfirmar(ctx.org.id, ctx.advisor)`; dentro, filtrar con `rotacion.esDe(l.cita, advisor)` **o** que el advisor esté en `cita.historial` (cualquiera del ciclo puede confirmar). Mantener compatibilidad: si recibe un string, comparar `cita.advisor_id` como hoy.

- [ ] **Step 4:** `npm test` → 0 fail (actualizar `test/confirmar-cita.test.js` si fijaba `advisor_id` en vez de `asesor_id`). **Step 5:** commit `feat(agenda): confirmar u otro horario desde el botón o con OK CONFIRMADA`

---

### Task 6: agendar_cita con reglas y rotación

**Files:** Modify `src/agent/tools.js` (handler `agendar_cita`), `src/channels/whatsapp.js` (entrega de `appointmentAlert`); Test `test/agendar-cita-rotacion.test.js`

- [ ] **Step 1: test**

```js
// test/agendar-cita-rotacion.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const memory = require("../src/data/memory");
const { executeTool } = require("../src/agent/tools");

const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", org_id: "org-1", name: "Daiana Zea", phone: "573011880668", alias_publico: "Asesor 1", activo: true, recibe_citas: true, orden_citas: 1, auth_user_id: "u1", horario: H, especialidad: "venta" };
const A2 = { id: "a2", org_id: "org-1", name: "Claudia Valencia", phone: "573000008113", alias_publico: "Asesor 2", activo: true, recibe_citas: true, orden_citas: 2, auth_user_id: null, horario: H, especialidad: "venta" };
const ctx = () => ({ org: { id: "org-1", name: "Diamond" }, lead: { id: "l1", org_id: "org-1", phone: "573125550000", nombre: "Laura", source: "colega" }, colega: { nombre: "Laura", telefono: "573125550000" } });
const enHoras = (h) => new Date(Date.now() + h * 3600 * 1000);
const aLas = (d, hBogota) => { const x = new Date(d); x.setUTCHours(hBogota + 5, 0, 0, 0); return x.toISOString(); };

beforeEach(() => {
  memory.leads.length = 0;
  memory.advisors.length = 0;
  memory.advisors.push(A1, A2);
  memory.leads.push({ ...ctx().lead });
});

test("a menos de 24 h no se agenda y Sofi recibe 3 horarios válidos", async () => {
  const out = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: enHoras(5).toISOString(), ref: "10012722" }, ctx());
  assert.match(out, /No se pudo agendar: necesitamos al menos 24 horas/);
  assert.strictEqual((out.match(/^- /gm) || []).length, 3);
});

test("con 24 h y hora libre: queda propuesta, de un asesor del ciclo, con corte y historial", async () => {
  const c = ctx();
  const iso = aLas(enHoras(48), 10);
  const out = await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: iso, ref: "10012722" }, c);
  const cita = c.lead.cita;
  assert.strictEqual(cita.estado, "propuesta");
  assert.ok(["a1", "a2"].includes(cita.asesor_id));
  assert.strictEqual(cita.corte_at, new Date(new Date(iso).getTime() - 4 * 3600 * 1000).toISOString());
  assert.strictEqual(cita.historial.length, 1);
  assert.strictEqual(c.appointmentAlert.porPlantilla, true);
  assert.match(out, /SOLICITADA/);
  assert.doesNotMatch(out, /573011880668|573000008113|Daiana|Claudia/);
});

test("sin asesores en el ciclo, agendar_cita se comporta como antes", async () => {
  memory.advisors.forEach((a) => (a.recibe_citas = false));
  const c = ctx();
  await executeTool("agendar_cita", { descripcion: "visita", tipo: "visita", fecha_hora_iso: enHoras(5).toISOString() }, c);
  assert.strictEqual(c.lead.cita.estado, "propuesta");
  assert.strictEqual(c.lead.cita.asesor_id, undefined);
});
```

(Si `findAsesorPrincipalRadar` u otras dependencias del camino viejo necesitan mocks en modo memoria, copiarlos de `test/agendar-cita.test.js`.)

- [ ] **Step 2:** FAIL. **Step 3: implement** — al inicio del handler, después del chequeo de `proximo_disponible` y de armar `cita`:

```js
    // ROTACION (Juan, 2026-10-07; spec §4): si hay asesores con recibe_citas,
    // la cita respeta 24 h de anticipacion y 60+90 min por asesor, va al
    // asesor del ciclo con la hora libre y menos citas, y la escalera
    // (citas-escalera.js) la rota cada hora hasta que alguien confirme.
    const rotacion = require("../data/rotacion-citas");
    const reglas = require("../lib/agenda-reglas");
    const ciclo = await rotacion.asesoresDelCiclo(ctx.org.id).catch(() => []);
    if (ciclo.length > 0 && cita.fecha_hora) {
      const ahora = new Date();
      const citasOrg = await appointments.citasDeLaOrg(ctx.org.id).catch(() => []);
      const elegido = rotacion.elegirAsesor({ ciclo, citasOrg, fechaHoraIso: cita.fecha_hora, ahora, excluirLeadId: ctx.lead.id });
      if (!elegido) {
        const v = reglas.validarHora({ fechaHoraIso: cita.fecha_hora, ahora, horario: ciclo[0].horario, ocupadas: [] });
        const motivo = v.motivo === "anticipacion"
          ? "necesitamos al menos 24 horas de anticipación para poder confirmarla"
          : v.motivo === "fuera_de_horario" ? "ese horario está fuera del horario de visitas" : "a esa hora no hay ningún asesor libre";
        const alt = ciclo
          .flatMap((a) => reglas.alternativas({ ahora, horario: a.horario, ocupadas: rotacion.ocupadasDe(citasOrg, a, { excluirLeadId: ctx.lead.id }) }))
          .sort().filter((x, i, arr) => arr.indexOf(x) === i).slice(0, 3);
        const lista = alt.map((iso) => { const fh = formatCitaFechaHora(iso); return `- ${fh ? `${fh.fecha} a las ${fh.hora}` : iso}`; }).join("\n");
        return `No se pudo agendar: ${motivo}. Ofrecele estos horarios (o que proponga otro con al menos 24 h):\n${lista}`;
      }
      const ahoraIso = ahora.toISOString();
      cita.asesor_id = elegido.id;
      if (elegido.auth_user_id) cita.advisor_id = elegido.auth_user_id;
      cita.asignada_at = ahoraIso;
      cita.corte_at = reglas.corteDe(cita.fecha_hora);
      cita.historial = [{ asesor_id: elegido.id, desde: ahoraIso }];
      ctx.appointmentAlert = { porPlantilla: true, advisor: elegido, advisorPhone: elegido.phone, advisorName: elegido.name, advisorId: elegido.id };
      ctx.cita = cita;
      ctx.lead.cita = cita;
      try {
        Object.assign(ctx.lead, await leads.update(ctx.lead.id, { cita }));
      } catch (e) {
        console.warn("[tools] No se pudo persistir la cita:", e.message);
      }
      const fh = formatCitaFechaHora(cita.corte_at);
      const corte = fh ? `${fh.fecha} a las ${fh.hora}` : "antes de la visita";
      const quien = ctx.colega ? "al colega" : "al cliente";
      return `Cita registrada como PROPUESTA (${cita.fecha_hora}). Ya se le avisó al equipo para confirmarla. Decile ${quien} que la visita quedó SOLICITADA y que se la confirmamos antes del ${corte}. NO le des ningún número ni nombre de persona. Nunca digas "confirmada".`;
    }
    // Sin ciclo configurado: el camino de siempre (abajo).
```

`appointments.citasDeLaOrg` debe exportarse (hoy es interna: agregarla al `module.exports`).

En `src/channels/whatsapp.js`, en la entrega de `appointmentAlert` (`procesarMensaje` ya devuelve `lead`):

```js
      if (appointmentAlert && appointmentAlert.porPlantilla) {
        const { avisarCitaPorConfirmar } = require("../notifications/aviso-cita");
        const r = await avisarCitaPorConfirmar({ org, advisor: appointmentAlert.advisor, lead, cita: lead.cita }).catch((e) => ({ ok: false, error: e.message }));
        if (!r.ok) console.error(`[whatsapp] Aviso de cita a ${appointmentAlert.advisorName} NO se pudo entregar:`, r.error);
      } else if (appointmentAlert) {
        // ... bloque actual con entregarConRespaldo, sin cambios
      }
```

(agregar `lead` a la desestructuración de `engine.procesarMensaje` si no está.)
- [ ] **Step 4:** `npm test` → 0 fail. **Step 5:** commit `feat(agenda): agendar_cita con 24 h, 150 min y rotación de asesores`

---

### Task 7: Escalera horaria y corte

**Files:** Create `src/scheduler/citas-escalera.js`; Modify `src/server.js`, `src/data/leads.js` (`listConCitasPropuestasVencidas` ignora citas con `asesor_id`; nueva `listCitasPropuestasEnRotacion()`), `src/config.js`; Test `test/citas-escalera.test.js`

**Interfaces — Produces:** `pasoDeEscalera({ lead, ciclo, citasOrg, ahora }) -> { accion: "nada"|"rotar"|"cortar", nuevo? }` (pura) y `runOnce({ ahora, deps })`.

Reglas de `pasoDeEscalera`:
- `ahora >= corte_at` → `cortar`.
- `enSilencio(ahora)` → `nada`.
- `ahora - asignada_at >= ESCALERA_PASO_MIN` → `rotar` con `nuevo = rotacion.siguiente({ ..., ahora: new Date(lead.cita.creada_at) })` (la anticipación se mide desde la creación); si `nuevo.id === actual` → `nada`.
- si no → `nada`.

`runOnce`:
- `rotar`: `historial` cierra el tramo actual (`hasta`) y agrega `{ asesor_id: nuevo.id, desde }`; `asesor_id`, `advisor_id` (auth si hay), `asignada_at = ahora`; `avisarCitaPorConfirmar(nuevo)`; texto al anterior: "La visita de {quien} {cuándo} pasó a {alias nuevo} porque no se confirmó en una hora. Si igual podés tomarla, tocá Confirmar en el aviso anterior."
- `cortar`: `estado: "cancelada"`, `motivo: "sin_confirmar"`; plantilla `cita_no_confirmada` al cliente/colega; texto al asesor actual "Se canceló la visita de {quien} por falta de confirmación".

- [ ] **Step 1: test**

```js
// test/citas-escalera.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { pasoDeEscalera } = require("../src/scheduler/citas-escalera");

const H = { dias: [0, 1, 2, 3, 4, 5, 6], desde: "08:00", hasta: "18:00" };
const A1 = { id: "a1", orden_citas: 1, horario: H }, A2 = { id: "a2", orden_citas: 2, horario: H }, A3 = { id: "a3", orden_citas: 3, horario: H };
const CICLO = [A1, A2, A3];
const lead = (over = {}) => ({ id: "l1", cita: { estado: "propuesta", fecha_hora: "2026-10-09T20:00:00Z", corte_at: "2026-10-09T16:00:00Z",
  creada_at: "2026-10-07T15:00:00Z", asignada_at: "2026-10-08T14:00:00Z", asesor_id: "a1", historial: [{ asesor_id: "a1", desde: "2026-10-08T14:00:00Z" }], ...over } });

test("antes de la hora no pasa nada", () => {
  assert.strictEqual(pasoDeEscalera({ lead: lead(), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-08T14:59:00Z") }).accion, "nada");
});
test("a la hora rota al siguiente del ciclo", () => {
  const p = pasoDeEscalera({ lead: lead(), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-08T15:00:00Z") });
  assert.strictEqual(p.accion, "rotar");
  assert.strictEqual(p.nuevo.id, "a2");
});
test("del último vuelve al primero", () => {
  const p = pasoDeEscalera({ lead: lead({ asesor_id: "a3" }), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-08T15:00:00Z") });
  assert.strictEqual(p.nuevo.id, "a1");
});
test("de noche no rota (20:00-08:00 Bogotá)", () => {
  assert.strictEqual(pasoDeEscalera({ lead: lead(), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-09T03:00:00Z") }).accion, "nada");
});
test("en el corte se cancela, aunque sea de noche", () => {
  assert.strictEqual(pasoDeEscalera({ lead: lead({ corte_at: "2026-10-09T03:00:00Z" }), ciclo: CICLO, citasOrg: [], ahora: new Date("2026-10-09T03:00:00Z") }).accion, "cortar");
});
```

- [ ] **Step 2:** FAIL. **Step 3: implement** `src/scheduler/citas-escalera.js` con `pasoDeEscalera` (reglas de arriba), `runOnce` (lee `leads.listCitasPropuestasEnRotacion()` = citas `propuesta` con `asesor_id`; resuelve org con `organizations.findById`; ciclo con `rotacion.asesoresDelCiclo`; `citasOrg` con `appointments.citasDeLaOrg`; aplica la acción) y `start/stop` con el patrón de `citas-recordatorio.js` (guarda `corriendo`, `setInterval` cada `ESCALERA_INTERVALO_MIN=5`). En `src/server.js`, junto a `citas-recordatorio`: `if (config.supabaseUrl) require("./scheduler/citas-escalera").start();`. En `listConCitasPropuestasVencidas`, agregar `if (c.asesor_id) return false;` (esas las maneja la escalera).
- [ ] **Step 4:** `npm test` → 0 fail. **Step 5:** commit `feat(agenda): la cita rota de asesor cada hora y se cancela en el corte`

---

### Task 8: Integración y despliegue

- [ ] `npm test` completo; merge a `main`; push; deploy SUCCESS del servicio `diamond`.
- [ ] Verificación (cuando haya saldo de Anthropic): una cita de prueba con un número de Juan como cliente → llega la plantilla al asesor elegido con botones; tocar Confirmar → el "cliente" recibe "Te recibe Asesor N". Otra cita sin confirmar → a la hora rota (log `[citas-escalera]`).

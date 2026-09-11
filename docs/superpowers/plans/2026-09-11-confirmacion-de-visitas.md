# Confirmación de visitas: implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ninguna cita (de cliente o de colega) se le diga como "confirmada" a nadie hasta que el asesor dueño de la agenda responda *OK CONFIRMADA* — hoy `agendar_cita` la marca `solicitada` (que el sistema lee como `confirmada` por un bug de compatibilidad) y Sofi se lo confirma al cliente de una, sin que ningún humano la haya visto.

**Architecture:** La cita nace `propuesta` (estado ya soportado por `src/data/citas.js`, solo que `agendar_cita` nunca lo usaba). El aviso al asesor termina pidiendo *OK CONFIRMADA*. Una herramienta nueva, `confirmar_cita`, solo disponible cuando `ctx.advisor` existe (el asesor hablándole a Sofi), busca sus citas `propuesta` más próximas y las pasa a `confirmada`, avisando al cliente/colega por la línea oficial. Un scheduler nuevo (mismo patrón que `radar-recordatorio.js`) empuja al asesor una sola vez si no confirmó en 2 horas.

**Tech Stack:** Node.js, Supabase (jsonb en `leads.cita`, sin migración de schema — todo son campos nuevos dentro de ese jsonb), Anthropic SDK (tool use), `node:test` + `node:assert`.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-09-10-confirmacion-de-visitas-design.md` — no la dupliques, consultala si algo de acá no calza.
- Copy neutro en género (asesor/asesora) — regla vigente de todo el radar (ver `docs/superpowers/plans/2026-09-10-colega-solo-llamada.md`).
- El aviso al colega/cliente sobre la confirmación **nunca** sale por la línea del radar (WAHA) — siempre por la línea OFICIAL de Sofi (`channels/whatsapp.js#sendWhatsApp`), y respeta "solo llamada" (`colegas.esSoloLlamada`).
- Nadie más que el asesor DUEÑO de la cita (`cita.advisor_id === ctx.advisor.auth_user_id`) puede confirmarla — nunca "cualquier asesor que le escriba a Sofi".
- Commits pequeños, uno por tarea, mensaje en español con prefijo convencional, terminando en:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```
- Correr `npm test` completo al final de cada tarea.

---

## File Structure

- **Modify:** `src/agent/tools.js` — `agendar_cita` (estado + mensaje de retorno), tool nueva `confirmar_cita` + su handler, `TOOL_DEFINITIONS`.
- **Modify:** `src/notifications/advisor.js` — `buildAppointmentAlert`, `buildColegaAppointmentAlert` (línea de cierre pidiendo OK CONFIRMADA).
- **Modify:** `src/data/appointments.js` — `citasPendientesDeConfirmar(orgId, advisorId)`.
- **Modify:** `src/agent/prompts.js` — `promptAsesor` aprende a usar `confirmar_cita`.
- **Create:** `src/scheduler/citas-recordatorio.js` — recordatorio único a las 2h si no confirmó (mismo patrón que `radar-recordatorio.js`).
- **Modify:** `src/server.js` — arranca el scheduler nuevo.
- **Modify:** `src/config.js` — bloque de config del scheduler nuevo (`enabled`, `silenceMin`, `intervalMin`), mismo patrón que `config.groups.recordatorio`.
- **Create:** `scripts/backfill-citas-propuesta.js` — corrección de datos, uno-a-uno, para las citas `solicitada` que ya existen (la corre Juan una vez).
- **Test:** `test/agendar-cita.test.js` (si no existe, buscar con `grep -rl "agendar_cita" test/*.js`), `test/appointments.test.js` (o el que cubra `appointments.js`), `test/confirmar-cita.test.js` (nuevo), `test/citas-recordatorio.test.js` (nuevo).

---

### Task 1: `agendar_cita` deja de auto-confirmar

**Files:**
- Modify: `src/agent/tools.js:664-786`
- Test: buscar con `grep -rl "agendar_cita" test/*.js` y editar ahí.

**Interfaces:**
- Consumes: `advisors.findAsesorPrincipalRadar(ctx.org)` (ya existe, `src/data/advisors.js:223`).
- Produces: `cita.estado === "propuesta"` (antes `"solicitada"`) — consumido por la Task 3 (`citasPendientesDeConfirmar`) y por `citas.estadoDe` (ya soporta `"propuesta"`, sin cambios ahí).

- [ ] **Step 1: Ubicar y leer el test existente**

Run: `grep -rl "agendar_cita" test/*.js`

Leer el archivo para copiar el fixture de `ctx`/`org`/`lead` antes de escribir el test nuevo.

- [ ] **Step 2: Escribir los tests que fallan**

```js
test("agendar_cita: la cita nace propuesta, nunca confirmada de una", async (t) => {
  // ... fixture existente que llega hasta el agendamiento con fecha_hora
  // valida y advisor resuelto (copiar del test feliz que ya exista).
  const r = await executeTool("agendar_cita", { fecha_hora_iso: "2026-09-12T15:00:00-05:00", tipo: "visita", descripcion: "ver la casa" }, ctx);

  assert.strictEqual(ctx.cita.estado, "propuesta");
  assert.doesNotMatch(r, /confirmad/i);
  assert.match(r, /solicitad/i);
});

test("agendar_cita: a un colega tambien le queda propuesta, y el texto de retorno menciona al coordinador para confirmar directo", async (t) => {
  t.mock.method(advisors, "findAsesorPrincipalRadar", async () => ({ name: "Daiana Zea", phone: "573011880668" }));
  // ... fixture con ctx.colega = {...} en vez de un cliente normal.

  const r = await executeTool("agendar_cita", { fecha_hora_iso: "2026-09-12T15:00:00-05:00", tipo: "visita", descripcion: "ver la casa" }, ctx);

  assert.strictEqual(ctx.cita.estado, "propuesta");
  assert.match(r, /Daiana Zea/);
  assert.match(r, /573011880668/);
});
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `node --test <archivo>`
Expected: FAIL — `ctx.cita.estado` es `"solicitada"`, y el texto de retorno sigue diciendo "Confirma al cliente... repitiendo EXACTAMENTE".

- [ ] **Step 4: Implementar**

En `src/agent/tools.js`, dentro de `agendar_cita` (línea 664-670), cambiar:

```js
    const cita = {
      descripcion: input.descripcion,
      fecha_hora: input.fecha_hora_iso || null,
      tipo: input.tipo || "llamada",
      estado: "propuesta",
      creada_at: new Date().toISOString(),
    };
```

Y reemplazar el bloque de retorno (línea 783-786):

```js
    // CONFIRMACION DE VISITAS (2026-09-11): la cita nace `propuesta`, no
    // confirmada -- nadie de la casa la vio todavia. El texto que Sofi le dice
    // al cliente/colega NUNCA puede sonar a confirmada: eso es lo que
    // confirmar_cita (mas abajo) resuelve cuando el asesor responde
    // "OK CONFIRMADA". Ver docs/superpowers/specs/2026-09-10-confirmacion-de-visitas-design.md.
    const coordinador = ctx.appointmentAlert
      ? await advisors.findAsesorPrincipalRadar(ctx.org).catch((e) => {
          console.warn("[tools] No se pudo resolver el coordinador de visitas:", e.message);
          return null;
        })
      : null;
    const notificado = ctx.appointmentAlert
      ? " El asesor ya fue notificado, pero TODAVIA NO CONFIRMO la cita."
      : " Cuando transfieras al asesor la vera en la alerta.";
    const comoDecirlo = ctx.colega
      ? `Decile al colega que la visita quedo SOLICITADA${cita.fecha_hora ? ` para ${cita.fecha_hora}` : ""}, que en breve ${
          coordinador?.name || "la asesora"
        } lo contacta para confirmarla${
          coordinador?.phone ? `, y que si quiere confirmarla directo puede escribirle a +${coordinador.phone}` : ""
        }. Nunca digas "confirmada".`
      : `Decile al cliente que la visita quedo SOLICITADA${cita.fecha_hora ? ` para ${cita.fecha_hora}` : ""} y que en breve lo contactan para confirmarla. NUNCA digas "confirmada" ni "queda lista": todavia falta que el asesor la confirme.`;
    return `Cita registrada: ${cita.descripcion}${cita.fecha_hora ? ` (${cita.fecha_hora})` : ""} — tipo ${cita.tipo}.${notificado} ${comoDecirlo}`;
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `node --test <archivo>`
Expected: PASS

- [ ] **Step 6: Correr toda la suite**

Run: `npm test`
Expected: PASS (revisar si algún otro test asumía el texto viejo "Confirma al cliente..." — ajustarlo con el mismo criterio).

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools.js test/<archivo>
git commit -m "fix(citas): agendar_cita ya no confirma solo -- la cita nace propuesta

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: El aviso al asesor pide "OK CONFIRMADA"

**Files:**
- Modify: `src/notifications/advisor.js:268-279` (`buildAppointmentAlert`), `:301-365` (`buildColegaAppointmentAlert`)
- Test: buscar con `grep -rl "buildAppointmentAlert\|buildColegaAppointmentAlert" test/*.js`

**Interfaces:**
- No cambia la firma de ninguna de las dos funciones — solo el texto que devuelven.

- [ ] **Step 1: Escribir los tests que fallan**

```js
test("buildAppointmentAlert pide OK CONFIRMADA", () => {
  const texto = buildAppointmentAlert(ADVISOR, LEAD, CITA);
  assert.match(texto, /OK CONFIRMADA/);
});

test("buildColegaAppointmentAlert tambien pide OK CONFIRMADA", async () => {
  const texto = await buildColegaAppointmentAlert({ org: ORG, colega: COLEGA, lead: LEAD, cita: CITA, ref: null });
  assert.match(texto, /OK CONFIRMADA/);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test <archivo>`
Expected: FAIL

- [ ] **Step 3: Implementar**

En `buildAppointmentAlert` (línea 268-279), agregar la línea de cierre:

```js
function buildAppointmentAlert(advisor, lead, cita) {
  const tipoLabel = { visita: "una visita", llamada: "una llamada", asesoria: "una asesoría" }[cita.tipo] || "una cita";
  const clienteNombre = lead.nombre || "un cliente";
  const clienteTelefono = lead.phone ? ` (+${lead.phone})` : "";
  const fechaHora = formatCitaFechaHora(cita.fecha_hora);
  const cuando = fechaHora ? `el ${fechaHora.fecha} a las ${fechaHora.hora}` : cita.descripcion || "próximamente";
  const inmueble = lead.property_ref_origen ? `\nPropiedad de interés: ${lead.property_ref_origen}` : "";
  const idioma = idiomaLine(lead) ? `\n${idiomaLine(lead)}` : "";
  const calLink = buildCalendarLink(cita, lead);
  const cal = calLink ? `\nAgendar en tu calendario: ${calLink}` : "";
  // CONFIRMACION DE VISITAS (2026-09-11): la cita todavia esta PROPUESTA -- sin
  // esto, Sofi ya le habia dicho "confirmada" al cliente sin que nadie de la
  // casa la hubiera visto. Respondele a Sofi con "OK CONFIRMADA" para que
  // confirmar_cita la pase a confirmada y avise al cliente.
  return `Nueva cita PROPUESTA!\nTienes ${tipoLabel} con ${clienteNombre}${clienteTelefono} ${cuando}.${inmueble}${idioma}${cal}\n\nRespondé *OK CONFIRMADA* para confirmarla, o decime otra hora.`;
}
```

Y al final de `buildColegaAppointmentAlert` (línea 361, antes del `.filter/.join`), agregar una línea más al array:

```js
    calLink ? `Agendar en tu calendario: ${calLink}` : null,
    "Coordinala vos con el colega. Si se cierra, la comision se comparte y los terminos los acuerdan entre ustedes.",
    "",
    "Respondé *OK CONFIRMADA* para confirmarla, o decime otra hora.",
  ]
    .filter((l) => l !== null)
    .join("\n");
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `node --test <archivo>`
Expected: PASS

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/notifications/advisor.js test/<archivo>
git commit -m "feat(citas): el aviso de cita pide OK CONFIRMADA en vez de darla por hecha

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `appointments.citasPendientesDeConfirmar`

**Files:**
- Modify: `src/data/appointments.js`
- Test: buscar con `grep -rl "require.*data/appointments" test/*.js` (probablemente `test/appointments.test.js` o similar; si no existe ninguno unitario, crear `test/appointments-confirmar.test.js`).

**Interfaces:**
- Consumes: `citas.estadoDe(cita)` (ya existe, `src/data/citas.js:22`).
- Produces: `citasPendientesDeConfirmar(orgId, advisorId) → Promise<Array<{id, nombre, phone, source, cita}>>`, ordenadas por `cita.fecha_hora` ascendente (la más próxima primero). Usado por la Task 4.

- [ ] **Step 1: Escribir los tests que fallan**

```js
const appointments = require("../src/data/appointments");
const memory = require("../src/data/memory");

beforeEach(() => { memory.leads.length = 0; });

test("citasPendientesDeConfirmar: solo las propuesta del asesor dado, ordenadas por fecha", async () => {
  memory.leads.push(
    { id: "l1", org_id: "org-1", nombre: "Sebastian", phone: "573001111111", source: "whatsapp", cita: { estado: "propuesta", fecha_hora: "2026-09-12T15:00:00-05:00", advisor_id: "adv-catherine" } },
    { id: "l2", org_id: "org-1", nombre: "Otro", phone: "573002222222", source: "whatsapp", cita: { estado: "propuesta", fecha_hora: "2026-09-12T10:00:00-05:00", advisor_id: "adv-catherine" } },
    { id: "l3", org_id: "org-1", nombre: "Ya confirmado", phone: "573003333333", source: "whatsapp", cita: { estado: "confirmada", fecha_hora: "2026-09-12T09:00:00-05:00", advisor_id: "adv-catherine" } },
    { id: "l4", org_id: "org-1", nombre: "De otro asesor", phone: "573004444444", source: "whatsapp", cita: { estado: "propuesta", fecha_hora: "2026-09-12T08:00:00-05:00", advisor_id: "adv-daiana" } }
  );

  const r = await appointments.citasPendientesDeConfirmar("org-1", "adv-catherine");

  assert.deepStrictEqual(r.map((l) => l.id), ["l2", "l1"]);
});

test("citasPendientesDeConfirmar: sin advisorId, lista vacia", async () => {
  const r = await appointments.citasPendientesDeConfirmar("org-1", null);
  assert.deepStrictEqual(r, []);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test <archivo>`
Expected: FAIL — `citasPendientesDeConfirmar` no existe.

- [ ] **Step 3: Implementar**

En `src/data/appointments.js`, agregar después de `dueReminders` (línea 172) y antes de `module.exports`:

```js
// Citas PROPUESTA de un asesor especifico, para que confirmar_cita
// (src/agent/tools.js) sepa cuales ofrecerle. Ordenadas por fecha_hora
// ascendente: la mas proxima primero, que es la que casi siempre quiere decir
// cuando responde "OK CONFIRMADA" sin mas contexto.
async function citasPendientesDeConfirmar(orgId, advisorId) {
  if (!advisorId) return [];
  if (!supabase) {
    return memory.leads
      .filter((l) => l.org_id === orgId && l.cita && l.cita.advisor_id === advisorId && citasData.estadoDe(l.cita) === "propuesta")
      .sort((a, b) => new Date(a.cita.fecha_hora || 0) - new Date(b.cita.fecha_hora || 0));
  }
  const { data, error } = await supabase
    .from("leads")
    .select("id, nombre, phone, source, cita")
    .eq("org_id", orgId)
    .not("cita", "is", null)
    .limit(500);
  if (error) throw error;
  return (data || [])
    .filter((l) => l.cita && l.cita.advisor_id === advisorId && citasData.estadoDe(l.cita) === "propuesta")
    .sort((a, b) => new Date(a.cita.fecha_hora || 0) - new Date(b.cita.fecha_hora || 0));
}
```

Y actualizar `module.exports` (línea 174-184):

```js
module.exports = {
  DEFAULT_HORARIO,
  DURACION_MIN,
  partesBogota,
  dentroDeHorario,
  hayChoque,
  checkAvailability,
  proximoDisponible,
  isReminderDue,
  dueReminders,
  citasPendientesDeConfirmar,
};
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `node --test <archivo>`
Expected: PASS

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/data/appointments.js test/<archivo>
git commit -m "feat(citas): appointments.citasPendientesDeConfirmar para el asesor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: La herramienta `confirmar_cita`

**Files:**
- Modify: `src/agent/tools.js` (agregar a `TOOL_DEFINITIONS` y a `executeTool`)
- Test: `test/confirmar-cita.test.js` (nuevo)

**Interfaces:**
- Consumes: `appointments.citasPendientesDeConfirmar(orgId, advisorId)` (Task 3), `colegas.esSoloLlamada` (ya existe), `canalWhatsapp.sendWhatsApp` (require tardío, ver más abajo por qué).
- Produces: nada nuevo hacia afuera — es una tool más en `TOOL_DEFINITIONS`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/confirmar-cita.test.js`:

```js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

const { executeTool } = require("../src/agent/tools");
const appointments = require("../src/data/appointments");
const leads = require("../src/data/leads");
const colegas = require("../src/data/colegas");
const canalWhatsapp = require("../src/channels/whatsapp");

const ORG = { id: "org-1", name: "Diamond" };
const ADVISOR = { name: "Catherine Uribe", phone: "573028536489", auth_user_id: "adv-catherine" };

function ctxAsesor() {
  return { org: ORG, advisor: ADVISOR, colega: null, lead: { id: "lead-asesor", phone: ADVISOR.phone } };
}

test("confirmar_cita: sin ctx.advisor, la rechaza", async () => {
  const r = await executeTool("confirmar_cita", {}, { org: ORG, advisor: null });
  assert.match(r, /solo.*asesor/i);
});

test("confirmar_cita: ninguna pendiente", async (t) => {
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => []);
  const r = await executeTool("confirmar_cita", {}, ctxAsesor());
  assert.match(r, /no tenes ninguna/i);
});

test("confirmar_cita: varias pendientes, pregunta cual", async (t) => {
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => [
    { id: "l1", nombre: "Sebastian", phone: "573001111111", source: "whatsapp", cita: { fecha_hora: "2026-09-12T15:00:00-05:00", tipo: "visita" } },
    { id: "l2", nombre: "Otro", phone: "573002222222", source: "whatsapp", cita: { fecha_hora: "2026-09-13T10:00:00-05:00", tipo: "visita" } },
  ]);
  const r = await executeTool("confirmar_cita", {}, ctxAsesor());
  assert.match(r, /2 citas/i);
  assert.match(r, /Sebastian/);
  assert.match(r, /Otro/);
});

test("confirmar_cita: una sola pendiente, la confirma y avisa al cliente por la linea oficial", async (t) => {
  const pendiente = { id: "lead-sebastian", nombre: "Sebastian Velasquez", phone: "573009998888", source: "whatsapp", cita: { fecha_hora: "2026-09-12T15:00:00-05:00", tipo: "visita", estado: "propuesta", ref: "9548121" } };
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => [pendiente]);
  t.mock.method(colegas, "esSoloLlamada", async () => false);
  const updates = [];
  t.mock.method(leads, "update", async (id, patch) => { updates.push({ id, patch }); return { ...pendiente, ...patch }; });
  const envios = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, phone, texto) => { envios.push({ phone, texto }); return { ok: true, wamid: "w1" }; });

  const r = await executeTool("confirmar_cita", {}, ctxAsesor());

  assert.strictEqual(updates[0].id, "lead-sebastian");
  assert.strictEqual(updates[0].patch.cita.estado, "confirmada");
  assert.ok(updates[0].patch.cita.confirmada_at);
  assert.strictEqual(updates[0].patch.cita.confirmada_por, "Catherine Uribe");
  assert.strictEqual(envios[0].phone, "573009998888");
  assert.match(envios[0].texto, /confirmada/i);
  assert.match(envios[0].texto, /Catherine Uribe/);
  assert.match(r, /confirmada/i);
  assert.match(r, /ya le avis/i);
});

test("confirmar_cita: colega marcado solo llamada -- no le escribe, se lo dice al asesor", async (t) => {
  const pendiente = { id: "lead-colega", nombre: "Un colega", phone: "573007776666", source: "colega", cita: { fecha_hora: "2026-09-12T15:00:00-05:00", tipo: "visita", estado: "propuesta" } };
  t.mock.method(appointments, "citasPendientesDeConfirmar", async () => [pendiente]);
  t.mock.method(colegas, "esSoloLlamada", async () => true);
  t.mock.method(leads, "update", async (id, patch) => ({ ...pendiente, ...patch }));
  const envios = [];
  t.mock.method(canalWhatsapp, "sendWhatsApp", async (org, phone, texto) => { envios.push({ phone, texto }); return { ok: true, wamid: "w1" }; });

  const r = await executeTool("confirmar_cita", {}, ctxAsesor());

  assert.strictEqual(envios.length, 0);
  assert.match(r, /no le pude avisar|avisale vos|solo llamada/i);
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `node --test test/confirmar-cita.test.js`
Expected: FAIL — `confirmar_cita` no existe como herramienta.

- [ ] **Step 3: Implementar la definición de la tool**

En `src/agent/tools.js`, agregar a `TOOL_DEFINITIONS` (junto a las demás, por ejemplo después de `registrar_resultado_radar` o `pedir_contacto_asesora` — buscar el cierre del array `];` antes de la línea `];` que lo termina):

```js
  {
    name: "confirmar_cita",
    description:
      "SOLO para un asesor de la casa (ctx.advisor) confirmando SU PROPIA cita PROPUESTA. Usala cuando el asesor responda algo como 'OK CONFIRMADA', 'confirmado', 'dale, confirmada' a un aviso de cita, o cuando proponga otra hora tras ver el aviso. Busca sus citas propuestas mas proximas: si hay una sola, la confirma y avisa al cliente/colega; si hay varias, te devuelve la lista para que le preguntes cual.",
    input_schema: { type: "object", properties: {} },
  },
```

- [ ] **Step 4: Implementar el handler**

En `src/agent/tools.js`, agregar el branch dentro de `executeTool` (después del bloque de `pedir_contacto_asesora`, antes del `return "Herramienta desconocida..."`):

```js
  if (name === "confirmar_cita") {
    // GATE (2026-09-11): esta herramienta SOLO existe para que un asesor
    // confirme SU propia cita -- ctx.advisor se resuelve en engine.js igual
    // que ctx.colega. Sin esto, cualquier cliente podria pedirle a Sofi que
    // "confirme" algo que nadie de la casa reviso.
    if (!ctx.advisor) {
      return "Esta herramienta es solo para un asesor de la casa confirmando su propia cita.";
    }
    let pendientes;
    try {
      pendientes = await appointments.citasPendientesDeConfirmar(ctx.org.id, ctx.advisor.auth_user_id);
    } catch (e) {
      console.warn("[tools] No se pudieron leer las citas pendientes de confirmar:", e.message);
      return "No pude leer tus citas pendientes ahorita. Intenta de nuevo en un momento.";
    }
    if (pendientes.length === 0) {
      return "No tenes ninguna cita PROPUESTA pendiente de confirmar ahorita.";
    }
    if (pendientes.length > 1) {
      const lista = pendientes
        .map((l, i) => {
          const fh = formatCitaFechaHora(l.cita.fecha_hora);
          const cuando = fh ? `${fh.fecha} a las ${fh.hora}` : l.cita.descripcion || "sin fecha";
          return `${i + 1}. ${l.nombre || `+${l.phone}`} — ${cuando}`;
        })
        .join("\n");
      return `Tenes ${pendientes.length} citas propuestas pendientes. Preguntale cual es, y volve a contarme con mas detalle (nombre o fecha) para identificarla:\n${lista}`;
    }

    const lead = pendientes[0];
    const cita = {
      ...lead.cita,
      estado: "confirmada",
      confirmada_at: new Date().toISOString(),
      confirmada_por: ctx.advisor.name,
    };
    await leads.update(lead.id, { cita });

    // AVISO AL CLIENTE/COLEGA, SIEMPRE POR LA LINEA OFICIAL (2026-09-11):
    // nunca por WAHA -- esta cita puede ser de un cliente final que nunca
    // estuvo en un grupo. Un colega marcado "solo llamada" no recibe nada:
    // se le pide al asesor que lo llame. Require tardio del canal (mismo
    // motivo que src/channels/whatsapp.js#procesarBotonRadar con
    // ../agent/tools): channels/whatsapp.js -> agent/engine.js -> este
        // archivo forma un ciclo si se requiere arriba, al tope del modulo.
    const canalWhatsapp = require("../channels/whatsapp");
    const esColega = lead.source === "colega";
    const soloLlamada = esColega
      ? await colegas.esSoloLlamada(ctx.org.id, { telefono: lead.phone }).catch(() => null)
      : false;

    const fechaHora = formatCitaFechaHora(cita.fecha_hora);
    const cuando = fechaHora ? `del ${fechaHora.fecha} a las ${fechaHora.hora}` : cita.descripcion || "acordada";
    const refLinea = cita.ref ? ` a la ref ${cita.ref}` : "";
    const textoCliente = `Tu visita ${cuando}${refLinea} quedó CONFIRMADA. Te recibe ${ctx.advisor.name}${
      ctx.advisor.phone ? `, +${ctx.advisor.phone}` : ""
    }.`;

    const quien = lead.nombre || `+${lead.phone}`;
    if (soloLlamada !== false) {
      return `Confirmada en el sistema la cita con ${quien}${refLinea} para ${cuando} — pidió que lo contacten solo por llamada, así que no le escribí: llamalo vos para avisarle.`;
    }

    const envio = await canalWhatsapp.sendWhatsApp(ctx.org, lead.phone, textoCliente).catch((e) => ({ ok: false, error: e.message }));
    if (envio && envio.ok) {
      return `Confirmada la cita con ${quien}${refLinea} para ${cuando}. Ya le avisé por WhatsApp.`;
    }
    return `Confirmada en el sistema la cita con ${quien}${refLinea} para ${cuando}, pero no le pude avisar por acá (probablemente la ventana de 24h está cerrada) — avisale vos.`;
  }
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `node --test test/confirmar-cita.test.js`
Expected: PASS

- [ ] **Step 6: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools.js test/confirmar-cita.test.js
git commit -m "feat(citas): herramienta confirmar_cita -- el asesor confirma y Sofi avisa al cliente

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `promptAsesor` aprende a usar `confirmar_cita`

**Files:**
- Modify: `src/agent/prompts.js:32-79` (`promptAsesor`)
- Test: buscar con `grep -rl "promptAsesor" test/*.js`

**Interfaces:**
- No agrega funciones nuevas — solo texto del prompt.

- [ ] **Step 1: Escribir el test que falla**

```js
test("promptAsesor menciona confirmar_cita y OK CONFIRMADA", () => {
  const bloques = promptAsesor({ org: ORG, advisor: ADVISOR, now: null });
  const texto = bloques.map((b) => b.text).join("\n");
  assert.match(texto, /confirmar_cita/);
  assert.match(texto, /OK CONFIRMADA/);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test <archivo>`
Expected: FAIL

- [ ] **Step 3: Implementar**

En `src/agent/prompts.js`, agregar una sección nueva dentro de `stable` (línea 32-79), justo después del bloque "CUANDO RESPONDE AL AVISO..." (línea 58-62) y antes de "CUANDO TE REENVIA UN MENSAJE DE UN GRUPO GREMIAL" (línea 64):

```
CUANDO TE CONFIRMA UNA CITA (responde algo como "OK CONFIRMADA", "confirmado", "dale, confirmada", o directamente propone otra hora tras ver un aviso de cita PROPUESTA): usa confirmar_cita. Si tiene una sola cita propuesta pendiente, la confirma sola y le avisa al cliente/colega por vos. Si tiene varias, te va a devolver la lista para que le preguntes cual — no adivines vos cual es.
- Si en vez de confirmar te propone OTRA hora ("mejor a las 4"), no uses confirmar_cita: decile que anotaste el cambio y que vas a reprogramarla (esto lo maneja quien reprograma citas desde el CRM, no vos con una herramienta de chat).
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test <archivo>`
Expected: PASS

- [ ] **Step 5: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompts.js test/<archivo>
git commit -m "feat(citas): promptAsesor sabe usar confirmar_cita

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Recordatorio único a las 2 horas

**Files:**
- Create: `src/scheduler/citas-recordatorio.js`
- Modify: `src/config.js` (bloque de config)
- Test: `test/citas-recordatorio.test.js` (nuevo)

**Interfaces:**
- Consumes: `appointments.citasPendientesDeConfirmar` — pero necesita TODAS las propuestas vencidas de TODAS las orgs/asesores, no de un asesor puntual. Se agrega una función hermana en la misma tarea (ver Step 3).
- Consumes: `mensajeAsesor.enviarYRegistrar(org, phone, texto)` (ya existe, `src/lib/mensaje-asesor.js:122`).

- [ ] **Step 1: Agregar el bloque de config**

En `src/config.js`, agregar junto a `followups` (línea 71-82) un bloque nuevo:

```js
  // Recordatorio unico al asesor si no confirmo una cita PROPUESTA en el
  // plazo (Juan, spec 2026-09-10-confirmacion-de-visitas): sin este empujon,
  // una cita puede quedar "propuesta" para siempre y el cliente nunca se
  // entera de que nadie la reviso.
  citasRecordatorio: {
    enabled: process.env.CITAS_RECORDATORIO_ENABLED !== "false",
    silenceMin: parseInt(process.env.CITAS_RECORDATORIO_SILENCE_MIN || "120", 10), // 2h
    intervalMin: parseInt(process.env.CITAS_RECORDATORIO_INTERVAL_MIN || "20", 10),
  },
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `test/citas-recordatorio.test.js`:

```js
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const citasRecordatorio = require("../src/scheduler/citas-recordatorio");
const config = require("../src/config");
const organizations = require("../src/data/organizations");
const advisors = require("../src/data/advisors");
const leads = require("../src/data/leads");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const ADVISOR = { id: "adv-catherine", auth_user_id: "adv-catherine", name: "Catherine Uribe", phone: "573028536489" };

let originalConfig;
beforeEach(() => {
  originalConfig = { ...config.citasRecordatorio };
  config.citasRecordatorio.enabled = true;
  config.citasRecordatorio.silenceMin = 120;
});
afterEach(() => Object.assign(config.citasRecordatorio, originalConfig));

test("una cita propuesta hace mas de 2h sin confirmar dispara un recordatorio, una sola vez", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  const vencida = {
    id: "lead-1", org_id: ORG.id, nombre: "Sebastian", phone: "573009998888",
    cita: { estado: "propuesta", advisor_id: "adv-catherine", creada_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), fecha_hora: "2026-09-12T15:00:00-05:00" },
  };
  t.mock.method(leads, "listConCitasPropuestasVencidas", async () => [vencida]);
  t.mock.method(advisors, "findByAuthUserId", async () => ADVISOR);
  const envios = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, phone, texto) => { envios.push({ phone, texto }); return { ok: true }; });
  const updates = [];
  t.mock.method(leads, "update", async (id, patch) => { updates.push({ id, patch }); return { ...vencida, ...patch }; });

  const r = await citasRecordatorio.runOnce();

  assert.strictEqual(r.sent, 1);
  assert.strictEqual(envios[0].phone, ADVISOR.phone);
  assert.match(envios[0].texto, /Sebastian/);
  assert.match(envios[0].texto, /OK CONFIRMADA/);
  assert.strictEqual(updates[0].patch.cita.recordatorio_confirmacion_enviado, true);
});

test("una cita ya recordada no se vuelve a recordar", async (t) => {
  t.mock.method(organizations, "listActive", async () => [ORG]);
  t.mock.method(leads, "listConCitasPropuestasVencidas", async () => []); // la consulta real ya la excluye
  const r = await citasRecordatorio.runOnce();
  assert.strictEqual(r.sent, 0);
});
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `node --test test/citas-recordatorio.test.js`
Expected: FAIL — ni el módulo `citas-recordatorio.js` ni `leads.listConCitasPropuestasVencidas` existen.

- [ ] **Step 4: Implementar la consulta de datos**

En `src/data/leads.js`, agregar (junto a las demás funciones de consulta, antes de `module.exports`):

```js
// Citas PROPUESTA vencidas hace mas de `silenceMin` sin recordatorio todavia
// (src/scheduler/citas-recordatorio.js). Volumen bajo, mismo criterio que
// appointments.js#citasDeLaOrg: se trae y se filtra en JS.
async function listConCitasPropuestasVencidas(silenceMin) {
  const corteMs = Date.now() - silenceMin * 60 * 1000;
  const citasData = require("./citas");
  const filtro = (l) => {
    const c = l.cita;
    if (!c || citasData.estadoDe(c) !== "propuesta") return false;
    if (c.recordatorio_confirmacion_enviado) return false;
    const creada = new Date(c.creada_at || 0).getTime();
    return !isNaN(creada) && creada <= corteMs;
  };
  if (!supabase) return memory.leads.filter(filtro);
  const { data, error } = await supabase
    .from("leads")
    .select("id, org_id, nombre, phone, source, cita")
    .not("cita", "is", null)
    .limit(500);
  if (error) throw error;
  return (data || []).filter(filtro);
}
```

Y sumarla al `module.exports` existente de `src/data/leads.js` (junto a `claimAppointmentReminder`).

- [ ] **Step 5: Implementar el scheduler**

Crear `src/scheduler/citas-recordatorio.js`:

```js
// Recordatorio UNICO al asesor si no confirmo una cita PROPUESTA en el plazo.
//
// POR QUE EXISTE (spec 2026-09-10-confirmacion-de-visitas, Juan). Con
// agendar_cita ya no confirmando solo (ver src/agent/tools.js), una cita
// PROPUESTA puede quedar asi para siempre si el asesor no ve el aviso o se le
// pasa por alto -- y el cliente nunca se entera de que nadie la reviso.
// Mismo patron que src/scheduler/radar-recordatorio.js: temporizador
// in-process, un solo empujon por cita en toda su vida (recordatorio_
// confirmacion_enviado, dentro de leads.cita).
const config = require("../config");
const advisors = require("../data/advisors");
const leads = require("../data/leads");
const mensajeAsesor = require("../lib/mensaje-asesor");
const { formatCitaFechaHora } = require("../notifications/advisor");

function textoRecordatorio(lead, advisor) {
  const fh = formatCitaFechaHora(lead.cita.fecha_hora);
  const cuando = fh ? `${fh.fecha} a las ${fh.hora}` : lead.cita.descripcion || "sin fecha";
  const saludo = advisor && advisor.name ? advisor.name.split(/\s+/)[0] : null;
  const quien = lead.nombre || `+${lead.phone}`;
  const cuerpo = `tenes una cita PROPUESTA con ${quien} para ${cuando} que todavia no confirmaste.`;
  return [
    saludo ? `${saludo}, ${cuerpo}` : cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1),
    `Respondé *OK CONFIRMADA* para confirmarla, o contame otra hora si hay que moverla.`,
  ].join("\n\n");
}

async function runOnce() {
  if (!config.citasRecordatorio.enabled) return { sent: 0 };

  let vencidas;
  try {
    vencidas = await leads.listConCitasPropuestasVencidas(config.citasRecordatorio.silenceMin);
  } catch (e) {
    console.error("[citas-recordatorio] error leyendo citas vencidas:", e.message);
    return { sent: 0 };
  }

  let sent = 0;
  for (const lead of vencidas) {
    try {
      const advisor = await advisors.findByAuthUserId(lead.org_id, lead.cita.advisor_id).catch(() => null);
      if (!advisor || !advisor.phone) continue;

      const { ok } = await mensajeAsesor.enviarYRegistrar(
        { id: lead.org_id },
        advisor.phone,
        textoRecordatorio(lead, advisor)
      );
      // Se marca SIEMPRE, salga o no: si la ventana esta cerrada, reintentar
      // en el proximo tick no la va a abrir (mismo criterio que
      // radar-recordatorio.js) -- lo unico que la reabre es que el asesor le
      // escriba primero a Sofi, y eso no depende de este scheduler.
      await leads.update(lead.id, { cita: { ...lead.cita, recordatorio_confirmacion_enviado: true } });
      if (ok) sent++;
      else console.warn(`[citas-recordatorio] No se pudo avisar a ${advisor.name} de la cita con ${lead.nombre || lead.phone}`);
    } catch (e) {
      console.error("[citas-recordatorio] error con lead", lead.id, e.message);
    }
  }
  if (sent) console.log(`[citas-recordatorio] ${sent} recordatorio(s) enviado(s)`);
  return { sent };
}

let timer = null;
function start() {
  if (!config.citasRecordatorio.enabled) {
    console.log("[citas-recordatorio] deshabilitado (CITAS_RECORDATORIO_ENABLED=false)");
    return null;
  }
  const ms = config.citasRecordatorio.intervalMin * 60 * 1000;
  setTimeout(() => runOnce().catch((e) => console.error("[citas-recordatorio] runOnce:", e.message)), 45 * 1000);
  timer = setInterval(() => runOnce().catch((e) => console.error("[citas-recordatorio] runOnce:", e.message)), ms);
  console.log(
    `[citas-recordatorio] activo — cada ${config.citasRecordatorio.intervalMin} min, silencio ${config.citasRecordatorio.silenceMin} min`
  );
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, textoRecordatorio };
```

Nota: `mensajeAsesor.enviarYRegistrar` recibe `org` como su primer argumento y usa `org.id` — pasar `{ id: lead.org_id }` alcanza porque internamente solo lee `org.id` para `leads.findOrCreate`/`conversations` y lo pasa tal cual a `canalWhatsapp.sendWhatsApp(org, ...)`, que necesita más campos de la org (token, phone_id) — **antes de dar esta tarea por cerrada, verificar si `sendWhatsApp` de verdad necesita más que `.id` de `org`** (revisar `src/channels/whatsapp.js#credsFor`); si sí, cambiar `runOnce` para resolver la org completa con `organizations.findById(lead.org_id)` en vez de pasar un objeto sintético.

- [ ] **Step 6: Correr y verificar que pasan**

Run: `node --test test/citas-recordatorio.test.js`
Expected: PASS

- [ ] **Step 7: Wire en `server.js`**

En `src/server.js`, agregar junto a los demás schedulers (después de la línea de `avisos-salida`):

```js
  if (config.supabaseUrl) require("./scheduler/citas-recordatorio").start();
```

- [ ] **Step 8: Correr toda la suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/config.js src/data/leads.js src/scheduler/citas-recordatorio.js src/server.js test/citas-recordatorio.test.js
git commit -m "feat(citas): recordatorio unico a las 2h si el asesor no confirmo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Corregir los datos existentes

**Files:**
- Create: `scripts/backfill-citas-propuesta.js`

**Interfaces:**
- Ninguna — es un script de un solo uso, no un módulo importado por nadie.

- [ ] **Step 1: Escribir el script**

Mirar `scripts/golden-revalidar.js` para copiar el patrón de conexión a Supabase de producción (`railway run`) antes de escribir este.

```js
// Uso unico (2026-09-11): las citas que ya existen con estado "solicitada"
// (el valor que agendar_cita escribia antes de esta spec) pasan a
// "propuesta" -- si no, citas.estadoDe() las sigue leyendo como "confirmada"
// y confirmar_cita nunca las va a encontrar como pendientes.
//
// Correr con la clave de PRODUCCION, no la local:
//   railway run --service diamond node scripts/backfill-citas-propuesta.js
const supabase = require("../src/data/supabase");

async function main() {
  if (!supabase) {
    console.error("Sin SUPABASE_URL/SUPABASE_SERVICE_KEY configurados.");
    process.exit(1);
  }
  const { data, error } = await supabase
    .from("leads")
    .select("id, nombre, cita")
    .not("cita", "is", null)
    .limit(1000);
  if (error) throw error;

  const aCorregir = (data || []).filter((l) => l.cita && l.cita.estado === "solicitada");
  console.log(`${aCorregir.length} cita(s) con estado "solicitada" encontradas.`);

  for (const l of aCorregir) {
    const cita = { ...l.cita, estado: "propuesta" };
    const { error: errUpdate } = await supabase.from("leads").update({ cita }).eq("id", l.id);
    if (errUpdate) {
      console.error(`No se pudo corregir la cita de ${l.nombre || l.id}:`, errUpdate.message);
    } else {
      console.log(`Corregida: ${l.nombre || l.id} -> propuesta`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Avisar a Juan**

Este script lo corre Juan a mano, UNA vez, después de que este plan entero esté desplegado (para que `confirmar_cita` ya exista cuando el asesor responda). Comando:

```bash
railway run --service diamond node scripts/backfill-citas-propuesta.js
```

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-citas-propuesta.js
git commit -m "chore(citas): script de un uso -- pasa las citas 'solicitada' a 'propuesta'

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Cierre

- [ ] **Verificación final:** `npm test` completo en verde.
- [ ] **Después del deploy:** Juan corre el script de la Task 7 una vez, y confirma manualmente (respondiendo *OK CONFIRMADA* a un aviso de prueba) que `confirmar_cita` funciona de punta a punta antes de darlo por bueno.
- [ ] **Caso Sebastián Velásquez (2026-09-10):** su cita quedó `solicitada`/leída como confirmada con el sistema viejo. Tras el backfill de la Task 7 pasa a `propuesta`; Catherine Uribe va a tener que confirmarla a mano (responderle *OK CONFIRMADA* a Sofi) para que el cliente reciba el aviso real de confirmación — no va a salir solo, porque el aviso original ya se mandó sin la línea nueva.

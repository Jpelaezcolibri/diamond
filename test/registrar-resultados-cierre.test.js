// El cobro del cierre del dia: de "1 no servía, 3 hubo visita" a signal_events.
//
// EL RIESGO QUE ESTOS TESTS CUIDAN. El numero lo interpreta el modelo, pero a
// que propiedad corresponde lo decide el CODIGO, contra la numeracion que se
// guardo cuando el cierre salio (radar_cierres.items). Si esto adivinara,
// registraria el resultado sobre la propiedad equivocada — que es peor que no
// registrar nada, y es justo lo que registrarResultadoRadar ya evita
// negandose a elegir cuando hay varios pendientes.

const { test } = require("node:test");
const assert = require("node:assert");

const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const radarCierres = require("../src/data/radar-cierres");
const signalEvents = require("../src/data/signal-events");

const CTX = {
  org: { id: "org-1", name: "Diamond" },
  advisor: { id: "adv-1", name: "Natalia Velez" },
};

const CIERRE = {
  id: "cierre-1",
  fecha: "2026-09-06",
  enviado_at: "2026-09-06T23:05:00Z",
  items: [
    { n: 1, signal_ids: ["sig-a"], ref: "10316178", titulo: "Apto Otraparte", colega: "Gustavo Arango" },
    { n: 2, signal_ids: ["sig-b"], ref: "9921388", titulo: "Apto Santa Ana", colega: "Gustavo Arango" },
    { n: 3, signal_ids: ["sig-c"], ref: "10012896", titulo: "Casa La Mota", colega: "Adriana Gutierrez" },
  ],
};

function mockCierre(t, cierre = CIERRE) {
  t.mock.method(radarCierres, "ultimoCobrable", async () => cierre);
}

test("la herramienta existe y pide una lista de resultados", () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === "registrar_resultados_cierre");
  assert.ok(def, "tiene que estar registrada");
  assert.ok(def.input_schema.properties.resultados, "recibe varios de una, no uno por mensaje");
});

test("registra varios resultados de un solo mensaje, cada uno sobre SU señal", async (t) => {
  mockCierre(t);
  const registrados = [];
  t.mock.method(signalEvents, "registrar", async (orgId, ev) => {
    registrados.push({ signalId: ev.signalId, tipo: ev.tipo });
    return { id: "ev" };
  });

  await executeTool(
    "registrar_resultados_cierre",
    { resultados: [{ numero: 1, tipo: "DESCARTADO" }, { numero: 3, tipo: "VISITA" }] },
    CTX
  );

  assert.deepStrictEqual(registrados, [
    { signalId: "sig-a", tipo: "DESCARTADO" },
    { signalId: "sig-c", tipo: "VISITA" },
  ]);
});

test("la confirmacion nombra la propiedad, para que Sofi no invente cual fue", async (t) => {
  mockCierre(t);
  t.mock.method(signalEvents, "registrar", async () => ({ id: "ev" }));

  const out = await executeTool("registrar_resultados_cierre", { resultados: [{ numero: 3, tipo: "VISITA" }] }, CTX);
  assert.match(out, /10012896/);
  assert.match(out, /VISITA|visita/);
});

// Falla cerrado: si el numero no esta en el cierre que ella recibio, no se
// registra nada de esa linea y se dice. Elegir "la mas parecida" seria adivinar.
test("un numero que no existe en el cierre no registra nada y se avisa", async (t) => {
  mockCierre(t);
  let llamadas = 0;
  t.mock.method(signalEvents, "registrar", async () => { llamadas++; return { id: "ev" }; });

  const out = await executeTool("registrar_resultados_cierre", { resultados: [{ numero: 9, tipo: "VISITA" }] }, CTX);
  assert.strictEqual(llamadas, 0);
  assert.match(out, /9/);
  assert.match(out, /no (existe|esta|está)|no encontr/i);
});

test("registra los numeros validos aunque uno del mismo mensaje sea invalido", async (t) => {
  mockCierre(t);
  const registrados = [];
  t.mock.method(signalEvents, "registrar", async (orgId, ev) => { registrados.push(ev.signalId); return { id: "ev" }; });

  const out = await executeTool(
    "registrar_resultados_cierre",
    { resultados: [{ numero: 2, tipo: "CIERRE" }, { numero: 7, tipo: "VISITA" }] },
    CTX
  );
  assert.deepStrictEqual(registrados, ["sig-b"]);
  assert.match(out, /9921388/);
  assert.match(out, /7/);
});

test("un tipo que no existe se rechaza en vez de guardarse como cualquier cosa", async (t) => {
  mockCierre(t);
  let llamadas = 0;
  t.mock.method(signalEvents, "registrar", async () => { llamadas++; return { id: "ev" }; });

  const out = await executeTool("registrar_resultados_cierre", { resultados: [{ numero: 1, tipo: "MASOMENOS" }] }, CTX);
  assert.strictEqual(llamadas, 0);
  assert.match(out, /MASOMENOS/);
});

test("sin cierre reciente no se inventa una numeracion", async (t) => {
  mockCierre(t, null);
  let llamadas = 0;
  t.mock.method(signalEvents, "registrar", async () => { llamadas++; return { id: "ev" }; });

  const out = await executeTool("registrar_resultados_cierre", { resultados: [{ numero: 1, tipo: "VISITA" }] }, CTX);
  assert.strictEqual(llamadas, 0);
  assert.match(out, /cierre/i);
});

test("no aplica cuando quien habla no es un asesor de la casa", async (t) => {
  mockCierre(t);
  const out = await executeTool("registrar_resultados_cierre", { resultados: [{ numero: 1, tipo: "VISITA" }] }, { org: CTX.org });
  assert.match(out, /asesor/i);
});

// Cierra el circuito que abre alerta-asesor.js ("Contame en que quedo"):
// hasta el 2026-08-18 esa respuesta se perdia en la conversacion. Esta tool
// la registra en signal_events, resolviendo A CUAL pedido se refiere sin
// adivinar (ver la nota de diseño en src/agent/tools.js).

const { test } = require("node:test");
const assert = require("node:assert");

const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const groupSignals = require("../src/data/group-signals");
const signalEvents = require("../src/data/signal-events");

function ctxAsesor(extra = {}) {
  return {
    org: { id: "org-1", name: "Diamond" },
    advisor: { id: "adv-catherine", name: "katherine Uribe", phone: "573028536489" },
    ...extra,
  };
}

test("la tool esta declarada con el enum correcto de tipos", () => {
  const def = TOOL_DEFINITIONS.find((t) => t.name === "registrar_resultado_radar");
  assert.ok(def, "registrar_resultado_radar debe estar en TOOL_DEFINITIONS");
  assert.deepStrictEqual(def.input_schema.required, ["tipo"]);
  for (const t of ["CONVERSACION", "VISITA", "NEGOCIACION", "CIERRE", "PERDIDO", "SIN_RESPUESTA"]) {
    assert.ok(def.input_schema.properties.tipo.enum.includes(t), `falta ${t} en el enum`);
  }
});

test("sin advisor en el contexto (es un cliente) no aplica", async () => {
  const out = await executeTool("registrar_resultado_radar", { tipo: "VISITA" }, { org: { id: "org-1" }, advisor: null });
  assert.match(out, /No aplica/);
});

test("con radarSignalId resuelto por cita (swipe-to-reply), registra directo sin preguntar", async (t) => {
  const registrados = [];
  t.mock.method(signalEvents, "registrar", async (orgId, fields) => {
    registrados.push({ orgId, ...fields });
    return { id: "ev-1" };
  });
  // pendientesDeAviso NO deberia ni llamarse: ya sabemos a cual señal es.
  let sePreguntoPendientes = false;
  t.mock.method(groupSignals, "pendientesDeAviso", async () => {
    sePreguntoPendientes = true;
    return [];
  });

  const out = await executeTool(
    "registrar_resultado_radar",
    { tipo: "CIERRE", motivo: "compro" },
    ctxAsesor({ radarSignalId: "sig-citada" })
  );

  assert.strictEqual(sePreguntoPendientes, false);
  assert.strictEqual(registrados.length, 1);
  assert.strictEqual(registrados[0].signalId, "sig-citada");
  assert.strictEqual(registrados[0].advisorId, "adv-catherine");
  assert.strictEqual(registrados[0].tipo, "CIERRE");
  assert.match(out, /Listo/);
});

test("sin cita y sin pendientes, dice que no encuentra nada", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => []);
  const out = await executeTool("registrar_resultado_radar", { tipo: "VISITA" }, ctxAsesor());
  assert.match(out, /No encuentro ningun pedido/);
});

test("un solo pendiente sin resultado previo: lo resuelve solo", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async (orgId, advisorId) => {
    assert.strictEqual(advisorId, "adv-catherine");
    return [{ id: "sig-unico", texto_original: "busco apto en Sabaneta" }];
  });
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  const registrados = [];
  t.mock.method(signalEvents, "registrar", async (orgId, fields) => {
    registrados.push(fields);
    return { id: "ev-2" };
  });

  const out = await executeTool("registrar_resultado_radar", { tipo: "SIN_RESPUESTA" }, ctxAsesor());

  assert.strictEqual(registrados.length, 1);
  assert.strictEqual(registrados[0].signalId, "sig-unico");
  assert.match(out, /Listo/);
});

test("un pendiente que YA tiene resultado registrado no cuenta — nunca lo sobreescribe", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-ya-resuelto", texto_original: "busco casa en Envigado" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map([["sig-ya-resuelto", { tipo: "CIERRE" }]]));
  let seRegistro = false;
  t.mock.method(signalEvents, "registrar", async () => { seRegistro = true; });

  const out = await executeTool("registrar_resultado_radar", { tipo: "VISITA" }, ctxAsesor());

  assert.strictEqual(seRegistro, false);
  assert.match(out, /No encuentro ningun pedido/);
});

test("varios pendientes sin especificar cual: lista y pregunta, no adivina", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-a", texto_original: "busco apto en Sabaneta 3 alcobas" },
    { id: "sig-b", texto_original: "busco casa en Envigado" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  let seRegistro = false;
  t.mock.method(signalEvents, "registrar", async () => { seRegistro = true; });

  const out = await executeTool("registrar_resultado_radar", { tipo: "VISITA" }, ctxAsesor());

  assert.strictEqual(seRegistro, false);
  assert.match(out, /Tenes 2 pedidos/);
  assert.match(out, /Sabaneta/);
  assert.match(out, /Envigado/);
});

test("varios pendientes CON 'cual' que desambigua: resuelve el que matchea", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-a", texto_original: "busco apto en Sabaneta 3 alcobas" },
    { id: "sig-b", texto_original: "busco casa en Envigado" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  const registrados = [];
  t.mock.method(signalEvents, "registrar", async (orgId, fields) => { registrados.push(fields); });

  const out = await executeTool("registrar_resultado_radar", { tipo: "CIERRE", cual: "sabaneta" }, ctxAsesor());

  assert.strictEqual(registrados.length, 1);
  assert.strictEqual(registrados[0].signalId, "sig-a");
  assert.match(out, /Listo/);
});

test("si signalEvents.registrar falla, lo dice sin tumbar la conversacion", async (t) => {
  t.mock.method(signalEvents, "registrar", async () => { throw new Error("tabla no existe"); });
  const out = await executeTool(
    "registrar_resultado_radar",
    { tipo: "VISITA" },
    ctxAsesor({ radarSignalId: "sig-x" })
  );
  assert.match(out, /No pude guardar/);
});

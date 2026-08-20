// El "no" del aviso "Tenés un match del radar que no salió solo" (Juan,
// 2026-08-20): "explica en el mensaje que debe responder si o no para que
// se reenvie, asi no vamos a tener diferencias". Antes un "no" no llamaba
// ninguna herramienta y no quedaba registrado en ningun lado — un pedido
// descartado y uno que nunca se leyo se veian identicos.

const { test } = require("node:test");
const assert = require("node:assert");

const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const groupSignals = require("../src/data/group-signals");
const signalEvents = require("../src/data/signal-events");

function ctxAsesor(extra = {}) {
  return {
    org: { id: "org-1", name: "Diamond" },
    advisor: { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" },
    ...extra,
  };
}

test("la tool esta declarada", () => {
  const def = TOOL_DEFINITIONS.find((t) => t.name === "rechazar_pedido_radar");
  assert.ok(def, "rechazar_pedido_radar debe estar en TOOL_DEFINITIONS");
});

test("sin advisor en el contexto (es un cliente) no aplica", async () => {
  const out = await executeTool("rechazar_pedido_radar", {}, { org: { id: "org-1" }, advisor: null });
  assert.match(out, /No aplica/);
});

test("con radarSignalId resuelto por cita (swipe-to-reply), registra directo sin preguntar", async (t) => {
  let sePreguntoPendientes = false;
  t.mock.method(groupSignals, "pendientesDeAviso", async () => { sePreguntoPendientes = true; return []; });
  let recibido = null;
  t.mock.method(signalEvents, "registrar", async (orgId, datos) => {
    recibido = { orgId, ...datos };
    return { id: "ev-1", ...datos };
  });

  const out = await executeTool("rechazar_pedido_radar", {}, ctxAsesor({ radarSignalId: "sig-citada" }));

  assert.strictEqual(sePreguntoPendientes, false);
  assert.strictEqual(recibido.signalId, "sig-citada");
  assert.strictEqual(recibido.tipo, "DESCARTADO");
  assert.strictEqual(recibido.advisorId, "adv-natalia");
  assert.match(out, /registrado/);
});

test("guarda el motivo si el asesor lo da", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => []);
  let recibido = null;
  t.mock.method(signalEvents, "registrar", async (orgId, datos) => { recibido = datos; return { id: "ev-1" }; });

  await executeTool("rechazar_pedido_radar", { motivo: "ya consiguio otra cosa" }, ctxAsesor({ radarSignalId: "sig-1" }));

  assert.strictEqual(recibido.motivo, "ya consiguio otra cosa");
});

test("sin motivo, se guarda null en vez de un string vacio", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => []);
  let recibido = null;
  t.mock.method(signalEvents, "registrar", async (orgId, datos) => { recibido = datos; return { id: "ev-1" }; });

  await executeTool("rechazar_pedido_radar", {}, ctxAsesor({ radarSignalId: "sig-1" }));

  assert.strictEqual(recibido.motivo, null);
});

test("sin cita y sin pendientes, dice que no encuentra nada", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => []);
  const out = await executeTool("rechazar_pedido_radar", {}, ctxAsesor());
  assert.match(out, /No encuentro ningun pedido/);
});

test("un solo pendiente: lo resuelve solo y registra DESCARTADO con ese id", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async (orgId, advisorId) => {
    assert.strictEqual(advisorId, "adv-natalia");
    return [{ id: "sig-unico", texto_original: "busco apto en Loma de los Bernal" }];
  });
  let recibido = null;
  t.mock.method(signalEvents, "registrar", async (orgId, datos) => { recibido = datos; return { id: "ev-1" }; });
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());

  const out = await executeTool("rechazar_pedido_radar", {}, ctxAsesor());

  assert.strictEqual(recibido.signalId, "sig-unico");
  assert.match(out, /registrado que no sirve/);
});

test("varios pendientes sin especificar cual: lista y pregunta, no registra nada", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-a", texto_original: "busco apto en Sabaneta" },
    { id: "sig-b", texto_original: "busco casa en Envigado" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  let seRegistro = false;
  t.mock.method(signalEvents, "registrar", async () => { seRegistro = true; return { id: "ev-1" }; });

  const out = await executeTool("rechazar_pedido_radar", {}, ctxAsesor());

  assert.strictEqual(seRegistro, false);
  assert.match(out, /Tenes 2 pedidos/);
  assert.match(out, /Sabaneta/);
});

test("varios pendientes CON 'cual' que desambigua: registra el que matchea", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-a", texto_original: "busco apto en Sabaneta" },
    { id: "sig-b", texto_original: "busco casa en Envigado" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map());
  let recibido = null;
  t.mock.method(signalEvents, "registrar", async (orgId, datos) => { recibido = datos; return { id: "ev-1" }; });

  await executeTool("rechazar_pedido_radar", { cual: "envigado" }, ctxAsesor());

  assert.strictEqual(recibido.signalId, "sig-b");
});

// Un pedido que YA tiene un evento (aprobado o previamente rechazado) no
// puede seguir apareciendo como "pendiente de respuesta" — sin esto, un
// pedido que Natalia ya contesto le seguiria saliendo en la lista para
// desambiguar la proxima vez.
test("un pendiente con resultado YA registrado no cuenta como pendiente", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-ya-resuelto", texto_original: "busco apto en Sabaneta" },
  ]);
  t.mock.method(signalEvents, "ultimoPorSenal", async () => new Map([["sig-ya-resuelto", { tipo: "DESCARTADO" }]]));

  const out = await executeTool("rechazar_pedido_radar", {}, ctxAsesor());

  assert.match(out, /No encuentro ningun pedido/);
});

test("si signalEvents.registrar falla, lo dice sin tumbar la conversacion", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => []);
  t.mock.method(signalEvents, "registrar", async () => { throw new Error("db caida"); });

  const out = await executeTool("rechazar_pedido_radar", {}, ctxAsesor({ radarSignalId: "sig-1" }));
  assert.match(out, /No pude guardar/);
});

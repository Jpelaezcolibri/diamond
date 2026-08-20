// El otro lado del aviso "casi" (src/groups/vivo.js#avisarCercano): cuando
// el asesor responde "si" a un pedido que el radar callo solo por puntaje
// bajo, esto lo publica en el grupo por la misma via auditada que usa el
// camino 100% automatico (Juan, 2026-08-20).

const { test } = require("node:test");
const assert = require("node:assert");

const { executeTool, TOOL_DEFINITIONS } = require("../src/agent/tools");
const groupSignals = require("../src/data/group-signals");
const vivo = require("../src/groups/vivo");

function ctxAsesor(extra = {}) {
  return {
    org: { id: "org-1", name: "Diamond" },
    advisor: { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" },
    ...extra,
  };
}

test("la tool esta declarada", () => {
  const def = TOOL_DEFINITIONS.find((t) => t.name === "aprobar_pedido_radar");
  assert.ok(def, "aprobar_pedido_radar debe estar en TOOL_DEFINITIONS");
});

test("sin advisor en el contexto (es un cliente) no aplica", async () => {
  const out = await executeTool("aprobar_pedido_radar", {}, { org: { id: "org-1" }, advisor: null });
  assert.match(out, /No aplica/);
});

test("con radarSignalId resuelto por cita (swipe-to-reply), publica directo sin preguntar", async (t) => {
  let sePreguntoPendientes = false;
  t.mock.method(groupSignals, "pendientesDeAviso", async () => { sePreguntoPendientes = true; return []; });
  let recibido = null;
  t.mock.method(vivo, "aprobarManual", async (org, signalId) => {
    recibido = { org, signalId };
    return { resultado: "publicado", texto: "Hola Camilo..." };
  });

  const out = await executeTool("aprobar_pedido_radar", {}, ctxAsesor({ radarSignalId: "sig-citada" }));

  assert.strictEqual(sePreguntoPendientes, false);
  assert.strictEqual(recibido.signalId, "sig-citada");
  assert.strictEqual(recibido.org.id, "org-1");
  assert.match(out, /publicado/);
  assert.match(out, /Hola Camilo/);
});

test("sin cita y sin pendientes, dice que no encuentra nada", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => []);
  const out = await executeTool("aprobar_pedido_radar", {}, ctxAsesor());
  assert.match(out, /No encuentro ningun pedido/);
});

test("un solo pendiente: lo resuelve solo y llama a aprobarManual con ese id", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async (orgId, advisorId) => {
    assert.strictEqual(advisorId, "adv-natalia");
    return [{ id: "sig-unico", texto_original: "busco apto en Loma de los Bernal" }];
  });
  let recibido = null;
  t.mock.method(vivo, "aprobarManual", async (org, signalId) => {
    recibido = signalId;
    return { resultado: "publicado", texto: "texto" };
  });

  const out = await executeTool("aprobar_pedido_radar", {}, ctxAsesor());

  assert.strictEqual(recibido, "sig-unico");
  assert.match(out, /publicado/);
});

test("varios pendientes sin especificar cual: lista y pregunta, no adivina ni publica", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-a", texto_original: "busco apto en Sabaneta" },
    { id: "sig-b", texto_original: "busco casa en Envigado" },
  ]);
  let sePublico = false;
  t.mock.method(vivo, "aprobarManual", async () => { sePublico = true; return { resultado: "publicado" }; });

  const out = await executeTool("aprobar_pedido_radar", {}, ctxAsesor());

  assert.strictEqual(sePublico, false);
  assert.match(out, /Tenes 2 pedidos/);
  assert.match(out, /Sabaneta/);
});

test("varios pendientes CON 'cual' que desambigua: resuelve el que matchea", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [
    { id: "sig-a", texto_original: "busco apto en Sabaneta" },
    { id: "sig-b", texto_original: "busco casa en Envigado" },
  ]);
  let recibido = null;
  t.mock.method(vivo, "aprobarManual", async (org, signalId) => { recibido = signalId; return { resultado: "publicado", texto: "x" }; });

  await executeTool("aprobar_pedido_radar", { cual: "envigado" }, ctxAsesor());

  assert.strictEqual(recibido, "sig-b");
});

test("si aprobarManual dice que ya no pasa la compuerta, lo dice sin fingir que publico", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [{ id: "sig-x", texto_original: "x" }]);
  t.mock.method(vivo, "aprobarManual", async () => ({ resultado: "sin_propiedades_publicables" }));

  const out = await executeTool("aprobar_pedido_radar", {}, ctxAsesor());
  assert.match(out, /ya no pasa la compuerta/);
});

test("si el envio falla, lo dice sin tumbar la conversacion", async (t) => {
  t.mock.method(groupSignals, "pendientesDeAviso", async () => [{ id: "sig-x", texto_original: "x" }]);
  t.mock.method(vivo, "aprobarManual", async () => ({ resultado: "error_envio", error: "sesion caida" }));

  const out = await executeTool("aprobar_pedido_radar", {}, ctxAsesor());
  assert.match(out, /El envio fallo/);
  assert.match(out, /sesion caida/);
});

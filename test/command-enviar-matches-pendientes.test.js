// enviar_matches_pendientes_equipo (Sofi-Comando, admin-only): arma y manda
// el resumen de matches pendientes de un asesor con el dato REAL de
// trazabilidad_radar — no deja que el modelo redacte el mensaje, que fue
// justo lo que fallo el 2026-08-18 (link inventado, ver validar-mensaje.test.js).

const { test } = require("node:test");
const assert = require("node:assert");
const { executeCommandTool } = require("../src/agent/sofi-comando-tools");
const advisors = require("../src/data/advisors");
const organizations = require("../src/data/organizations");
const radarTrazabilidad = require("../src/data/radar-trazabilidad");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

function adminScope() {
  return Object.freeze({ orgId: "org-1", viewerUid: "admin-1", role: "admin", isAdmin: true });
}

const SEÑAL_PENDIENTE = {
  colega: "Liliana Giraldo",
  grupo: "PEDIDOS INMOBILIARIOS",
  pidio: "Busco apto en Loma de los Bernal, $600M",
  motor: { detalle: [{ ref: "10013037", zona: "San Joaquín", precio: "$500.000.000" }] },
  sofi: { aprobo: true, refs: ["10013037"] },
  contacto_wa: "https://wa.me/573001111111",
  aviso: { salio: true, para: { nombre: "Catherine Uribe", telefono: "573028536489" } },
  resultado: null,
};

test("sin nombre de asesor, no consulta nada", async () => {
  const out = await executeCommandTool("enviar_matches_pendientes_equipo", {}, { scope: adminScope(), session: null });
  assert.match(out, /Me falta el nombre/);
});

test("asesor inexistente, lo dice sin inventar", async (t) => {
  t.mock.method(advisors, "searchByName", async () => []);
  const out = await executeCommandTool("enviar_matches_pendientes_equipo", { asesor: "Nadie" }, { scope: adminScope(), session: null });
  assert.match(out, /No encuentro ningun asesor/);
});

test("nombre ambiguo, pregunta cual sin consultar el radar", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Danna Ospina" }, { name: "Danna Ospina" }]);
  let seConsulto = false;
  t.mock.method(radarTrazabilidad, "trazabilidad", async () => { seConsulto = true; return { disponible: true, señales: [] }; });

  const out = await executeCommandTool("enviar_matches_pendientes_equipo", { asesor: "Danna" }, { scope: adminScope(), session: null });

  assert.strictEqual(seConsulto, false);
  assert.match(out, /Hay 2 asesores/);
});

test("filtra SOLO los pendientes de ESE asesor — no le manda los de otro", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Catherine Uribe", phone: "573028536489" }]);
  t.mock.method(radarTrazabilidad, "trazabilidad", async () => ({
    disponible: true,
    señales: [
      SEÑAL_PENDIENTE,
      { ...SEÑAL_PENDIENTE, colega: "Otro Colega", aviso: { salio: true, para: { nombre: "Natalia Velez" } } },
      { ...SEÑAL_PENDIENTE, colega: "Ya resuelto", resultado: { tipo: "CIERRE" } },
      { ...SEÑAL_PENDIENTE, colega: "Rechazado", sofi: { aprobo: false, refs: [] } },
    ],
  }));
  t.mock.method(organizations, "findById", async (orgId) => ({ id: orgId, name: "Diamond" }));
  let enviado = null;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, to, texto) => { enviado = { to, texto }; return { ok: true }; });

  const out = await executeCommandTool("enviar_matches_pendientes_equipo", { asesor: "Catherine" }, { scope: adminScope(), session: null });

  assert.strictEqual(enviado.to, "573028536489");
  assert.match(enviado.texto, /Liliana Giraldo/);
  assert.doesNotMatch(enviado.texto, /Otro Colega/, "no debe mezclar pendientes de Natalia");
  assert.doesNotMatch(enviado.texto, /Ya resuelto/, "los que ya tienen resultado no son 'pendientes'");
  assert.doesNotMatch(enviado.texto, /Rechazado/, "lo que Sofi rechazo no tiene nada que ofrecer");
  assert.match(out, /Listo, le mande a Catherine Uribe el resumen de 1 pedido pendiente/);
});

test("sin nada pendiente, lo dice y no manda nada", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Catherine Uribe", phone: "573028536489" }]);
  t.mock.method(radarTrazabilidad, "trazabilidad", async () => ({ disponible: true, señales: [] }));
  let seEnvio = false;
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => { seEnvio = true; return { ok: true }; });

  const out = await executeCommandTool("enviar_matches_pendientes_equipo", { asesor: "Catherine" }, { scope: adminScope(), session: null });

  assert.strictEqual(seEnvio, false);
  assert.match(out, /no tiene matches pendientes/);
});

test("si trazabilidad_radar no esta disponible, lo dice en vez de fallar", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Catherine Uribe", phone: "573028536489" }]);
  t.mock.method(radarTrazabilidad, "trazabilidad", async () => ({ disponible: false, motivo: "sin base de datos" }));

  const out = await executeCommandTool("enviar_matches_pendientes_equipo", { asesor: "Catherine" }, { scope: adminScope(), session: null });

  assert.match(out, /No pude consultar el radar/);
});

test("ventana de 24h cerrada: lo dice, no finge que salio", async (t) => {
  t.mock.method(advisors, "searchByName", async () => [{ name: "Catherine Uribe", phone: "573028536489" }]);
  t.mock.method(radarTrazabilidad, "trazabilidad", async () => ({ disponible: true, señales: [SEÑAL_PENDIENTE] }));
  t.mock.method(organizations, "findById", async (orgId) => ({ id: orgId, name: "Diamond" }));
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => ({ ok: false, error: "ventana cerrada" }));

  const out = await executeCommandTool("enviar_matches_pendientes_equipo", { asesor: "Catherine" }, { scope: adminScope(), session: null });

  assert.match(out, /No se pudo enviar/);
});

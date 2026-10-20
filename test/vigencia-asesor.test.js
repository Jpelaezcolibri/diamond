const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const vigencia = require("../src/scheduler/vigencia-asesor");
const boton = require("../src/lib/vigencia-asesor");
const datos = require("../src/data/propiedades-asesor");
const advisors = require("../src/data/advisors");
const mensajeAsesor = require("../src/lib/mensaje-asesor");

const ORG = { id: "org-1", name: "Diamond" };
const ADV = { id: "adv-1", name: "Daiana", phone: "573011880668" };
const LUNES_10AM = new Date("2026-10-19T15:00:00Z");

function deps(over = {}) {
  const log = { textos: [], plantillas: [], preguntadas: [], bajas: [] };
  return {
    log,
    d: {
      orgs: async () => [ORG],
      porPreguntar: async () => [],
      vencidas: async () => [],
      advisor: async () => ADV,
      enviarTexto: async (org, tel, texto, opts) => { log.textos.push({ tel, texto, opts }); return { ok: true }; },
      enviarPlantilla: async (org, tel, p) => { log.plantillas.push(p); return { ok: true }; },
      marcarPreguntada: async (id) => log.preguntadas.push(id),
      darDeBaja: async (id) => log.bajas.push(id),
      ...over,
    },
  };
}

beforeEach(() => { delete process.env.SOFI_VIGENCIA_ASESOR; });

test("pregunta una vez con botones vig: si la ventana esta abierta", async () => {
  const { d, log } = deps({ porPreguntar: async () => [{ id: "p1", ref: "D1001", titulo: "Casa en venta en Belén", captador_id: "adv-1" }] });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(log.textos.length, 1);
  assert.match(log.textos[0].texto, /D1001/);
  assert.deepEqual(log.textos[0].opts.botones.map((b) => b.id), ["vig:si:D1001", "vig:no:D1001"]);
  assert.deepEqual(log.preguntadas, ["p1"]);
});

test("ventana cerrada: usa la plantilla vigencia_propiedad", async () => {
  const { d, log } = deps({
    porPreguntar: async () => [{ id: "p1", ref: "D1001", titulo: "Casa", captador_id: "adv-1" }],
    enviarTexto: async () => ({ ok: false, error: "Re-engagement message: more than 24 hours" }),
  });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(log.plantillas[0].name, "vigencia_propiedad");
  assert.deepEqual(log.plantillas[0].buttonPayloads, ["vig:si:D1001", "vig:no:D1001"]);
  assert.deepEqual(log.preguntadas, ["p1"]);
});

test("vencida: sale del inventario aunque la pregunta este apagada", async () => {
  process.env.SOFI_VIGENCIA_ASESOR = "false";
  const { d, log } = deps({
    porPreguntar: async () => [{ id: "p1", ref: "D1001", captador_id: "adv-1" }],
    vencidas: async () => [{ id: "p2", ref: "D1002", captador_id: "adv-1" }],
  });
  await vigencia.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.deepEqual(log.bajas, ["p2"]);
  assert.equal(log.preguntadas.length, 0);
});

test("fuera de 9 a. m. a 6 p. m. no pregunta", async () => {
  const { d, log } = deps({ porPreguntar: async () => [{ id: "p1", ref: "D1001", captador_id: "adv-1" }] });
  await vigencia.runOnce({ ahora: new Date("2026-10-19T12:00:00Z"), deps: d }); // 7 a. m.
  assert.equal(log.textos.length, 0);
});

test("boton vig:no da de baja la del asesor y le confirma", async (t) => {
  t.mock.method(advisors, "findByPhone", async () => ADV);
  const aplicar = t.mock.method(datos, "aplicarVigencia", async () => ({ estado: "baja", ref: "D1001" }));
  const envios = [];
  t.mock.method(mensajeAsesor, "enviarYRegistrar", async (org, tel, texto) => { envios.push(texto); return { ok: true }; });
  await boton.procesarBotonVigencia(ORG, ADV.phone, "vig:no:D1001");
  assert.deepEqual(aplicar.mock.calls[0].arguments, ["org-1", "adv-1", "D1001", false]);
  assert.match(envios[0], /sale del inventario/);
});

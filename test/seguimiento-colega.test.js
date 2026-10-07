// Seguimiento al colega (Juan, 2026-10-07): +4 h despues del DM del radar, si
// no toco ningun link ni respondio. Con telefono, plantilla por la linea
// oficial; con solo lid, un texto por la linea de grupos con tope diario.
const { test } = require("node:test");
const assert = require("node:assert");
const s = require("../src/scheduler/seguimiento-colega");

const base = { respondio: false, soloLlamada: false, telefono: null, topeOk: true, cuotaOk: true };

test("con teléfono sale la plantilla por la línea oficial", () => {
  assert.strictEqual(s.decidirSeguimientoDm({ ...base, telefono: "573125550000" }), "plantilla");
});

test("solo con lid sale por la línea de grupos, si hay tope y cuota", () => {
  assert.strictEqual(s.decidirSeguimientoDm(base), "linea_grupos");
  assert.strictEqual(s.decidirSeguimientoDm({ ...base, topeOk: false }), "tope");
  assert.strictEqual(s.decidirSeguimientoDm({ ...base, cuotaOk: false }), "cuota");
});

test("si respondió o es solo llamada, no sale nada", () => {
  assert.strictEqual(s.decidirSeguimientoDm({ ...base, telefono: "573125550000", respondio: true }), "no_hizo_falta");
  assert.strictEqual(s.decidirSeguimientoDm({ ...base, telefono: "573125550000", soloLlamada: true }), "solo_llamada");
  assert.strictEqual(s.decidirSeguimientoDm({ ...base, soloLlamada: null }), "solo_llamada", "si no se pudo saber, no se escribe");
});

test("el texto por la línea de grupos lleva el link a Sofi con el código", () => {
  const antes = process.env.CONTACT_WHATSAPP_NUMBER;
  process.env.CONTACT_WHATSAPP_NUMBER = "573009998877";
  try {
    const t = s.textoLineaGrupos({ autor_nombre: "Laura Gómez", codigo_colega: "D7K2" }, null);
    assert.match(t, /^Hola Laura, ¿te sirvió alguna de las opciones que te mandé\?/);
    assert.match(t, /https:\/\/wa\.me\/573009998877\?text=\S+D7K2/);
    assert.match(t, /— Sofi, asistente virtual$/);
  } finally {
    if (antes === undefined) delete process.env.CONTACT_WHATSAPP_NUMBER;
    else process.env.CONTACT_WHATSAPP_NUMBER = antes;
  }
});

test("runOnce: de noche no corre", async () => {
  let llamado = false;
  const r = await s.runOnce({ ahora: new Date("2026-10-09T03:00:00Z"), deps: { listar: async () => { llamado = true; return []; } } });
  assert.strictEqual(llamado, false);
  assert.deepStrictEqual(r, { dm: 0, sofi24: 0, noche: true });
});

test("runOnce: manda y marca cada señal por su canal", async () => {
  const marcas = [];
  const enviados = [];
  const deps = {
    org: async () => ({ id: "org-1", name: "Diamond" }),
    listar: async () => [
      { id: "s1", autor_nombre: "Laura", respuesta_destino_telefono: "573125550000", respuesta_destino_lid: "111@lid", codigo_colega: "D7K2", tipo: "apartamento", zona: "Laureles" },
      { id: "s2", autor_nombre: "Pedro", respuesta_destino_lid: "222@lid", codigo_colega: "ABCD" },
    ],
    respondio: async () => false,
    soloLlamada: async () => false,
    telefonoDe: async (senal) => senal.respuesta_destino_telefono || null,
    contarHoy: async () => 0,
    cuota: async () => ({ fraccion: 0.1 }),
    sesion: async () => "DaianaDiamond",
    plantilla: async (_o, to, opts) => { enviados.push({ to, plantilla: opts.name, params: opts.bodyParams }); return { ok: true }; },
    linea: async (sesion, _t, texto, { lid }) => { enviados.push({ sesion, lid, texto }); return { ok: true }; },
    marcar: async (id, canal) => marcas.push({ id, canal }),
    listarSofi24: async () => [],
  };
  const r = await s.runOnce({ ahora: new Date("2026-10-08T15:00:00Z"), deps });
  assert.deepStrictEqual(marcas, [{ id: "s1", canal: "plantilla" }, { id: "s2", canal: "linea_grupos" }]);
  assert.strictEqual(enviados[0].plantilla, "seguimiento_colega");
  assert.deepStrictEqual(enviados[0].params, ["Laura", "apartamento en Laureles"]);
  assert.strictEqual(enviados[1].lid, "222@lid");
  assert.strictEqual(r.dm, 2);
});

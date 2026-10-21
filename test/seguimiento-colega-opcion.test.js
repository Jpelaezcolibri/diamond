// Seguimiento al colega con una opcion nueva (spec 2026-10-21 §2.5). En el
// toque de +4 h por la linea, con RADAR_SEGUIMIENTO_CON_OPCION=true, se vuelve
// a correr el motor y se agrega UNA ficha corta si hay algo que el colega no
// recibio. Si no se puede saber que se le mando, no se agrega nada.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const s = require("../src/scheduler/seguimiento-colega");
const redactar = require("../src/groups/redactar");

const VOSEO = /\b(escribile|decime|querés|podés|pedíselas?|pedísela|contame|mirá|fijate|tenés|sabés|confirmame)\b/i;
const AHORA = new Date("2026-10-08T15:00:00Z");

function prop(ref, extra = {}) {
  return {
    fuente: "diamond",
    ref,
    titulo: "Apartamento en Venta Envigado - Cerca al Metro",
    zona: "Centro, Envigado",
    precio: "$395.000.000",
    operacion: "Venta",
    link: `https://diamondinmobiliaria.com/propiedades/apartamento-${ref}`,
    linkWasi: `https://info.wasi.co/apartamento-venta-envigado-centro/${ref}`,
    habitaciones: 2,
    area: "62m2",
    puntaje: 88,
    ubicacion: "exacta",
    ...extra,
  };
}

const SENAL = { id: "s2", autor_nombre: "Pedro Ruiz", respuesta_destino_lid: "222@lid", codigo_colega: "ABCD", tipo: "apartamento", zona: "Envigado" };

function deps(extra = {}) {
  const enviados = [];
  const marcas = [];
  const refsAgregadas = [];
  const d = {
    org: async () => ({ id: "org-1", name: "Diamond" }),
    listar: async () => [SENAL],
    respondio: async () => false,
    soloLlamada: async () => false,
    telefonoDe: async () => null,
    contarHoy: async () => 0,
    cuota: async () => ({ fraccion: 0.1 }),
    sesion: async () => "DaianaDiamond",
    plantilla: async () => ({ ok: true }),
    linea: async (_s, _t, texto, { lid }) => { enviados.push({ lid, texto }); return { ok: true }; },
    marcar: async (id, canal) => marcas.push({ id, canal }),
    listarSofi24: async () => [],
    senalCompleta: async () => ({ ...SENAL, operacion: "venta", respuesta_refs: ["9000001"] }),
    cruzar: async () => [prop("9000001"), prop("9000002", { puntaje: 90 }), prop("9000003", { puntaje: 80 })],
    estadoInventario: async () => ({ fresco: true }),
    verificarLinks: async (ms) => ({ verificadas: ms, rotas: [] }),
    refsYaEnviadas: async () => new Set(["9000001"]),
    agregarRef: async (senal, ref) => refsAgregadas.push({ id: senal.id, ref: String(ref), antes: senal.respuesta_refs }),
    ...extra,
  };
  return { d, enviados, marcas, refsAgregadas };
}

let antes;
beforeEach(() => {
  antes = { opcion: process.env.RADAR_SEGUIMIENTO_CON_OPCION, num: process.env.CONTACT_WHATSAPP_NUMBER, acl: process.env.RADAR_DM_CON_ACLARACION };
  process.env.CONTACT_WHATSAPP_NUMBER = "573009998877";
  process.env.RADAR_SEGUIMIENTO_CON_OPCION = "true";
  delete process.env.RADAR_DM_CON_ACLARACION;
});
afterEach(() => {
  for (const [k, v] of [["RADAR_SEGUIMIENTO_CON_OPCION", antes.opcion], ["CONTACT_WHATSAPP_NUMBER", antes.num], ["RADAR_DM_CON_ACLARACION", antes.acl]]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("con opción nueva: el texto agrega UNA ficha corta y la ref queda en respuesta_refs", async () => {
  const { d, enviados, marcas, refsAgregadas } = deps();
  const r = await s.runOnce({ ahora: AHORA, deps: d });
  assert.strictEqual(r.dm, 1);
  assert.deepStrictEqual(marcas, [{ id: "s2", canal: "linea_grupos" }]);
  const t = enviados[0].texto;
  assert.match(t, /^Hola Pedro, ¿te sirvió alguna de las opciones que te mandé\?\n\nAdemás encontré esta otra que se ajusta a tu pedido:\n/);
  assert.match(t, /Ref 9000002 · Centro, Envigado · \$395\.000\.000/);
  assert.match(t, /https:\/\/info\.wasi\.co\/apartamento-venta-envigado-centro\/9000002/);
  assert.doesNotMatch(t, /9000003/, "una sola opción");
  assert.doesNotMatch(t, /9000001/, "la que ya tenía la señal no vuelve");
  assert.match(t, /Si quieres más opciones o tienes alguna duda, escríbele a Sofi 👉 https:\/\/wa\.me\/573009998877/);
  assert.match(t, /— Sofi, asistente virtual$/);
  assert.doesNotMatch(t, VOSEO);
  assert.deepStrictEqual(refsAgregadas, [{ id: "s2", ref: "9000002", antes: ["9000001"] }]);
});

test("una ref que se le mandó en 7 días por otro pedido se salta", async () => {
  const { d, enviados, refsAgregadas } = deps({ refsYaEnviadas: async () => new Set(["9000001", "9000002"]) });
  await s.runOnce({ ahora: AHORA, deps: d });
  assert.match(enviados[0].texto, /Ref 9000003/);
  assert.doesNotMatch(enviados[0].texto, /9000002/);
  assert.deepStrictEqual(refsAgregadas.map((x) => x.ref), ["9000003"]);
});

test("sin opción nueva el texto queda como hoy", async () => {
  const hoy = s.textoLineaGrupos(SENAL, null);
  const { d, enviados, refsAgregadas } = deps({ refsYaEnviadas: async () => new Set(["9000001", "9000002", "9000003"]) });
  await s.runOnce({ ahora: AHORA, deps: d });
  assert.strictEqual(enviados[0].texto, hoy);
  assert.deepStrictEqual(refsAgregadas, []);
});

test("si no se puede saber qué se le mandó (lookup falla), no se agrega opción", async () => {
  for (const refsYaEnviadas of [async () => null, async () => { throw new Error("caida"); }]) {
    const { d, enviados, marcas, refsAgregadas } = deps({ refsYaEnviadas });
    await s.runOnce({ ahora: AHORA, deps: d });
    assert.strictEqual(enviados[0].texto, s.textoLineaGrupos(SENAL, null));
    assert.strictEqual(marcas.length, 1, "el seguimiento igual sale");
    assert.deepStrictEqual(refsAgregadas, []);
  }
});

test("si falla leer la señal o el motor, sale el texto de hoy", async () => {
  for (const extra of [{ senalCompleta: async () => { throw new Error("x"); } }, { cruzar: async () => { throw new Error("x"); } }]) {
    const { d, enviados } = deps(extra);
    await s.runOnce({ ahora: AHORA, deps: d });
    assert.strictEqual(enviados[0].texto, s.textoLineaGrupos(SENAL, null));
  }
});

test("la compuerta manda: inventario viejo o link roto, sin opción", async () => {
  for (const extra of [
    { estadoInventario: async () => ({ fresco: false }) },
    { verificarLinks: async (ms) => ({ verificadas: [], rotas: ms }) },
    { cruzar: async () => [prop("9000002", { fuente: "aliado" })] },
  ]) {
    const { d, enviados } = deps(extra);
    await s.runOnce({ ahora: AHORA, deps: d });
    assert.strictEqual(enviados[0].texto, s.textoLineaGrupos(SENAL, null));
  }
});

test("la ref se reserva ANTES de enviar; si no se puede guardar, sale el texto de hoy", async () => {
  const orden = [];
  const base = deps({
    agregarRef: async (_s, ref) => orden.push(`ref:${ref}`),
    linea: async (_s, _t, texto) => { orden.push("envio"); return { ok: true }; },
  });
  await s.runOnce({ ahora: AHORA, deps: base.d });
  assert.deepStrictEqual(orden, ["ref:9000002", "envio"]);

  const { d, enviados, marcas } = deps({ agregarRef: async () => { throw new Error("db"); } });
  const r = await s.runOnce({ ahora: AHORA, deps: d });
  assert.strictEqual(enviados[0].texto, s.textoLineaGrupos(SENAL, null));
  assert.deepStrictEqual(marcas, [{ id: "s2", canal: "linea_grupos" }]);
  assert.strictEqual(r.dm, 1);
});

test("lo que Sofi descartó en su veredicto no se ofrece; solo lo que aprobó o no vio", async () => {
  const rev = { refs_utiles: ["9000002"], refs_dudosas: ["9000003"], dudosas_motivo: [{ ref: "9000003", motivo: "zona" }] };
  const matches = [{ ref: "9000001" }, { ref: "9000002" }, { ref: "9000003" }, { ref: "9000004" }];
  const mk = (cruzados) => deps({
    senalCompleta: async () => ({ ...SENAL, operacion: "venta", respuesta_refs: ["9000001"], revalidacion: rev, matches }),
    cruzar: async () => cruzados,
  });
  // dudosa (9000003) y descartada (9000004 vista y no aprobada): nada
  let x = mk([prop("9000003", { puntaje: 95 }), prop("9000004", { puntaje: 95 })]);
  await s.runOnce({ ahora: AHORA, deps: x.d });
  assert.strictEqual(x.enviados[0].texto, s.textoLineaGrupos(SENAL, null));
  assert.deepStrictEqual(x.refsAgregadas, []);
  // la aprobada por Sofi sale aunque haya dudosas con mas puntaje
  x = mk([prop("9000003", { puntaje: 99 }), prop("9000002", { puntaje: 85 })]);
  await s.runOnce({ ahora: AHORA, deps: x.d });
  assert.match(x.enviados[0].texto, /Ref 9000002/);
  assert.doesNotMatch(x.enviados[0].texto, /Ref 9000003/);
});

test("cableado REAL: sin inyectar cruzar usa match.cruzar (un export faltante rompe el test)", async () => {
  const match = require("../src/groups/match");
  assert.strictEqual(typeof match.cruzar, "function");
  const original = match.cruzar;
  const llamadas = [];
  match.cruzar = async (demandas, opts) => {
    llamadas.push({ demandas, opts });
    return { demandas: [{ matches: [prop("9000001"), prop("9000002")] }] };
  };
  try {
    const { d, enviados } = deps();
    delete d.cruzar;
    await s.runOnce({ ahora: AHORA, deps: d });
    assert.strictEqual(llamadas.length, 1);
    assert.strictEqual(llamadas[0].demandas[0].clase, "demanda");
    assert.match(enviados[0].texto, /Ref 9000002/);
  } finally {
    match.cruzar = original;
  }
});

test("interruptor apagado: idéntico a hoy y no se corre el motor", async () => {
  delete process.env.RADAR_SEGUIMIENTO_CON_OPCION;
  let llamadas = 0;
  const contar = (fn) => async (...a) => { llamadas++; return fn(...a); };
  const base = deps().d;
  const { d, enviados, refsAgregadas } = deps({
    senalCompleta: contar(base.senalCompleta),
    cruzar: contar(base.cruzar),
    refsYaEnviadas: contar(base.refsYaEnviadas),
  });
  await s.runOnce({ ahora: AHORA, deps: d });
  assert.strictEqual(enviados[0].texto, s.textoLineaGrupos(SENAL, null));
  assert.strictEqual(llamadas, 0);
  assert.deepStrictEqual(refsAgregadas, []);
  assert.strictEqual(s.conOpcionActivo({}), false);
  assert.strictEqual(s.conOpcionActivo({ RADAR_SEGUIMIENTO_CON_OPCION: "true" }), true);
});

test("con teléfono sale la plantilla de siempre, sin buscar opción", async () => {
  let cruzo = false;
  const { d } = deps({
    listar: async () => [{ ...SENAL, respuesta_destino_telefono: "573125550000" }],
    telefonoDe: async (x) => x.respuesta_destino_telefono,
    cruzar: async () => { cruzo = true; return []; },
  });
  const enviadas = [];
  d.plantilla = async (_o, to, opts) => { enviadas.push(opts); return { ok: true }; };
  await s.runOnce({ ahora: AHORA, deps: d });
  assert.strictEqual(enviadas[0].name, "seguimiento_colega");
  assert.strictEqual(cruzo, false);
});

test("con aclaración encendida, la ficha corta lleva la aclaración", async () => {
  process.env.RADAR_DM_CON_ACLARACION = "true";
  const { d, enviados } = deps({ cruzar: async () => [prop("9000004", { garajes_sin_dato: true })] });
  await s.runOnce({ ahora: AHORA, deps: d });
  assert.match(enviados[0].texto, /Ref 9000004/);
  assert.match(enviados[0].texto, /\nAclaración: .+\nhttps:\/\/info\.wasi\.co/);
  assert.doesNotMatch(enviados[0].texto, VOSEO);
});

test("fichaCorta: lo no cargado no aparece", () => {
  const t = redactar.fichaCorta({ ref: "123", titulo: "Casa", zona: "", precio: null, linkWasi: "https://info.wasi.co/x/123" });
  assert.strictEqual(t, "Casa\nRef 123\nhttps://info.wasi.co/x/123");
});

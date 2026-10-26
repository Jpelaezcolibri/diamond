// Script de rescate de pedidos sin DM (2026-10-20). Todo con dependencias
// inyectadas: ningun test sale a Supabase ni a WAHA.

const { test } = require("node:test");
require("./helpers/interruptores-dm").apagadosEnCadaTest();
const assert = require("node:assert");
const os = require("node:os");
const rescate = require("../scripts/rescate-pedidos");

const LID = "123456789012345";
const LID2 = "998877665544332";
const AHORA = new Date("2026-10-21T14:00:00Z"); // martes 9 a. m. Bogota

function ficha(extra = {}) {
  return {
    fuente: "diamond", ref: "AP1", titulo: "Apartamento en Venta Envigado",
    zona: "Envigado", precio: "$450.000.000", operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/ap1",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10416693",
    habitaciones: 3, area: "90m2", puntaje: 85, ubicacion: "exacta", ...extra,
  };
}

function senal(extra = {}) {
  return {
    id: "s1", org_id: "org1", clase: "demanda", autor_nombre: "Carlos Pérez", autor_telefono: LID,
    operacion: "venta", tipo: "apartamento", zona: "Envigado", precio_max: 500000000, habitaciones: 3,
    texto_original: "Busco apartamento en Envigado hasta 500 millones, 3 alcobas",
    created_at: "2026-10-20T13:00:00Z", fecha_mensaje: "2026-10-20T13:00:00Z",
    respondida_at: null, colega_escribio_at: null, matches: [], revalidacion: null, ...extra,
  };
}

function deps(over = {}) {
  const llamadas = { enviar: [], marcar: [], politica: [], dormir: [], json: [] };
  const d = {
    org: async () => ({ id: "org1", nombre: "Diamond" }),
    leerSenales: async () => [senal()],
    cruzar: async (_org, s) => [ficha({ ref: "A1", puntaje: 90 })],
    estadoInventario: async () => ({ fresco: true }),
    verificarLinks: async (ms) => ({ verificadas: ms, rotas: [] }),
    quitarYaEnviadas: async (_org, _dest, ms) => ({ quedan: ms, repetidas: [] }),
    telefonoDe: async () => null,
    esSoloLlamada: async () => false,
    codigo: async (_org, s, { aplicar }) => (aplicar ? "ABCD" : s.codigo_colega || null),
    sesionActiva: async () => "LINEA-1",
    cuotaDeLinea: async () => ({ usados: 50, total: 300, fraccion: 50 / 300 }),
    dmsHoyLinea: async () => 3,
    enviarAlColega: async (args) => {
      llamadas.enviar.push(args);
      const refs = args.mensajes.map((m) => m.ref).filter(Boolean);
      return { ok: true, completo: true, refsEnviadas: refs, faltantes: [], texto: args.mensajes.map((m) => m.texto).join("\n"), wamid: "w1" };
    },
    marcarRespondida: async (orgId, id, datos) => { llamadas.marcar.push({ id, ...datos }); return true; },
    guardarPolitica: async (orgId, id, datos) => { llamadas.politica.push({ id, ...datos }); return true; },
    dormir: async (ms) => { llamadas.dormir.push(ms); },
    rand: () => 0.5,
    ahora: () => AHORA,
    log: () => {},
    escribirJson: (archivo, datos) => { llamadas.json.push({ archivo, datos }); },
    ...over,
  };
  return { d, llamadas };
}

test("parsearArgs: horas, aplicar y solo", () => {
  assert.deepStrictEqual(rescate.parsearArgs([]), { horas: 24, aplicar: false, solo: null, salida: null });
  const a = rescate.parsearArgs(["--horas", "12", "--aplicar", "--solo", "a,b", "--salida", "x"]);
  assert.deepStrictEqual(a, { horas: 12, aplicar: true, solo: ["a", "b"], salida: "x" });
});

test("enmascarar deja solo los ultimos 4 digitos", () => {
  assert.strictEqual(rescate.enmascarar(LID), "…2345");
  assert.strictEqual(rescate.enmascarar(null), null);
});

test("seleccionar: solo demandas sin responder y sin que el colega haya escrito", () => {
  const s = rescate.seleccionar([
    senal({ id: "ok" }),
    senal({ id: "oferta", clase: "oferta" }),
    senal({ id: "resp", respondida_at: "2026-10-20T14:00:00Z" }),
    senal({ id: "escribio", colega_escribio_at: "2026-10-20T14:00:00Z" }),
  ]);
  assert.deepStrictEqual(s.map((x) => x.id), ["ok"]);
  assert.deepStrictEqual(rescate.seleccionar([senal({ id: "a" }), senal({ id: "b" })], ["b"]).map((x) => x.id), ["b"]);
});

test("agruparDuplicados: mismo colega y mismo pedido en 15 min es uno solo", () => {
  const g = rescate.agruparDuplicados([
    senal({ id: "a", fecha_mensaje: "2026-10-20T13:18:00Z" }),
    senal({ id: "b", fecha_mensaje: "2026-10-20T13:23:00Z", texto_original: "Busco apartamento en Envigado hasta 500 millones, 3 alcobas!!" }),
    senal({ id: "c", fecha_mensaje: "2026-10-20T13:50:00Z" }), // 32 min despues: otro
    senal({ id: "d", autor_telefono: LID2, fecha_mensaje: "2026-10-20T13:19:00Z" }), // otro colega
  ]);
  assert.deepStrictEqual(g.map((x) => [x.principal.id, x.duplicados.map((d) => d.id)]), [
    ["a", ["b"]],
    ["d", []],
    ["c", []],
  ]);
});

test("planificar: el colega que le pide mas opciones a Sofi por su codigo no es un pedido nuevo", async () => {
  const { d } = deps();
  const p = await rescate.planificar({ id: "org1" }, senal({ texto_original: "Hola Sofi, quiero más opciones para mi PEDIDO (cód. ABCD)" }), d, { ahora: AHORA });
  assert.strictEqual(p.sale, false);
  assert.strictEqual(p.motivo, "pedido_a_sofi");
});

test("planificar: exactas primero, despues las con aclaracion, y el texto exacto de cada mensaje", async () => {
  const { d } = deps({
    cruzar: async () => [
      ficha({ ref: "B1", puntaje: 95, piso_sin_confirmar: true }),
      ficha({ ref: "A1", puntaje: 80 }),
      ficha({ ref: "V1", puntaje: 99, ubicacion: "vecina" }),
    ],
  });
  const p = await rescate.planificar({ id: "org1" }, senal(), d, { ahora: AHORA });
  assert.strictEqual(p.sale, true);
  assert.deepStrictEqual(p.fichas.map((f) => f.ref), ["A1", "B1"]);
  assert.strictEqual(p.fichas[0].aclaracion, null);
  assert.match(p.fichas[1].aclaracion, /piso/);
  assert.strictEqual(p.motivoPolitica, "dm_con_aclaracion");
  assert.strictEqual(p.mensajes.length, 3);
  assert.match(p.mensajes[0].texto, /^Hola Carlos/);
  assert.match(p.mensajes[2].texto, /Aclaración:.*piso/);
  assert.deepStrictEqual(p.descartadas, [{ ref: "V1", motivos: ["zona_vecina"] }]);
  assert.strictEqual(p.destino, "lid …2345");
});

test("planificar: respeta el umbral normal de puntaje", async () => {
  const { d } = deps({ cruzar: async () => [ficha({ ref: "A1", puntaje: 60 })] });
  const p = await rescate.planificar({ id: "org1" }, senal(), d, { ahora: AHORA });
  assert.strictEqual(p.sale, false);
  assert.strictEqual(p.motivo, "puntaje_bajo");
});

test("planificar: lo que Sofi descarto (sin decir aliado) no sale; lo que nunca vio si", async () => {
  const { d } = deps({
    cruzar: async () => [ficha({ ref: "A1", puntaje: 90 }), ficha({ ref: "D1", puntaje: 88 }), ficha({ ref: "N1", puntaje: 86 }), ficha({ ref: "Q1", puntaje: 87 })],
  });
  const s = senal({
    matches: [{ ref: "A1" }, { ref: "D1" }, { ref: "Q1" }],
    revalidacion: {
      es_pedido_real: true, sirve_alguna: true, refs_utiles: ["A1"], refs_dudosas: ["Q1"],
      dudosas_motivo: [{ ref: "Q1", motivo: "dos_o_mas_incumplimientos_conocidos" }],
      por_que: "D1 tiene 2 alcobas", le_falta: [], sin_confirmar: [],
    },
  });
  const p = await rescate.planificar({ id: "org1" }, s, d, { ahora: AHORA });
  assert.deepStrictEqual(p.fichas.map((f) => f.ref), ["A1", "N1"]);
  assert.deepStrictEqual(p.excluidasPorSofi.map((e) => e.ref).sort(), ["D1", "Q1"]);
  assert.deepStrictEqual(p.sofi.refs_utiles, ["A1"]);
});

test("planificar: descarte de Sofi por 'aliado' no vale para una propia", async () => {
  const { d } = deps({ cruzar: async () => [ficha({ ref: "A1", puntaje: 100 })] });
  const s = senal({
    matches: [{ ref: "A1", puntaje: 100, fuente: "diamond" }],
    revalidacion: { es_pedido_real: true, sirve_alguna: false, refs_utiles: [], refs_dudosas: [], por_que: "Las tres son de aliados" },
  });
  const p = await rescate.planificar({ id: "org1" }, s, d, { ahora: AHORA });
  assert.strictEqual(p.sale, true);
  assert.deepStrictEqual(p.excluidasPorSofi, []);
});

test("planificar: Sofi dijo que no es un pedido real", async () => {
  const { d } = deps();
  const p = await rescate.planificar({ id: "org1" }, senal({ revalidacion: { es_pedido_real: false, refs_utiles: [] } }), d, { ahora: AHORA });
  assert.strictEqual(p.motivo, "sofi_no_es_pedido");
});

test("planificar: solo llamada, sin destino y ya enviadas no salen", async () => {
  let r = await rescate.planificar({ id: "org1" }, senal(), deps({ esSoloLlamada: async () => true }).d, { ahora: AHORA });
  assert.strictEqual(r.motivo, "colega_solo_llamada");
  r = await rescate.planificar({ id: "org1" }, senal({ autor_telefono: null }), deps().d, { ahora: AHORA });
  assert.strictEqual(r.motivo, "sin_destino");
  r = await rescate.planificar(
    { id: "org1" },
    senal(),
    deps({ quitarYaEnviadas: async (_o, _d, ms) => ({ quedan: [], repetidas: ms.map((m) => m.ref) }) }).d,
    { ahora: AHORA }
  );
  assert.strictEqual(r.motivo, "ya_se_le_mando");
});

test("planificar: el carril de arriendo exige su umbral", async () => {
  const { d } = deps({ cruzar: async () => [ficha({ ref: "A1", puntaje: 81, operacion: "Arriendo", precio: "$3.000.000" })] });
  const p = await rescate.planificar({ id: "org1" }, senal({ operacion: "arriendo" }), d, { ahora: AHORA });
  assert.strictEqual(p.sale, false);
  assert.strictEqual(p.motivo, "carril_umbral");
});

test("prueba en seco: no envia ni marca nada, y el JSON no lleva el lid crudo", async () => {
  const { d, llamadas } = deps({
    leerSenales: async () => [senal({ id: "a" }), senal({ id: "x", autor_telefono: null })],
  });
  const r = await rescate.ejecutar({ horas: 24, aplicar: false, solo: null, salida: os.tmpdir() }, d);
  assert.strictEqual(llamadas.enviar.length, 0);
  assert.strictEqual(llamadas.marcar.length, 0);
  assert.strictEqual(llamadas.politica.length, 0);
  assert.strictEqual(r.salen.length, 1);
  assert.strictEqual(r.noSalen.length, 1);
  assert.strictEqual(r.noSalen[0].motivo, "sin_destino");
  assert.strictEqual(llamadas.json.length, 1);
  assert.match(llamadas.json[0].archivo, /rescate-pedidos-2026-10-21\.json$/);
  const json = JSON.stringify(llamadas.json[0].datos);
  assert.ok(!json.includes(LID), "el JSON no puede llevar el lid completo");
  assert.match(json, /Hola Carlos/);
});

test("--aplicar: envia una vez por pedido duplicado, marca las dos senales y pausa entre colegas", async () => {
  const { d, llamadas } = deps({
    leerSenales: async () => [
      senal({ id: "a", fecha_mensaje: "2026-10-20T13:18:00Z" }),
      senal({ id: "b", fecha_mensaje: "2026-10-20T13:23:00Z" }),
      senal({ id: "c", autor_telefono: LID2, fecha_mensaje: "2026-10-20T13:30:00Z" }),
    ],
    cruzar: async () => [ficha({ ref: "A1", puntaje: 90 }), ficha({ ref: "B1", puntaje: 85, garajes_sin_dato: true })],
  });
  const r = await rescate.ejecutar({ horas: 24, aplicar: true, solo: null, salida: os.tmpdir() }, d);
  assert.strictEqual(llamadas.enviar.length, 2);
  assert.strictEqual(llamadas.enviar[0].sesion, "LINEA-1");
  assert.strictEqual(llamadas.enviar[0].lid, LID);
  assert.deepStrictEqual(llamadas.marcar.map((m) => m.id), ["a", "b", "c"]);
  assert.strictEqual(llamadas.marcar[0].modo, "auto");
  assert.strictEqual(llamadas.marcar[0].destinoLid, `${LID}@lid`);
  assert.deepStrictEqual(llamadas.marcar[0].refs, ["A1", "B1"]);
  assert.deepStrictEqual(llamadas.politica.map((p) => [p.id, p.motivo]), [
    ["a", "dm_con_aclaracion"],
    ["b", "dm_con_aclaracion"],
    ["c", "dm_con_aclaracion"],
  ]);
  assert.ok(llamadas.politica[1].traza.includes("duplicado_de:a"));
  // Una sola pausa entre colegas (la ultima no espera), entre 20 y 40 s.
  assert.deepStrictEqual(llamadas.dormir, [30000]);
  assert.strictEqual(r.enviados.length, 2);
  assert.strictEqual(r.detenido, null);
});

test("--aplicar: sin aclaraciones el motivo es ok", async () => {
  const { d, llamadas } = deps();
  await rescate.ejecutar({ horas: 24, aplicar: true, solo: null, salida: os.tmpdir() }, d);
  assert.deepStrictEqual(llamadas.politica.map((p) => p.motivo), ["ok"]);
});

test("--aplicar: para al primer error de WAHA y no marca esa senal", async () => {
  let n = 0;
  const { d, llamadas } = deps({
    leerSenales: async () => [senal({ id: "a" }), senal({ id: "c", autor_telefono: LID2, texto_original: "otro pedido distinto" })],
    enviarAlColega: async (args) => {
      n++;
      llamadas.enviar.push(args);
      return { ok: false, error: "waha_500", previoAlEnvio: true, refsEnviadas: [], faltantes: ["A1"] };
    },
  });
  const r = await rescate.ejecutar({ horas: 24, aplicar: true, solo: null, salida: os.tmpdir() }, d);
  assert.strictEqual(n, 1);
  assert.strictEqual(llamadas.marcar.length, 0);
  assert.deepStrictEqual(r.detenido, { id: "a", motivo: "error_waha", error: "waha_500" });
});

test("--aplicar: fuera de horario, sin sesion unica o con la cuota alta no envia", async () => {
  for (const [over, motivo] of [
    [{ ahora: () => new Date("2026-10-21T02:00:00Z") }, "fuera_de_horario"],
    [{ ahora: () => new Date("2026-10-25T15:00:00Z") }, "fuera_de_horario"], // domingo
    [{ sesionActiva: async () => null }, "sin_sesion_activa"],
    [{ cuotaDeLinea: async () => ({ usados: 250, total: 300, fraccion: 250 / 300 }) }, "cuota_whatsapp_alta"],
    [{ cuotaDeLinea: async () => null }, "cuota_no_verificable"],
    [{ dmsHoyLinea: async () => 150 }, "limite_linea_alcanzado"],
  ]) {
    const { d, llamadas } = deps(over);
    const r = await rescate.ejecutar({ horas: 24, aplicar: true, solo: null, salida: os.tmpdir() }, d);
    assert.strictEqual(llamadas.enviar.length, 0, motivo);
    assert.strictEqual(r.detenido && r.detenido.motivo, motivo);
  }
});

const APLICAR = { horas: 24, aplicar: true, solo: null, salida: os.tmpdir() };

test("--aplicar: si marcarRespondida devuelve false tras enviar, para con marcado_fallido y no sigue", async () => {
  const { d, llamadas } = deps({
    leerSenales: async () => [senal({ id: "a" }), senal({ id: "c", autor_telefono: LID2, texto_original: "otro pedido distinto" })],
    marcarRespondida: async () => false,
  });
  const r = await rescate.ejecutar(APLICAR, d);
  assert.strictEqual(llamadas.enviar.length, 1);
  assert.strictEqual(r.detenido.motivo, "marcado_fallido");
  assert.strictEqual(r.detenido.id, "a");
});

test("--aplicar: marcarRespondida que lanza tambien es marcado_fallido, y guardarPolitica que lanza no salta los duplicados", async () => {
  const marcadas = [];
  const { d } = deps({
    leerSenales: async () => [senal({ id: "a", fecha_mensaje: "2026-10-20T13:18:00Z" }), senal({ id: "b", fecha_mensaje: "2026-10-20T13:23:00Z" })],
    marcarRespondida: async (_o, id) => { marcadas.push(id); return true; },
    guardarPolitica: async () => { throw new Error("db"); },
  });
  const r = await rescate.ejecutar(APLICAR, d);
  assert.deepStrictEqual(marcadas, ["a", "b"]);
  assert.strictEqual(r.detenido, null);
  const { d: d2 } = deps({ marcarRespondida: async () => { throw new Error("db"); } });
  assert.strictEqual((await rescate.ejecutar(APLICAR, d2)).detenido.motivo, "marcado_fallido");
});

test("planificar: si no se puede verificar lo ya enviado en 7 dias, el pedido no sale", async () => {
  for (const over of [
    { quitarYaEnviadas: async () => { throw new Error("db"); } },
    { quitarYaEnviadas: async () => null },
  ]) {
    const p = await rescate.planificar({ id: "org1" }, senal(), deps(over).d, { ahora: AHORA });
    assert.strictEqual(p.sale, false);
    assert.strictEqual(p.motivo, "ya_enviadas_no_verificable");
  }
});

test("--aplicar: entrega desconocida del primer mensaje se anota en la señal y para la corrida", async () => {
  const { d, llamadas } = deps({
    leerSenales: async () => [senal({ id: "a", fecha_mensaje: "2026-10-20T13:18:00Z" }), senal({ id: "b", fecha_mensaje: "2026-10-20T13:23:00Z" }), senal({ id: "c", autor_telefono: LID2, texto_original: "otro", fecha_mensaje: "2026-10-20T14:30:00Z" })],
    enviarAlColega: async (args) => { llamadas.enviar.push(args); return { ok: false, error: "timeout 573001234567", previoAlEnvio: false, refsEnviadas: [], faltantes: [] }; },
  });
  const r = await rescate.ejecutar(APLICAR, d);
  assert.strictEqual(llamadas.enviar.length, 1);
  assert.strictEqual(llamadas.marcar.length, 0);
  assert.deepStrictEqual(llamadas.politica.map((p) => [p.id, p.motivo]), [["a", "rescate_estado_desconocido"], ["b", "rescate_estado_desconocido"]]);
  assert.strictEqual(r.detenido.motivo, "rescate_estado_desconocido");
  assert.ok(!JSON.stringify(r.detenido).includes("573001234567"), "error enmascarado");
});

test("seleccionar: salta las señales con rescate_estado_desconocido", () => {
  const s = rescate.seleccionar([senal({ id: "x", politica_motivo: "rescate_estado_desconocido" }), senal({ id: "y" })]);
  assert.deepStrictEqual(s.map((q) => q.id), ["y"]);
  assert.strictEqual(rescate.mascararTexto("Destino invalido: 573001234567 y 12"), "Destino invalido: …4567 y 12");
});

test("arranque: imprime los frenos efectivos", async () => {
  const lineas = [];
  const { d } = deps({ log: (...a) => lineas.push(a.join(" ")), frenosEfectivos: () => ({ cuota_max: 0.8, horario: "L-S" }) });
  await rescate.ejecutar({ horas: 24, aplicar: false, solo: null, salida: os.tmpdir() }, d);
  assert.ok(lineas.some((l) => /Frenos efectivos: cuota_max=0.8 · horario=L-S/.test(l)));
});

// ── Revision final (2026-10-20) ──

test("87203925: 'Las dos de aliados no se ofrecen' con Sofi aprobando otra: la propia descartada NO vuelve", async () => {
  const { d } = deps({
    cruzar: async () => [ficha({ ref: "A1", puntaje: 90 }), ficha({ ref: "P2", puntaje: 100 })],
  });
  const s = senal({
    matches: [{ ref: "A1", puntaje: 90 }, { ref: "P2", puntaje: 100, fuente: "diamond" }, { ref: null, fuente: "aliado" }],
    revalidacion: {
      es_pedido_real: true, sirve_alguna: true, refs_utiles: ["A1"], refs_dudosas: [],
      por_que: "La A1 cumple. La P2 tiene 2 baños y pidió 3. Las dos de aliados no se ofrecen.", le_falta: [], sin_confirmar: [],
    },
  });
  const p = await rescate.planificar({ id: "org1" }, s, d, { ahora: AHORA });
  assert.deepStrictEqual(p.fichas.map((f) => f.ref), ["A1"]);
  assert.deepStrictEqual(p.excluidasPorSofi, [{ ref: "P2", motivo: "sofi_descarto" }]);
});

test("el radar y el lote usan la misma regla de 'aliado': solo sin aprobadas, solo propias >= 95", () => {
  const { rescatarDescartesFalsos } = require("../src/groups/vivo");
  const matches = [{ ref: "P1", puntaje: 100, fuente: "diamond" }, { ref: "P2", puntaje: 80 }, { ref: "AL", puntaje: 100, fuente: "aliado" }];
  const sinAprobar = { es_pedido_real: true, sirve_alguna: false, refs_utiles: [], refs_dudosas: [], por_que: "Son de aliados" };
  assert.deepStrictEqual(rescatarDescartesFalsos(sinAprobar, matches).refs_utiles, ["P1"]);
  const conAprobada = { ...sinAprobar, sirve_alguna: true, refs_utiles: ["P2"], por_que: "Las dos de aliados no se ofrecen" };
  assert.strictEqual(rescatarDescartesFalsos(conAprobada, matches), conAprobada);
  const sinAliado = { ...sinAprobar, por_que: "Tiene 2 baños" };
  assert.strictEqual(rescatarDescartesFalsos(sinAliado, matches), sinAliado);
});

test("los matches de aliado sin ref no se imprimen como 'excluida por Sofi: null'", async () => {
  const lineas = [];
  const { d } = deps({
    log: (...a) => lineas.push(a.join(" ")),
    leerSenales: async () => [senal({
      matches: [{ ref: "A1", puntaje: 90 }, { ref: null, fuente: "aliado" }],
      revalidacion: { es_pedido_real: true, sirve_alguna: true, refs_utiles: ["A1"], refs_dudosas: [], por_que: "ok", le_falta: [], sin_confirmar: [] },
    })],
  });
  await rescate.ejecutar({ horas: 24, aplicar: false, solo: null, salida: os.tmpdir() }, d);
  assert.ok(!lineas.some((l) => /excluida por Sofi: null/.test(l)));
});

test("un telefono de 12 digitos no es un lid (los lids tienen 14-17)", async () => {
  const { d } = deps({ telefonoDe: async () => "573001234567" });
  const p = await rescate.planificar({ id: "org1" }, senal({ autor_telefono: "573001234567" }), d, { ahora: AHORA });
  assert.strictEqual(p.via, "telefono");
  assert.strictEqual(p.lid, null);
  const conLid = await rescate.planificar({ id: "org1" }, senal({ autor_telefono: LID }), d, { ahora: AHORA });
  assert.strictEqual(conLid.via, "lid");
});

test("mascararTexto tapa celulares y UUIDs (la linea de frenos imprime el entorno RADAR_)", () => {
  const t = rescate.mascararTexto("RADAR_REVISOR_PHONE=573011880668,RADAR_ADMIN=3f1a2b3c-1234-4abc-9def-0123456789ab");
  assert.ok(!t.includes("573011880668"));
  assert.ok(!t.includes("3f1a2b3c-1234-4abc-9def-0123456789ab"));
  assert.match(t, /RADAR_REVISOR_PHONE=…0668/);
});

test("2e6fea9a: las fichas que Sofi no vio llevan sus notas desde el dato y la salvedad habla solo de lo que ella vio", async () => {
  const { d } = deps({
    cruzar: async () => [
      ficha({ ref: "10013189", puntaje: 93, administracion: "No aplica" }),
      ficha({ ref: "10113016", puntaje: 92, administracion: "$180.000", caracteristicas: "balcon, cuarto util", razones: ["Zona: Laureles", "$820M — 9% sobre $750M, dentro del margen"] }),
    ],
  });
  const s = senal({
    matches: [{ ref: "10013189", puntaje: 93 }],
    revalidacion: {
      es_pedido_real: true, sirve_alguna: true, refs_utiles: ["10013189"], refs_dudosas: [], por_que: "cumple",
      sin_confirmar: ["cuarto útil", "para estrenar", "administración"],
      le_falta: [{ ref: "10013189", detalle: "cuesta $820M y pediste hasta $750M" }, { ref: "10113016", detalle: "nota que no aplica" }],
    },
  });
  const p = await rescate.planificar({ id: "org1" }, s, d, { ahora: AHORA });
  assert.strictEqual(p.sale, true);
  const [presentacion, f1, f2] = p.mensajes.map((m) => m.texto);
  assert.match(presentacion, /No tengo confirmado si tienen cuarto útil \(en 10013189\) ni para estrenar \(en 10013189\) —/);
  assert.doesNotMatch(presentacion, /administración/);
  assert.match(f1, /cuesta \$820M y pediste hasta \$750M/);
  assert.match(f2, /Aclaración: cuesta \$820M y pediste hasta \$750M/);
  assert.doesNotMatch(f2, /nota que no aplica/);
});

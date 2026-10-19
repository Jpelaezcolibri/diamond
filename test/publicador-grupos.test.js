// Publicador automatico de amoblados en grupos (spec
// docs/superpowers/specs/2026-10-19-publicador-grupos-design.md).
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const publicador = require("../src/groups/publicador");
const scheduler = require("../src/scheduler/publicador-grupos");

// Lunes 2026-10-19, 10:00 a. m. Bogota = 15:00 UTC.
const LUNES_10AM = new Date("2026-10-19T15:00:00Z");
const MIN = 60000;

function amoblado(ref, extra = {}) {
  return {
    ref, disponible: true, link: `https://info.wasi.co/x/${ref}`, images: ["a.jpg"], operacion: "Arriendo",
    tipo: "Apartamento", zona: "El Poblado", titulo: "Apartamento Amoblado en El Poblado", descripcion: "", caracteristicas: "",
    ...extra,
  };
}

const G1 = { id: "g1", jid: "1@g.us", nombre: "Arriendos amoblados", publica: "amoblados" };
const G2 = { id: "g2", jid: "2@g.us", nombre: "Ofertas sur", publica: "amoblados" };
const GF = { id: "gf", jid: "f@g.us", nombre: "Fincas", publica: "fincas" };

function hace(minutos, base = LUNES_10AM) {
  return new Date(base.getTime() - minutos * MIN).toISOString();
}

// --- compuertas ---

test("amoblado completo es publicable en un grupo de amoblados", () => {
  assert.equal(publicador.aptaPara(amoblado("1"), "amoblados"), true);
});

test("sin zona, sin amoblado confirmado o con precio por noche no se publica", () => {
  assert.equal(publicador.aptaPara(amoblado("1", { zona: "" }), "amoblados"), false);
  assert.equal(publicador.aptaPara(amoblado("1", { titulo: "Apartamento en El Poblado" }), "amoblados"), false);
  assert.equal(publicador.aptaPara(amoblado("1", { descripcion: "Valor por noche $650.000" }), "amoblados"), false);
});

test("venta, sin fotos o sin link no se publica", () => {
  assert.equal(publicador.aptaPara(amoblado("1", { operacion: "Venta" }), "amoblados"), false);
  assert.equal(publicador.aptaPara(amoblado("1", { images: [] }), "amoblados"), false);
  assert.equal(publicador.aptaPara(amoblado("1", { link: "" }), "amoblados"), false);
});

test("una finca no va a amoblados y en fincas exige un solo periodo", () => {
  const finca = amoblado("9", { tipo: "Finca", titulo: "Finca amoblada en Guatapé" });
  assert.equal(publicador.aptaPara(finca, "amoblados"), false);
  assert.equal(publicador.aptaPara(finca, "fincas"), false);
  assert.equal(publicador.aptaPara({ ...finca, descripcion: "precio por noche" }, "fincas"), true);
  assert.equal(publicador.aptaPara({ ...finca, descripcion: "por noche o mensual" }, "fincas"), false);
});

// --- eleccion ---

test("fuera de horario y domingo no publica", () => {
  const base = { grupos: [G1], propiedades: [amoblado("1")], historial: [], maxDia: 8 };
  assert.equal(publicador.elegir({ ...base, ahora: new Date("2026-10-19T12:30:00Z") }).motivo, "fuera_de_horario"); // 7:30 a. m.
  assert.equal(publicador.elegir({ ...base, ahora: new Date("2026-10-19T23:00:00Z") }).motivo, "fuera_de_horario"); // 6 p. m.
  assert.equal(publicador.elegir({ ...base, ahora: new Date("2026-10-18T15:00:00Z") }).motivo, "fuera_de_horario"); // domingo
});

test("un grupo recibe un solo post por dia", () => {
  const historial = [{ group_id: "g1", property_ref: "1", estado: "enviado", created_at: hace(90) }];
  const r = publicador.elegir({ grupos: [G1], propiedades: [amoblado("1"), amoblado("2")], historial, ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r.motivo, "nada_que_publicar");
});

test("el tope diario cuenta tambien los fallos", () => {
  const historial = [
    { group_id: "gx", property_ref: "1", estado: "enviado", created_at: hace(120) },
    { group_id: "gy", property_ref: "2", estado: "fallo", created_at: hace(90) },
  ];
  const r = publicador.elegir({ grupos: [G1], propiedades: [amoblado("3")], historial, ahora: LUNES_10AM, maxDia: 2 });
  assert.equal(r.motivo, "tope_diario");
});

test("respeta el espaciado entre posts", () => {
  const r = publicador.elegir({
    grupos: [G1], propiedades: [amoblado("1")], historial: [], ahora: LUNES_10AM, maxDia: 8,
    noAntesDe: new Date(LUNES_10AM.getTime() + 5 * MIN),
  });
  assert.equal(r.motivo, "espaciado");
});

test("no repite una ref en el mismo grupo antes de 7 dias", () => {
  const historial = [{ group_id: "g1", property_ref: "1", estado: "enviado", created_at: hace(3 * 24 * 60) }];
  const r = publicador.elegir({ grupos: [G1], propiedades: [amoblado("1"), amoblado("2")], historial, ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r.propiedad.ref, "2");
  const viejo = [{ group_id: "g1", property_ref: "1", estado: "enviado", created_at: hace(8 * 24 * 60) }];
  const r2 = publicador.elegir({ grupos: [G1], propiedades: [amoblado("1")], historial: viejo, ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r2.propiedad.ref, "1");
});

test("elige el grupo mas olvidado y la ref que hace mas no sale", () => {
  const historial = [
    { group_id: "g1", property_ref: "1", estado: "enviado", created_at: hace(2 * 24 * 60) },
    { group_id: "g2", property_ref: "2", estado: "enviado", created_at: hace(5 * 24 * 60) },
  ];
  const r = publicador.elegir({ grupos: [G1, G2], propiedades: [amoblado("1"), amoblado("2"), amoblado("3")], historial, ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r.grupo.id, "g2");
  assert.equal(r.propiedad.ref, "3"); // nunca publicada gana
});

test("un grupo de fincas sin fincas publicables no bloquea a los demas", () => {
  const r = publicador.elegir({ grupos: [GF, G1], propiedades: [amoblado("1")], historial: [], ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r.grupo.id, "g1");
});

test("el texto lleva apertura y el cuerpo del kit", () => {
  const t = publicador.textoPost(G1, amoblado("1"), "CUERPO", LUNES_10AM);
  assert.ok(publicador.APERTURAS.amoblados.includes(t.split("\n")[0]));
  assert.ok(t.endsWith("\n\nCUERPO"));
  const finca = amoblado("9", { tipo: "Finca", descripcion: "precio por noche" });
  assert.match(publicador.textoPost(GF, finca, "C", LUNES_10AM), /^🌳 Finca en renta \(precio por noche\)/);
});

// --- scheduler ---

const ORG = { id: "org-1", name: "Diamond" };
let previo;

beforeEach(() => {
  previo = process.env.RADAR_PUBLICAR_ACTIVO;
  process.env.RADAR_PUBLICAR_ACTIVO = "true";
  scheduler._reset();
});
afterEach(() => {
  if (previo === undefined) delete process.env.RADAR_PUBLICAR_ACTIVO;
  else process.env.RADAR_PUBLICAR_ACTIVO = previo;
});

function deps(over = {}) {
  const log = { enviados: [], registrados: [], alertas: [] };
  const d = {
    orgs: async () => [ORG],
    inventarioFresco: async () => true,
    grupos: async () => [G1, G2],
    historial: async () => [],
    propiedades: async () => [amoblado("1"), amoblado("2")],
    sesion: async () => ({ nombre: "DaianaDiamond" }),
    post: async (_org, ref) => ({ texto: `post ${ref}`, linkOk: true }),
    enviar: async (sesion, jid, texto) => {
      log.enviados.push({ sesion, jid, texto });
      return { ok: true, wamid: "W1" };
    },
    registrar: async (fila) => log.registrados.push(fila),
    alertar: async (resumen, detalle) => log.alertas.push(`${resumen} ${detalle}`),
    azar: () => 0,
    ...over,
  };
  return { d, log };
}

test("apagado por defecto: no hace nada", async () => {
  delete process.env.RADAR_PUBLICAR_ACTIVO;
  const { d, log } = deps();
  assert.deepEqual(await scheduler.runOnce({ ahora: LUNES_10AM, deps: d }), []);
  assert.equal(log.enviados.length, 0);
});

test("publica un post, lo registra y espera antes del siguiente", async () => {
  const { d, log } = deps();
  const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(r.resultado, "enviado");
  assert.equal(log.enviados.length, 1);
  assert.equal(log.registrados[0].estado, "enviado");
  assert.equal(log.registrados[0].wamid, "W1");
  const [r2] = await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 10 * MIN), deps: d });
  assert.equal(r2.resultado, "espaciado");
});

test("sin la tabla no publica (falla cerrado)", async () => {
  const { d, log } = deps({ historial: async () => null });
  const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(r.resultado, "sin_tabla");
  assert.equal(log.enviados.length, 0);
});

test("con inventario viejo no publica", async () => {
  const { d, log } = deps({ inventarioFresco: async () => false });
  const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(r.resultado, "inventario_viejo");
  assert.equal(log.enviados.length, 0);
});

test("sesion caida: no envia y avisa una sola vez en el dia", async () => {
  const { d, log } = deps({ sesion: async () => ({ nombre: null, motivo: "sesion en FAILED" }) });
  await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 30 * MIN), deps: d });
  assert.equal(log.enviados.length, 0);
  assert.equal(log.alertas.length, 1);
});

test("un envio fallido se registra, avisa y pausa el resto del dia", async () => {
  const { d, log } = deps({ enviar: async () => ({ ok: false, error: "WAHA respondio 503" }) });
  const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(r.resultado, "fallo");
  assert.equal(log.registrados[0].estado, "fallo");
  assert.equal(log.alertas.length, 1);
  const [r2] = await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 60 * MIN), deps: d });
  assert.equal(r2.resultado, "pausado");
  // Al dia siguiente vuelve a intentar.
  const [r3] = await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 24 * 60 * MIN), deps: d });
  assert.equal(r3.resultado, "fallo");
});

test("link que no abre: salta la ref el resto del dia", async () => {
  const { d, log } = deps({
    propiedades: async () => [amoblado("1")],
    post: async () => ({ texto: "x", linkOk: false }),
  });
  const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(r.resultado, "link_roto");
  const [r2] = await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 5 * MIN), deps: d });
  assert.equal(r2.resultado, "nada_que_publicar");
  assert.equal(log.enviados.length, 0);
});

test("tras un reinicio espera 20 min desde el ultimo post registrado", async () => {
  const { d, log } = deps({ historial: async () => [{ group_id: "g1", property_ref: "1", estado: "enviado", created_at: hace(10) }] });
  const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(r.resultado, "espaciado");
  assert.equal(log.enviados.length, 0);
});

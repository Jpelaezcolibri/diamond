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
    tipo: "Apartamento", zona: "El Poblado", titulo: "Apartamento Amoblado en El Poblado", descripcion: "", caracteristicas: "", precio: "$4.500.000",
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
  assert.equal(log.registrados[0].origen, "auto");
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

// --- periodo que marca Wasi (properties.periodo_precio, 2026-10-19) ---

test("el periodo de Wasi manda sobre el texto en amoblados", () => {
  const nochesYMes = amoblado("10403022", { descripcion: "Se renta por noches y mes" });
  assert.equal(publicador.aptaPara(nochesYMes, "amoblados"), false); // sin dato: adivina por el texto
  assert.equal(publicador.aptaPara({ ...nochesYMes, periodo_precio: "mensual" }, "amoblados"), true);
  assert.equal(publicador.aptaPara(amoblado("1", { periodo_precio: "diario" }), "amoblados"), false);
});

test("una finca con periodo de Wasi se publica aunque el texto no lo diga", () => {
  const guatape = amoblado("10389800", { tipo: "Finca", titulo: "Renta de finca - Guatapé", descripcion: "" });
  assert.equal(publicador.aptaPara(guatape, "fincas"), false);
  assert.equal(publicador.aptaPara({ ...guatape, periodo_precio: "diario" }, "fincas"), true);
  assert.match(publicador.textoPost(GF, { ...guatape, periodo_precio: "diario" }, "C", LUNES_10AM), /\(precio por noche\)/);
  assert.match(publicador.textoPost(GF, { ...guatape, periodo_precio: "mensual" }, "C", LUNES_10AM), /\(precio mensual\)/);
  assert.equal(publicador.aptaPara({ ...guatape, periodo_precio: "semanal" }, "fincas"), false);
});

// --- propiedades de asesor (spec 2026-10-19-sofi-publica-propiedad-asesor) ---

const GO = { id: "go", jid: "o@g.us", nombre: "Ofertas", publica: "ofertas" };
function deAsesor(ref, extra = {}) {
  return amoblado(ref, {
    origen: "asesor", operacion: "Venta", titulo: "Casa en venta en Belén", area: "120m2",
    captador_id: "adv-1", created_at: new Date(LUNES_10AM.getTime() - 60 * MIN).toISOString(), ...extra,
  });
}

test("ofertas recibe la venta de un asesor y los amoblados, no la venta de Wasi", () => {
  assert.equal(publicador.aptaPara(deAsesor("D1001"), "ofertas"), true);
  assert.equal(publicador.aptaPara(amoblado("1"), "ofertas"), true);
  assert.equal(publicador.aptaPara(amoblado("2", { operacion: "Venta", titulo: "Casa en venta" }), "ofertas"), false);
  assert.equal(publicador.aptaPara(deAsesor("D1002", { zona: "" }), "ofertas"), false);
  assert.equal(publicador.aptaPara(deAsesor("D1003", { area: null }), "ofertas"), false);
});

test("la propiedad nueva de un asesor sale primero", () => {
  const r = publicador.elegir({ grupos: [GO], propiedades: [amoblado("1"), deAsesor("D1001")], historial: [], ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r.propiedad.ref, "D1001");
});

test("una propiedad de asesor recien creada espera 15 minutos", () => {
  const recien = deAsesor("D1001", { created_at: new Date(LUNES_10AM.getTime() - 5 * MIN).toISOString() });
  const r = publicador.elegir({ grupos: [GO], propiedades: [recien], historial: [], ahora: LUNES_10AM, maxDia: 8 });
  assert.equal(r.motivo, "nada_que_publicar");
});

test("el captador recibe un solo aviso, solo cuando este envio es el primero de la propiedad", async () => {
  const correr = async (veces) => {
    scheduler._reset();
    const avisos = [];
    const { d } = deps({
      grupos: async () => [GO],
      propiedades: async () => [deAsesor("D1001")],
      vecesPublicada: async () => veces,
      avisarCaptador: async (org, p, g) => avisos.push([p.ref, g.nombre]),
    });
    await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
    return avisos;
  };
  assert.deepEqual(await correr(1), [["D1001", "Ofertas"]]);
  // Historial de 8 dias vacio, pero ya habia salido antes: no avisa.
  assert.deepEqual(await correr(2), []);
  // Si no se pudo contar, calla.
  assert.deepEqual(await correr(null), []);
});

// --- encabezado por propiedad en grupos "ofertas" (revision final C1) ---

test("ofertas: la venta sale como venta, no como amoblado en arriendo", () => {
  const t = publicador.textoPost(GO, deAsesor("D1001", { tipo: "Casa" }), "C", LUNES_10AM);
  assert.match(t, /^🏠 Casa en venta\n\nC$/);
});

test("ofertas: arriendo no amoblado y amoblado mensual", () => {
  const noAmoblado = deAsesor("D1002", { operacion: "Arriendo", periodo_precio: "mensual", titulo: "Apartamento en arriendo en Laureles" });
  assert.match(publicador.textoPost(GO, noAmoblado, "C", LUNES_10AM), /^🔑 Apartamento en arriendo\n/);
  const amob = deAsesor("D1003", { operacion: "Arriendo", periodo_precio: "mensual", titulo: "Apartamento amoblado en arriendo en Laureles" });
  const t = publicador.textoPost(GO, amob, "C", LUNES_10AM);
  assert.ok(publicador.APERTURAS.amoblados.some((a) => t.startsWith(a)), t);
  assert.doesNotMatch(t, /precio por noche/);
});

test("ofertas: arriendo por noche lo dice; finca usa el encabezado de fincas", () => {
  const noche = deAsesor("D1004", { operacion: "Arriendo", periodo_precio: "diario", titulo: "Apartamento amoblado en arriendo en Laureles" });
  assert.match(publicador.textoPost(GO, noche, "C", LUNES_10AM), /\(precio por noche\)/);
  const finca = deAsesor("D1005", { operacion: "Arriendo", tipo: "Finca", periodo_precio: "diario", titulo: "Finca en arriendo en Guatapé" });
  assert.match(publicador.textoPost(GO, finca, "C", LUNES_10AM), /^🌳 Finca en renta \(precio por noche\)/);
  const fincaMes = deAsesor("D1006", { operacion: "Arriendo", tipo: "Finca", periodo_precio: "mensual", titulo: "Finca en arriendo en Guatapé" });
  assert.match(publicador.textoPost(GO, fincaMes, "C", LUNES_10AM), /^🌳 Finca en renta \(precio mensual\)/);
});

test("un arriendo de asesor sin periodo_precio mensual o diario no es apto", () => {
  const sinPeriodo = deAsesor("D1007", { operacion: "Arriendo", periodo_precio: null });
  assert.equal(publicador.aptaPara(sinPeriodo, "ofertas"), false);
  assert.equal(publicador.aptaPara(deAsesor("D1008", { operacion: "Arriendo", periodo_precio: "mensual" }), "ofertas"), true);
  assert.equal(publicador.aptaPara(deAsesor("D1009"), "ofertas"), true);
});

test("I5: el link roto de una propiedad de asesor se reintenta a la hora, no al dia siguiente", async () => {
  scheduler._reset();
  let abre = false;
  const { d, log } = deps({
    grupos: async () => [GO],
    propiedades: async () => [deAsesor("D1001")],
    post: async () => ({ texto: "x", linkOk: abre }),
  });
  assert.equal((await scheduler.runOnce({ ahora: LUNES_10AM, deps: d }))[0].resultado, "link_roto");
  const t30 = new Date(LUNES_10AM.getTime() + 30 * MIN);
  assert.equal((await scheduler.runOnce({ ahora: t30, deps: d }))[0].resultado, "nada_que_publicar");
  abre = true;
  const t61 = new Date(LUNES_10AM.getTime() + 61 * MIN);
  assert.equal((await scheduler.runOnce({ ahora: t61, deps: d }))[0].resultado, "enviado");
  assert.equal(log.enviados.length, 1);
});

test("M3: el aviso al captador no promete avisar", () => {
  const fuente = require("fs").readFileSync(require("path").join(__dirname, "../src/scheduler/publicador-grupos.js"), "utf8");
  assert.doesNotMatch(fuente, /te aviso/);
  assert.match(fuente, /Sigue rotando en los demás grupos\./);
});

test("el log del link roto de un asesor dice que se reintenta en 60 min", async (t) => {
  scheduler._reset();
  const warn = t.mock.method(console, "warn", () => {});
  const { d } = deps({ grupos: async () => [GO], propiedades: async () => [deAsesor("D1001")], post: async () => ({ texto: "x", linkOk: false }) });
  await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.match(warn.mock.calls.map((c) => c.arguments.join(" ")).join(" | "), /se reintenta en 60 min/);
});

// --- el aviso al captador va por la campana del CRM (Juan, 2026-10-20) ---
test("avisarCaptador por defecto notifica en la campana, sin WhatsApp", async (t) => {
  const notificar = require("../src/notifications/notificar");
  const advisors = require("../src/data/advisors");
  const mensajeAsesor = require("../src/lib/mensaje-asesor");
  const adv = { id: "adv-1", name: "Daiana", phone: "573011880668" };
  t.mock.method(advisors, "findById", async () => adv);
  const wa = t.mock.method(mensajeAsesor, "enviarYRegistrar", async () => ({ ok: true }));
  const nt = t.mock.method(notificar, "notificar", async () => ({ ok: true, push: 0 }));
  const d = scheduler._depsPorDefecto();
  await d.avisarCaptador({ id: "org-1" }, { ref: "D1001", captador_id: "adv-1" }, { nombre: "Ofertas" });
  assert.deepEqual(nt.mock.calls[0].arguments[0], {
    orgId: "org-1", advisor: adv, tipo: "propiedad_publicada", titulo: "Tu D1001 salió en Ofertas",
    cuerpo: "Sigue rotando en los demás grupos.", link: "/pendientes",
  });
  assert.equal(wa.mock.callCount(), 0);
});

// --- venta de Wasi en grupos OFERTAS (Juan, 2026-10-20) ---

function ventaWasi(ref, zona, extra = {}) {
  return amoblado(ref, { operacion: "Venta", titulo: `Apartamento en venta en ${zona}`, zona, area: "90m2", precio: "$650.000.000", ...extra });
}

test("la venta de Wasi entra a OFERTAS con zona, area y precio reales, y nunca a amoblados", () => {
  assert.equal(publicador.aptaPara(ventaWasi("V1", "Envigado"), "ofertas"), true);
  assert.equal(publicador.aptaPara(ventaWasi("V1", "Envigado"), "amoblados"), false);
  assert.equal(publicador.aptaPara(ventaWasi("V2", ""), "ofertas"), false);
  assert.equal(publicador.aptaPara(ventaWasi("V3", "Envigado", { area: null }), "ofertas"), false);
  assert.equal(publicador.aptaPara(ventaWasi("V4", "Envigado", { precio: "$0" }), "ofertas"), false);
  assert.equal(publicador.aptaPara(ventaWasi("V5", "Envigado", { link: "" }), "ofertas"), false);
});

test("en OFERTAS sale primero la venta de la zona mas pedida, despues los amoblados", () => {
  const demanda = new Map([["envigado", 111], ["el poblado", 98], ["laureles", 49]]);
  const props = [amoblado("A1"), ventaWasi("V-LAU", "Laureles"), ventaWasi("V-ENV", "Envigado"), ventaWasi("V-BEL", "Belén")];
  const r = publicador.elegir({ grupos: [GO], propiedades: props, historial: [], ahora: LUNES_10AM, maxDia: 10, demanda });
  assert.equal(r.propiedad.ref, "V-ENV");
  // En un grupo de amoblados la venta no aparece.
  const r2 = publicador.elegir({ grupos: [G1], propiedades: props, historial: [], ahora: LUNES_10AM, maxDia: 10, demanda });
  assert.equal(r2.propiedad.ref, "A1");
});

test("una ref que ya salio hoy en otro grupo cede el turno", () => {
  const demanda = new Map([["envigado", 111], ["laureles", 49]]);
  const historial = [{ group_id: "otro", property_ref: "V-ENV", estado: "enviado", created_at: hace(60) }];
  const r = publicador.elegir({
    grupos: [GO], propiedades: [ventaWasi("V-ENV", "Envigado"), ventaWasi("V-LAU", "Laureles")], historial, ahora: LUNES_10AM, maxDia: 10, demanda,
  });
  assert.equal(r.propiedad.ref, "V-LAU");
});

test("demandaPorZona cuenta cada zona una vez por pedido, sin tildes", () => {
  const m = scheduler.demandaPorZona([
    { zonas: ["Envigado", "El Poblado"] }, { zonas: ["envigado", "Envigado"] }, { zonas: [], zona: "Belén" }, { zonas: null, zona: null },
  ]);
  assert.equal(m.get("envigado"), 2);
  assert.equal(m.get("el poblado"), 1);
  assert.equal(m.get("belen"), 1);
  assert.equal(publicador.demandaDe({ zona: "Poblado" }, m), 1);
});

test("un arriendo con precio imposible no se publica (ref 10488266, $550 M mensuales)", () => {
  const finca = amoblado("10488266", { tipo: "Finca", titulo: "Finca en Santa Bárbara", precio: "$550.000.000", periodo_precio: "mensual" });
  assert.equal(publicador.aptaPara(finca, "fincas"), false);
  assert.equal(publicador.aptaPara({ ...finca, precio: "$35.000.000" }, "fincas"), true);
  assert.equal(publicador.aptaPara(amoblado("1", { precio: "$18.900.000.000" }), "amoblados"), false);
  assert.equal(publicador.aptaPara({ ...finca, precio: "$25.000.000", periodo_precio: "diario" }, "fincas"), false);
});

// --- texto guardado ---

test("la fila registrada trae el texto exacto que se envio", async () => {
  const { d, log } = deps();
  await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(log.registrados[0].texto, log.enviados[0].texto);
  assert.ok(log.registrados[0].texto.includes("post "));;
});

test("insertarPublicacion: sin columna texto u origen, registra sin ellas", async () => {
  const intentos = [];
  const supabase = {
    from: () => ({
      insert: async (fila) => {
        intentos.push(fila);
        if ("texto" in fila) return { error: { message: 'column "texto" of relation "grupo_publicaciones" does not exist', code: "42703" } };
        return { error: null };
      },
    }),
  };
  await scheduler.insertarPublicacion(supabase, { property_ref: "1", origen: "auto", texto: "hola", estado: "enviado" });
  assert.equal(intentos.length, 2);
  assert.deepEqual(intentos[1], { property_ref: "1", origen: "auto", estado: "enviado" });
});

// --- publicador mixto: scheduler (spec 2026-10-26) ---

const A_LAS = (h, m = 0) => new Date(`2026-10-19T${String(h + 5).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);

test("porGrupo(): solo 1 o 2; cualquier otro valor es 1", () => {
  const previoPG = process.env.RADAR_PUBLICAR_POR_GRUPO;
  try {
    delete process.env.RADAR_PUBLICAR_POR_GRUPO;
    assert.equal(scheduler.porGrupo(), 1);
    process.env.RADAR_PUBLICAR_POR_GRUPO = "";
    assert.equal(scheduler.porGrupo(), 1);
    process.env.RADAR_PUBLICAR_POR_GRUPO = "3";
    assert.equal(scheduler.porGrupo(), 1);
    process.env.RADAR_PUBLICAR_POR_GRUPO = "2";
    assert.equal(scheduler.porGrupo(), 2);
  } finally {
    if (previoPG === undefined) delete process.env.RADAR_PUBLICAR_POR_GRUPO;
    else process.env.RADAR_PUBLICAR_POR_GRUPO = previoPG;
  }
});

test("con 2 por grupo: a las 3 p. m. publica el segundo; a la 1 p. m. no (entre_franjas)", async () => {
  const previoPG = process.env.RADAR_PUBLICAR_POR_GRUPO;
  process.env.RADAR_PUBLICAR_POR_GRUPO = "2";
  try {
    const manana = [{ group_id: "g1", property_ref: "1", estado: "enviado", created_at: A_LAS(9).toISOString() }];
    const { d, log } = deps({ grupos: async () => [G1], historial: async () => manana });
    const [r1] = await scheduler.runOnce({ ahora: A_LAS(13), deps: d });
    assert.equal(r1.resultado, "entre_franjas");
    const [r2] = await scheduler.runOnce({ ahora: A_LAS(15), deps: d });
    assert.equal(r2.resultado, "enviado");
    assert.equal(log.enviados.length, 1);
  } finally {
    if (previoPG === undefined) delete process.env.RADAR_PUBLICAR_POR_GRUPO;
    else process.env.RADAR_PUBLICAR_POR_GRUPO = previoPG;
  }
});

test("espaciado de 15 a 30 min segun el azar", async () => {
  for (const [azar, min] of [[0, 15], [1, 30]]) {
    scheduler._reset();
    const { d } = deps({ azar: () => azar });
    const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
    assert.equal(r.resultado, "enviado");
    const justo = await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + (min - 1) * MIN), deps: d });
    assert.equal(justo[0].resultado, "espaciado");
    const luego = await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + (min + 1) * MIN), deps: d });
    assert.notEqual(luego[0].resultado, "espaciado");
  }
});

test("tras un reinicio espera 15 min desde el ultimo post", async () => {
  const { d } = deps({ historial: async () => [{ group_id: "g1", property_ref: "1", estado: "enviado", created_at: hace(16) }] });
  const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.notEqual(r.resultado, "espaciado");
});

test("un grupo que publica pero esta en modo ignorar avisa una sola vez por dia", async () => {
  const sordo = { ...G1, modo: "ignorar" };
  const { d, log } = deps({ grupos: async () => [sordo, G2] });
  await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 30 * MIN), deps: d });
  const avisos = log.alertas.filter((a) => /no escucha/.test(a));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /Arriendos amoblados/);
  // Al dia siguiente vuelve a avisar.
  await scheduler.runOnce({ ahora: new Date(LUNES_10AM.getTime() + 24 * 60 * MIN), deps: d });
  assert.equal(log.alertas.filter((a) => /no escucha/.test(a)).length, 2);
});

test("los pedidos del grupo ordenan: sale primero la venta que calza con ellos", async () => {
  const GENERAL = { id: "go", jid: "o@g.us", nombre: "Ofertas general", publica: "ofertas" };
  const props = [ventaWasi("V-ENV", "Envigado"), ventaWasi("V-LAU", "Laureles")];
  const demanda = new Map([["envigado", 100]]);
  const pedidos = new Map([["go", [{ operacion: "venta", zona: "Laureles", zonas: ["Laureles"] }]]]);
  const { d, log } = deps({
    grupos: async () => [GENERAL], propiedades: async () => props, demanda: async () => demanda,
    pedidosPorGrupo: async () => pedidos,
  });
  const [r] = await scheduler.runOnce({ ahora: LUNES_10AM, deps: d });
  assert.equal(r.resultado, "enviado");
  assert.equal(r.ref, "V-LAU");
  assert.equal(log.enviados.length, 1);
});

// Sofi contesta en la linea del radar (Juan, 2026-10-21). Caso: Luz Amparo
// (Projency) pregunto "Cual es tu nombre" y la linea le mando solo un link;
// insistio y nadie le contesto en 40 minutos. Ahora Sofi se presenta, contesta
// hasta 3 veces con el pedido y las fichas reales, y calla si una persona del
// equipo escribio en el chat. Spec: 2026-10-21-sofi-en-linea-radar-design.md

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");

process.env.CONTACT_WHATSAPP_NUMBER = "573044653609";
const sofiLinea = require("../src/groups/sofi-linea");

const ORG = { id: "org-1", contact_whatsapp_number: "573044653609" };
const LINK_WASI = "https://info.wasi.co/apartamento-venta-laureles-medellin/9944723?shared=whatsapp";
const señal = (extra = {}) => ({
  id: "sig-1", autor_nombre: "Projency Inmobiliaria", codigo_colega: "7S63", respuesta_refs: ["9944723"],
  texto_original: "Solicito Apartamento entre Laureles y El Estadio, 3 alcobas, garaje, $800", ...extra,
});
const mensaje = (extra = {}) => ({
  sesion: "DaianaDiamond", remitenteNombre: "Projency Inmobiliaria",
  texto: "Cordial saludo, soy Luz Amparo Restrepo de Projency Inmobiliaria. Cuál es tu nombre", ...extra,
});
const identidad = { telefono: null, lid: "84134751940861@lid" };

function deps(extra = {}) {
  const ll = { enviados: [], guardados: [], avisos: [], prompts: [] };
  const d = {
    estado: async () => ({ faltaAutor: false, humano: false, respuestasSofi: 0, hilo: [] }),
    esColega: async () => null,
    asignarCodigo: async () => "NUEV",
    fichas: async () => [{ ref: "9944723", tipo: "Apartamento", operacion: "Venta", zona: "Laureles", precio: "$700.000.000", habitaciones: 4, garaje: 1, linkWasi: LINK_WASI }],
    redactar: async (p) => { ll.prompts.push(p); return "¡Hola Luz Amparo! Soy Sofi, la asistente virtual de Diamond Inmobiliaria."; },
    enviar: async (args) => { ll.enviados.push(args); return { ok: true, wamid: "wamid-1" }; },
    guardarSalida: async (orgId, f) => { ll.guardados.push(f); return { mensaje: { id: "x" } }; },
    asesor: async () => ({ id: "adv-1" }),
    notificar: async (a) => { ll.avisos.push(a); return { ok: true }; },
    marcarPuente: async () => 0,
    dormir: async () => {},
    rand: () => 0.5,
    ...extra,
  };
  return { d, ll };
}

beforeEach(() => { process.env.RADAR_SOFI_LINEA = "true"; });

const textoEnviado = (ll) => ll.enviados[0].mensajes[0].texto;

test("apagado: no hace nada y deja el camino de siempre", async () => {
  process.env.RADAR_SOFI_LINEA = "";
  const { d, ll } = deps();
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.strictEqual(r.resultado, "apagado");
  assert.strictEqual(ll.enviados.length, 0);
});

test("quien no es colega, no tiene pedido y no le habla a Sofi: no se contesta", async () => {
  const { d, ll } = deps();
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje({ texto: "Su factura de Wasi" }), señal: null, identidad }, d);
  assert.strictEqual(r.resultado, "sin_senal");
  assert.strictEqual(ll.enviados.length, 0);
});

test("sin la columna autor: falla cerrado al puente de siempre", async () => {
  const { d, ll } = deps({ estado: async () => ({ faltaAutor: true, humano: false, respuestasSofi: 0, hilo: [] }) });
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.strictEqual(r.resultado, "falta_autor");
  assert.strictEqual(ll.enviados.length, 0);
});

test("si una persona del equipo escribio en el chat, Sofi calla y avisa", async () => {
  const { d, ll } = deps({ estado: async () => ({ faltaAutor: false, humano: true, respuestasSofi: 1, hilo: [] }) });
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.strictEqual(r.resultado, "humano_atiende");
  assert.strictEqual(ll.enviados.length, 0);
  assert.strictEqual(ll.avisos.length, 1);
});

test("a la cuarta, Sofi calla y le avisa a la asesora que le toca", async () => {
  const { d, ll } = deps({ estado: async () => ({ faltaAutor: false, humano: false, respuestasSofi: 3, hilo: [] }) });
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.strictEqual(r.resultado, "tope");
  assert.strictEqual(ll.enviados.length, 0);
  assert.match(ll.avisos[0].titulo + ll.avisos[0].cuerpo, /te toca/i);
});

test("camino feliz: envia lo de Sofi, lo guarda como suyo y avisa", async () => {
  const { d, ll } = deps();
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.strictEqual(r.resultado, "respondido");
  assert.match(textoEnviado(ll), /asistente virtual/);
  assert.strictEqual(ll.enviados[0].lid, identidad.lid);
  assert.strictEqual(ll.guardados[0].autor, "sofi");
  assert.strictEqual(ll.guardados[0].direccion, "salida");
  assert.strictEqual(ll.avisos.length, 1);
});

test("el prompt trae la ficha real, el numero de respuesta y el link oficial con el codigo", async () => {
  const { d, ll } = deps({ estado: async () => ({ faltaAutor: false, humano: false, respuestasSofi: 1, hilo: [] }) });
  await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  const p = ll.prompts[0].usuario;
  assert.match(p, /RESPUESTA 2 DE 3/);
  assert.match(p, /\$700\.000\.000/);
  assert.ok(p.includes(LINK_WASI));
  assert.match(p, /PEDIDO%20\(c%C3%B3d\.%207S63\)/);
});

test("el link oficial no lleva el texto del colega", async () => {
  const link = sofiLinea.linkOficial(ORG, "7S63");
  assert.match(link, /7S63/);
  assert.doesNotMatch(link, /Projency|Cordial/);
});

test("si el modelo falla, sale el texto fijo con la presentacion y el link", async () => {
  const { d, ll } = deps({ redactar: async () => null });
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.strictEqual(r.resultado, "respondido_fijo");
  assert.match(textoEnviado(ll), /Sofi, la asistente virtual de Diamond Inmobiliaria/);
  assert.match(textoEnviado(ll), /wa\.me\/573044653609/);
  assert.strictEqual(ll.guardados[0].autor, "sofi");
});

test("un link inventado no llega al colega; el de la ficha y el oficial si", async () => {
  const oficial = sofiLinea.linkOficial(ORG, "7S63");
  const { d, ll } = deps({ redactar: async () => `Mírala: ${LINK_WASI} y la otra https://diamondinmobiliaria.co/ficha/123 . Agenda aquí 👉 ${oficial}` });
  await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  const t = textoEnviado(ll);
  assert.ok(t.includes(LINK_WASI));
  assert.ok(t.includes(oficial));
  assert.doesNotMatch(t, /diamondinmobiliaria\.co\/ficha/);
});

test("si el envio falla, no se guarda como respuesta de Sofi", async () => {
  const { d, ll } = deps({ enviar: async () => ({ ok: false, error: "waha caido" }) });
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.strictEqual(r.resultado, "envio_fallido");
  assert.strictEqual(ll.guardados.length, 0);
  assert.strictEqual(ll.avisos.length, 1);
});

test("espera entre 8 y 20 s antes de contestar", async () => {
  const esperas = [];
  const { d } = deps({ dormir: async (ms) => { esperas.push(ms); }, rand: () => 1 });
  await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.ok(esperas[0] >= 8000 && esperas[0] <= 20000, `espero ${esperas[0]}`);
});

test("nunca lanza: si algo revienta devuelve error", async () => {
  const { d } = deps({ estado: async () => { throw new Error("boom"); } });
  const r = await sofiLinea.responder(ORG, { mensaje: mensaje(), señal: señal(), identidad }, d);
  assert.strictEqual(r.resultado, "error");
});

test("saluda a la persona, no a la empresa", () => {
  assert.strictEqual(sofiLinea.nombreParaSaludo("Projency Inmobiliaria", "Cordial saludo, soy Luz Amparo Restrepo de Projency"), "Luz Amparo");
  assert.strictEqual(sofiLinea.nombreParaSaludo("Projency Inmobiliaria", "hola"), null);
  assert.strictEqual(sofiLinea.nombreParaSaludo("Isabel Restrepo", "hola"), "Isabel");
  assert.strictEqual(sofiLinea.nombreParaSaludo("Inversiones JP", "Me llamo Juan Pablo"), "Juan Pablo");
});

test("el prompt y el texto fijo: tuteo, asistente virtual y sin nombres de asesoras", () => {
  const VOSEO = /\b(escribile|decime|querés|podés|contame|mirá|fijate|tenés|sabés|confirmame)\b/i;
  const fijo = sofiLinea.textoFijo("Luz Amparo", "https://wa.me/573044653609");
  for (const t of [sofiLinea.SISTEMA, fijo]) {
    assert.doesNotMatch(t, VOSEO);
    assert.match(t, /asistente virtual/);
    assert.doesNotMatch(t, /Daiana|Claudia|Catherine|Natalia/);
  }
});

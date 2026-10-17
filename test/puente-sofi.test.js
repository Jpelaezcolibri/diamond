// Puente colega -> Sofi (Juan, 2026-10-17, opcion B). Caso que lo disparo:
// Isabel Restrepo le contesto a la linea del radar "Necesito que me valides
// cuales tienen 2 alcobas con baño" a las 7:41 p. m. y nadie le respondio en
// 13 horas: la linea solo guarda, no contesta. Ahora, a la PRIMERA respuesta
// de un colega a un DM del radar, sale UN mensaje con el link a Sofi (con el
// codigo del pedido y su pregunta ya escritos) y queda un aviso en la app.

const { test } = require("node:test");
const assert = require("node:assert");

process.env.CONTACT_WHATSAPP_NUMBER = "573009998877";
const puente = require("../src/groups/puente-sofi");

const ORG = { id: "org-1", contact_whatsapp_number: "573009998877" };
const señal = (extra = {}) => ({ id: "sig-1", autor_nombre: "Isabel Restrepo", codigo_colega: "64YV", respuesta_refs: ["9785035"], ...extra });
const mensaje = (extra = {}) => ({
  sesion: "DaianaDiamond", remitenteNombre: "Isabel Restrepo",
  texto: "Hola. Necesito que me valides cuales tienen 2 alcobas con baño", ...extra,
});
const identidad = { telefono: null, lid: "84134751940861@lid" };

function deps(extra = {}) {
  const llamadas = { enviados: [], avisos: [], codigos: 0 };
  const d = {
    historial: async () => [{ id: "dm-1", senal_id: "sig-1" }],
    asignarCodigo: async () => { llamadas.codigos += 1; return "NUEV"; },
    enviar: async (args) => { llamadas.enviados.push(args); return { ok: true }; },
    asesor: async () => ({ id: "adv-daiana" }),
    notificar: async (args) => { llamadas.avisos.push(args); return { ok: true }; },
    ...extra,
  };
  return { d, llamadas };
}

test("a la primera respuesta, sale UN mensaje por la misma linea con el link a Sofi", async () => {
  const { d, llamadas } = deps();
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: señal(), identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "tendido");
  assert.strictEqual(llamadas.enviados.length, 1);
  const envio = llamadas.enviados[0];
  assert.strictEqual(envio.sesion, "DaianaDiamond");
  assert.strictEqual(envio.lid, "84134751940861@lid");
  assert.strictEqual(envio.orgId, "org-1");
  assert.strictEqual(envio.mensajes.length, 1);
  assert.match(envio.mensajes[0].texto, /^¡Hola Isabel!/);
  assert.match(envio.mensajes[0].texto, /Sofi/);
});

test("el link trae el codigo del pedido y la pregunta del colega ya escritos", async () => {
  const { d, llamadas } = deps();
  await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: señal(), identidad, dmId: "dm-1" }, d);
  const link = llamadas.enviados[0].mensajes[0].texto.match(/https:\/\/wa\.me\/\S+/)[0];
  assert.match(link, /^https:\/\/wa\.me\/573009998877\?text=/);
  const textoLink = decodeURIComponent(link.split("?text=")[1]);
  assert.match(textoLink, /cód\. 64YV/);
  assert.match(textoLink, /2 alcobas con baño/);
});

test("queda un aviso en la app para la asesora del radar, con lo que escribio el colega", async () => {
  const { d, llamadas } = deps();
  await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: señal(), identidad, dmId: "dm-1" }, d);
  assert.strictEqual(llamadas.avisos.length, 1);
  const aviso = llamadas.avisos[0];
  assert.strictEqual(aviso.advisor.id, "adv-daiana");
  assert.strictEqual(aviso.orgId, "org-1");
  assert.match(aviso.titulo, /Isabel Restrepo/);
  assert.match(aviso.cuerpo, /2 alcobas con baño/);
});

test("si el colega ya habia escrito antes por este pedido, no se le repite el puente", async () => {
  const { d, llamadas } = deps({
    historial: async () => [{ id: "dm-1", senal_id: "sig-1" }, { id: "dm-0", senal_id: "sig-1" }],
  });
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: señal(), identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "ya_tendido");
  assert.strictEqual(llamadas.enviados.length, 0);
  assert.strictEqual(llamadas.avisos.length, 0);
});

test("una respuesta anterior a OTRO pedido no frena el puente de este", async () => {
  const { d, llamadas } = deps({
    historial: async () => [{ id: "dm-1", senal_id: "sig-1" }, { id: "dm-0", senal_id: "sig-viejo" }],
  });
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: señal(), identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "tendido");
  assert.strictEqual(llamadas.enviados.length, 1);
});

test("sin pedido ligado no se le contesta a nadie", async () => {
  const { d, llamadas } = deps();
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: null, identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "sin_senal");
  assert.strictEqual(llamadas.enviados.length, 0);
});

test("si el pedido no tenia codigo, se le asigna uno", async () => {
  const { d, llamadas } = deps();
  await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: señal({ codigo_colega: null }), identidad, dmId: "dm-1" }, d);
  assert.strictEqual(llamadas.codigos, 1);
  assert.match(decodeURIComponent(llamadas.enviados[0].mensajes[0].texto), /cód\. NUEV/);
});

test("si el envio falla, igual queda el aviso en la app", async () => {
  const { d, llamadas } = deps({ enviar: async () => ({ ok: false, error: "colega_solo_llamada" }) });
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: señal(), identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "envio_fallido");
  assert.strictEqual(llamadas.avisos.length, 1);
});

test("con el interruptor apagado no sale nada", async (t) => {
  process.env.RADAR_PUENTE_SOFI = "false";
  t.after(() => delete process.env.RADAR_PUENTE_SOFI);
  const { d, llamadas } = deps();
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: señal(), identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "apagado");
  assert.strictEqual(llamadas.enviados.length, 0);
  assert.strictEqual(llamadas.avisos.length, 0);
});

test("una pregunta larguisima no rompe el link: se recorta", async () => {
  const { d, llamadas } = deps();
  await puente.tenderPuente(ORG, { mensaje: mensaje({ texto: "x".repeat(2000) }), señal: señal(), identidad, dmId: "dm-1" }, d);
  const link = llamadas.enviados[0].mensajes[0].texto.match(/https:\/\/wa\.me\/\S+/)[0];
  assert.ok(decodeURIComponent(link.split("?text=")[1]).length < 400);
});

// ── Sin pedido ligado (Juan, 2026-10-17: "puente a Sofi también") ─────────
// Caso: Avitárea escribio "me compartes porfa los de 2 y 3 habitaciones" a la
// linea del radar el 5-oct, sin pedido ligado, y nadie le contesto. Si quien
// escribe esta en nuestros grupos (colegas_grupos), se le tiende el mismo
// puente; si no (Wasi cobrando, una empresa de carros), no se le contesta.
test("sin pedido ligado, a un colega de nuestros grupos tambien se le tiende el puente", async () => {
  const { d, llamadas } = deps({ esColega: async () => ({ nombre: "Avitárea" }), historial: async () => [{ id: "dm-1", senal_id: null, created_at: new Date().toISOString() }] });
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje({ remitenteNombre: "Avitárea", texto: "me compartes porfa los de 2 y 3 habitaciones" }), señal: null, identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "tendido");
  const link = llamadas.enviados[0].mensajes[0].texto.match(/https:\/\/wa\.me\/\S+/)[0];
  const textoLink = decodeURIComponent(link.split("?text=")[1]);
  assert.match(textoLink, /colega/i);
  assert.match(textoLink, /2 y 3 habitaciones/);
  assert.strictEqual(llamadas.avisos.length, 1);
});

test("sin pedido ligado y sin ser colega (Wasi, una empresa), no se le contesta", async () => {
  const { d, llamadas } = deps({ esColega: async () => null });
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje({ remitenteNombre: "Wasi" }), señal: null, identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "sin_senal");
  assert.strictEqual(llamadas.enviados.length, 0);
});

test("sin pedido ligado, si el colega ya escribio en la ultima semana no se repite", async () => {
  const hace2dias = new Date(Date.now() - 2 * 864e5).toISOString();
  const { d, llamadas } = deps({
    esColega: async () => ({ nombre: "Avitárea" }),
    historial: async () => [{ id: "dm-1", senal_id: null, created_at: new Date().toISOString() }, { id: "dm-0", senal_id: null, created_at: hace2dias }],
  });
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje(), señal: null, identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "ya_tendido");
  assert.strictEqual(llamadas.enviados.length, 0);
});

// Caso real 2026-10-17: Catherine Uribe ("Cathe U") le escribio a la linea
// del radar "Hola sofy" / "Enviame apto Amoblados" / "Hola sigo esperando".
// No es colega de nuestros grupos ni tiene pedido ligado, pero le hablaba a
// Sofi: la gente cree que esa linea es Sofi porque las fichas van firmadas
// por ella. Si el mensaje SALUDA a Sofi, tambien se le tiende el puente.
test("un saludo a Sofi en la linea del radar recibe el puente aunque no sea colega", async () => {
  const { d, llamadas } = deps({ esColega: async () => null, historial: async () => [{ id: "dm-1", senal_id: null, created_at: new Date().toISOString() }] });
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje({ remitenteNombre: "Cathe U", texto: "Hola sofy" }), señal: null, identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "tendido");
  assert.strictEqual(llamadas.enviados.length, 1);
});

test("un mensaje que solo NOMBRA a Sofi (los resumenes que Sofi le manda a Daiana) no dispara nada", async () => {
  const { d, llamadas } = deps({ esColega: async () => null });
  const r = await puente.tenderPuente(ORG, { mensaje: mensaje({ remitenteNombre: "Diamond", texto: "📋 Daiana, pendientes... 4️⃣ Lo que Sofi ya está haciendo sola" }), señal: null, identidad, dmId: "dm-1" }, d);
  assert.strictEqual(r.resultado, "sin_senal");
  assert.strictEqual(llamadas.enviados.length, 0);
});

// Feed en vivo para el admin (Juan, 2026-08-18): cada pedido del radar que
// Sofi revisa —aprobado o rechazado— le queda en su propia sesion de
// Sofi-Comando. Los aprobados SIGUEN yendo a la asesora sin cambios
// (alerta-asesor.js); esto es un canal paralelo, solo para el admin.

const { test } = require("node:test");
const assert = require("node:assert");
const config = require("../src/config");
const feedComando = require("../src/groups/feed-comando");
const command = require("../src/data/command");

const MENSAJE = { grupo_nombre: "Pedidos Inmobiliarios", autor_nombre: "Alexander Castaño", texto_original: "Busco apto en Laureles" };

const MATCH = { ref: "9944723", titulo: "Apartamento en Laureles", zona: "Laureles", precio: "$600.000.000" };

// ══ construir (pura) ═══════════════════════════════════════════════════════

test("aprobado: encabezado con check, incluye las refs utiles y a quien se avisó", () => {
  const veredicto = { sirve_alguna: true, refs_utiles: ["9944723"], por_que: "Calza en zona y presupuesto." };
  const texto = feedComando.construir(MENSAJE, veredicto, [MATCH], { avisada: true, destinatarioNombre: "Catherine Uribe" });

  assert.match(texto, /^✅ Sofi APROBO/);
  assert.match(texto, /Alexander Castaño/);
  assert.match(texto, /Apartamento en Laureles/);
  assert.match(texto, /Aviso enviado a Catherine Uribe/);
});

test("aprobado pero el aviso NO salio: lo dice, no finge que se avisó", () => {
  const veredicto = { sirve_alguna: true, refs_utiles: ["9944723"], por_que: "Calza." };
  const texto = feedComando.construir(MENSAJE, veredicto, [MATCH], { avisada: false });

  assert.match(texto, /NO salio/);
});

test("rechazado: encabezado con X, sin lista de refs, con el por_que", () => {
  const veredicto = { sirve_alguna: false, refs_utiles: [], por_que: "Pide finca, es apartamento urbano." };
  const texto = feedComando.construir(MENSAJE, veredicto, [MATCH]);

  assert.match(texto, /^❌ Sofi DESCARTO/);
  assert.doesNotMatch(texto, /Le sirve:/);
  assert.match(texto, /finca/);
  assert.doesNotMatch(texto, /Aviso/);
});

test("incluye el desacuerdo con el puntaje cuando lo hay — es el dato que mas sirve para calibrar", () => {
  const veredicto = {
    sirve_alguna: false, refs_utiles: [], por_que: "No sirve.",
    desacuerdo_con_puntaje: "El motor le dio 83 pero esta en otro barrio.",
  };
  const texto = feedComando.construir(MENSAJE, veredicto, [MATCH]);
  assert.match(texto, /Desacuerdo con el puntaje/);
  assert.match(texto, /otro barrio/);
});

test("sin veredicto, no construye nada", () => {
  assert.strictEqual(feedComando.construir(MENSAJE, null, [MATCH]), null);
});

// ══ registrar (efecto) ══════════════════════════════════════════════════════

test("sin adminUserId configurado, no toca la base — es un no-op silencioso", async (t) => {
  const original = config.groups.feedComando.adminUserId;
  config.groups.feedComando.adminUserId = "";
  let tocoSesion = false;
  t.mock.method(command, "ensureSession", async () => { tocoSesion = true; return { id: "s1" }; });

  await feedComando.registrar({ id: "org-1" }, MENSAJE, { sirve_alguna: false, por_que: "x", refs_utiles: [] }, []);

  assert.strictEqual(tocoSesion, false);
  config.groups.feedComando.adminUserId = original;
});

test("con adminUserId configurado, escribe en LA SESION DE ESE ADMIN, con isAdmin:true", async (t) => {
  const original = config.groups.feedComando.adminUserId;
  config.groups.feedComando.adminUserId = "admin-kt";

  let scopeUsado = null;
  t.mock.method(command, "ensureSession", async (scope) => { scopeUsado = scope; return { id: "sesion-admin" }; });
  const guardados = [];
  t.mock.method(command, "appendCommandMessage", async (sessionId, role, content) => { guardados.push({ sessionId, role, content }); });

  await feedComando.registrar(
    { id: "org-1" },
    MENSAJE,
    { sirve_alguna: false, por_que: "no sirve", refs_utiles: [] },
    []
  );

  assert.strictEqual(scopeUsado.viewerUid, "admin-kt");
  assert.strictEqual(scopeUsado.isAdmin, true);
  assert.strictEqual(guardados.length, 1);
  assert.strictEqual(guardados[0].sessionId, "sesion-admin");
  assert.strictEqual(guardados[0].role, "assistant");
  assert.match(guardados[0].content, /DESCARTO/);

  config.groups.feedComando.adminUserId = original;
});

// ══ construirAuto (pura) — camino determinista, sin veredicto de un modelo ══
//
// Juan, 2026-08-19: en modo auto/sombra no hay Sofi validando, pero los
// CALLADOS tienen que quedar en el feed igual que los publicados, para poder
// hacerles seguimiento.

test("callado por compuerta de calidad: encabezado con X y el detalle de que se descarto", () => {
  const texto = feedComando.construirAuto(MENSAJE, "callado", {
    publicables: [],
    descartados: [{ ref: "9944723", motivos: ["puntaje_bajo", "sin_link_wasi"] }],
    decision: null,
  });
  assert.match(texto, /^❌ El radar CALLO/);
  assert.match(texto, /Ninguna propiedad paso la compuerta de calidad/);
  assert.match(texto, /Ref 9944723 — puntaje_bajo, sin_link_wasi/);
});

test("callado por politica (habia candidatas buenas, pero no correspondia hablar)", () => {
  const texto = feedComando.construirAuto(MENSAJE, "callado", {
    publicables: [MATCH],
    descartados: [],
    decision: { publicar: false, motivo: "fuera_de_horario" },
  });
  assert.match(texto, /fuera_de_horario/);
  assert.match(texto, /Habria podido ofrecer:/);
  assert.match(texto, /Apartamento en Laureles/);
});

test("publicado: encabezado con check, lista lo que se ofrecio", () => {
  const texto = feedComando.construirAuto(MENSAJE, "publicado", { publicables: [MATCH], descartados: [] });
  assert.match(texto, /^✅ El radar PUBLICO/);
  assert.match(texto, /Se ofrecio:/);
  assert.doesNotMatch(texto, /Habria podido/);
});

test("sombra: se distingue de publicado — no se publico nada", () => {
  const texto = feedComando.construirAuto(MENSAJE, "sombra", { publicables: [MATCH], descartados: [] });
  assert.match(texto, /sombra, no se publico/);
  assert.doesNotMatch(texto, /^✅ El radar PUBLICO/);
});

// ══ registrarAuto (efecto) ═══════════════════════════════════════════════

test("registrarAuto: sin adminUserId configurado, no toca la base", async (t) => {
  const original = config.groups.feedComando.adminUserId;
  config.groups.feedComando.adminUserId = "";
  let tocoSesion = false;
  t.mock.method(command, "ensureSession", async () => { tocoSesion = true; return { id: "s1" }; });

  await feedComando.registrarAuto({ id: "org-1" }, MENSAJE, "callado", { publicables: [], descartados: [] });

  assert.strictEqual(tocoSesion, false);
  config.groups.feedComando.adminUserId = original;
});

test("registrarAuto: con adminUserId configurado, escribe en su sesion", async (t) => {
  const original = config.groups.feedComando.adminUserId;
  config.groups.feedComando.adminUserId = "admin-kt";

  let scopeUsado = null;
  t.mock.method(command, "ensureSession", async (scope) => { scopeUsado = scope; return { id: "sesion-admin" }; });
  const guardados = [];
  t.mock.method(command, "appendCommandMessage", async (sessionId, role, content) => { guardados.push({ sessionId, role, content }); });

  await feedComando.registrarAuto({ id: "org-1" }, MENSAJE, "publicado", { publicables: [MATCH], descartados: [] });

  assert.strictEqual(scopeUsado.viewerUid, "admin-kt");
  assert.strictEqual(guardados.length, 1);
  assert.match(guardados[0].content, /PUBLICO/);

  config.groups.feedComando.adminUserId = original;
});

// Corte temporal, cliente de WAHA y recomendación (Fase 2).
process.env.GROUPS_WEBHOOK_SECRET = "secreto-de-prueba";

const { test, mock, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const canal = require("../src/channels/whatsapp-group");
const recomendar = require("../src/groups/recomendar");
const allyProperties = require("../src/data/ally-properties");
const advisors = require("../src/data/advisors");
const whatsapp = require("../src/channels/whatsapp");
const { buildGroupDemandAlert } = require("../src/notifications/advisor");

const corte = canal._esAnteriorAlCorte;
const AYER = new Date("2026-07-27T10:00:00Z").getTime();
const HOY = new Date("2026-07-28T10:00:00Z").getTime();
const SESION = { escucha_desde: "2026-07-28T08:00:00Z" };

// ══ Corte temporal ═══════════════════════════════════════════════════════

test("CORTE: un mensaje anterior al pareo se descarta", () => {
  // Al vincular, WhatsApp puede sincronizar historial. Una propiedad publicada
  // hace tres meses casi seguro ya se vendió: recomendársela a un cliente real
  // es daño de reputación, no un bug menor.
  assert.strictEqual(corte(AYER, SESION, null), true);
});

test("CORTE: un mensaje de después del pareo pasa", () => {
  assert.strictEqual(corte(HOY, SESION, null), false);
});

test("CORTE: prender un grupo hoy no arrastra lo de la semana pasada", () => {
  // Manda el más tardío de los dos cortes: la línea puede escuchar desde hace
  // un mes, pero este grupo se prendió recién.
  const grupo = { escuchaDesde: "2026-07-28T09:00:00Z" };
  const sesionVieja = { escucha_desde: "2026-06-01T00:00:00Z" };
  assert.strictEqual(corte(new Date("2026-07-28T08:30:00Z").getTime(), sesionVieja, grupo), true);
  assert.strictEqual(corte(new Date("2026-07-28T09:30:00Z").getTime(), sesionVieja, grupo), false);
});

test("CORTE: un mensaje sin fecha se descarta", () => {
  // Si no se puede probar que es de hoy, no entra: equivocarse hacia el otro
  // lado cuesta mucho más.
  assert.strictEqual(corte(null, SESION, null), true);
  assert.strictEqual(corte(undefined, SESION, null), true);
});

test("CORTE: sin corte configurado no se filtra nada", () => {
  assert.strictEqual(corte(AYER, null, null), false);
});

// ══ Cliente de WAHA ══════════════════════════════════════════════════════

test("el cliente de WAHA no implementa NINGÚN endpoint de envío", () => {
  // WAHA expone /api/sendText y compañía. Que este cliente no los tenga es la
  // otra mitad de la promesa al asesor: no es un flag apagado, la capacidad no
  // existe en el código.
  const fuente = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "waha.js"), "utf8");
  const codigo = fuente.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const prohibido of ["sendText", "sendImage", "sendFile", "sendVoice", "sendSeen", "startTyping", "/api/send"]) {
    assert.ok(!codigo.includes(prohibido), `el cliente de WAHA menciona '${prohibido}'`);
  }
});

// ══ Normalización hacia ally_properties ══════════════════════════════════

test("la operación se capitaliza — ally_properties lo exige por check", () => {
  // El check de la tabla acepta 'Venta' | 'Arriendo'; el clasificador devuelve
  // minúsculas. Sin normalizar, cada inserción revienta.
  assert.strictEqual(recomendar.operacionCanonica("venta"), "Venta");
  assert.strictEqual(recomendar.operacionCanonica("arriendo"), "Arriendo");
  assert.strictEqual(recomendar.operacionCanonica("ARRIENDO "), "Arriendo");
  assert.strictEqual(recomendar.operacionCanonica("permuta"), null);
  assert.strictEqual(recomendar.operacionCanonica(""), null);
});

test("el precio se guarda como texto — así lo espera la columna", () => {
  assert.strictEqual(recomendar.precioTexto(650000000), "$650.000.000");
  assert.strictEqual(recomendar.precioTexto(0), null);
});

// ══ Caducidad de las propiedades de grupo ════════════════════════════════

test("una propiedad de grupo vieja deja de ofrecerse", () => {
  const vieja = { origen: "grupo", visto_en_grupo_at: new Date(Date.now() - 40 * 86400000).toISOString() };
  const fresca = { origen: "grupo", visto_en_grupo_at: new Date().toISOString() };
  assert.strictEqual(allyProperties.vigente(vieja), false);
  assert.strictEqual(allyProperties.vigente(fresca), true);
});

test("las registradas por un asesor NO caducan — es el comportamiento histórico", () => {
  assert.strictEqual(allyProperties.vigente({ origen: "asesor", visto_en_grupo_at: null }), true);
});

test("una de grupo sin fecha de visto no se ofrece", () => {
  assert.strictEqual(allyProperties.vigente({ origen: "grupo", visto_en_grupo_at: null }), false);
});

test("la dedup de grupo va por colega + características, no por ref", () => {
  // Los mensajes de grupo casi nunca traen ref, y los colegas republican la
  // misma propiedad cada semana con "sigue disponible".
  const a = { origen: "grupo", contacto_telefono: "573001112233", tipo: "Casa", zona: "Sabaneta", precio: "$650.000.000" };
  assert.strictEqual(allyProperties.mismaPropiedadDeGrupo(a, { ...a, tipo: "casa", zona: " SABANETA " }), true);
  assert.strictEqual(allyProperties.mismaPropiedadDeGrupo(a, { ...a, zona: "Envigado" }), false);
  assert.strictEqual(allyProperties.mismaPropiedadDeGrupo({ ...a, origen: "asesor" }, a), false);
});

// ══ Acciones de la Fase 2 ════════════════════════════════════════════════

const oferta = (modo) => ({
  clase: "oferta", operacion: "venta", tipo: "casa", zona: "Sabaneta", ciudad: "",
  precio_max: 650000000, precio_min: 0, contacto: "", notas: "3 alcobas", utilizable: true,
  mensaje: { modo, autor: "Diana", autorTelefono: "573001112233", texto: "Se vende casa", groupId: "g1", advisorId: "adv1" },
});

const demanda = (modo, matches = [{ fuente: "diamond", ref: "9921388", zona: "Laureles", precio: "$380.000.000" }]) => ({
  clase: "demanda", operacion: "venta", tipo: "apartamento", zona: "Laureles",
  habitaciones: 3, precio_max: 400000000, matches,
  mensaje: { modo, autor: "Carlos", texto: "Tengo cliente para apto en Laureles", grupo: "Inmobiliarias", groupId: "g1", advisorId: "adv1" },
});

beforeEach(() => mock.restoreAll());

test("en modo sombra NO se toca nada — se detecta y se calla", async () => {
  const crear = mock.method(allyProperties, "create", async () => ({}));
  const enviar = mock.method(whatsapp, "sendWhatsApp", async () => ({ ok: true }));
  const r = await recomendar.recomendar({ id: "o1" }, { demandas: [demanda("sombra")], ofertas: [oferta("sombra")] });
  assert.deepStrictEqual(r, { aliadas: 0, alertas: 0 });
  assert.strictEqual(crear.mock.callCount(), 0);
  assert.strictEqual(enviar.mock.callCount(), 0);
});

test("en modo sugerir la oferta entra a ally_properties con origen grupo", async () => {
  const crear = mock.method(allyProperties, "create", async () => ({ id: "ap1" }));
  mock.method(whatsapp, "sendWhatsApp", async () => ({ ok: true }));
  const r = await recomendar.recomendar({ id: "o1" }, { demandas: [], ofertas: [oferta("sugerir")] });
  assert.strictEqual(r.aliadas, 1);
  const fields = crear.mock.calls[0].arguments[1];
  assert.strictEqual(fields.origen, "grupo");
  assert.strictEqual(fields.operacion, "Venta");
  assert.strictEqual(fields.precio, "$650.000.000");
  assert.strictEqual(fields.puente_advisor_id, "adv1");
  assert.ok(fields.visto_en_grupo_at, "sin fecha de visto no se podría caducar");
});

test("una oferta inutilizable NO ensucia la red de aliados", async () => {
  // Sin precio o sin zona es una fila muerta: Sofi nunca podría recomendarla.
  const crear = mock.method(allyProperties, "create", async () => ({}));
  const o = { ...oferta("sugerir"), utilizable: false, faltantes: ["precio"] };
  const r = await recomendar.recomendar({ id: "o1" }, { demandas: [], ofertas: [o] });
  assert.strictEqual(r.aliadas, 0);
  assert.strictEqual(crear.mock.callCount(), 0);
});

test("en modo sugerir la demanda con match avisa al asesor puente", async () => {
  mock.method(advisors, "findById", async () => ({ id: "adv1", phone: "573001234567", name: "Andrés" }));
  const enviar = mock.method(whatsapp, "sendWhatsApp", async () => ({ ok: true }));
  const r = await recomendar.recomendar({ id: "o1" }, { demandas: [demanda("sugerir")], ofertas: [] });
  assert.strictEqual(r.alertas, 1);
  assert.strictEqual(enviar.mock.calls[0].arguments[1], "573001234567");
});

test("una demanda SIN match no molesta al asesor", async () => {
  // La fatiga de alertas es el riesgo principal de esta dirección.
  mock.method(advisors, "findById", async () => ({ phone: "573001234567" }));
  const enviar = mock.method(whatsapp, "sendWhatsApp", async () => ({ ok: true }));
  const r = await recomendar.recomendar({ id: "o1" }, { demandas: [demanda("sugerir", [])], ofertas: [] });
  assert.strictEqual(r.alertas, 0);
  assert.strictEqual(enviar.mock.callCount(), 0);
});

test("si una oferta falla, la otra igual entra", async () => {
  let n = 0;
  mock.method(allyProperties, "create", async () => {
    if (++n === 1) throw new Error("Supabase caído");
    return { id: "ap2" };
  });
  const r = await recomendar.recomendar({ id: "o1" }, { demandas: [], ofertas: [oferta("sugerir"), oferta("sugerir")] });
  assert.strictEqual(r.aliadas, 1);
});

// ══ El borrador para el asesor ═══════════════════════════════════════════

test("el aviso lleva el pedido, las refs y le pide que escriba él", () => {
  const d = demanda("sugerir");
  const texto = buildGroupDemandAlert(d, d.mensaje);
  assert.match(texto, /Carlos pide en Inmobiliarias/);
  assert.match(texto, /9921388/);
  assert.match(texto, /Laureles/);
  // No es un bloque para pegar tal cual: si el asesor pega quince veces el
  // mismo formato milimétrico, el grupo lo huele igual que a un bot.
  assert.match(texto, /con tus palabras, no copiando esto tal cual/);
});

// La politica de respuesta es el freno del sistema. Cada test de aca describe
// una forma concreta de quedar mal en un grupo de 80 inmobiliarias.
//
// Regla que ordena la suite: el caso que PUBLICA es uno solo; todos los demas
// callan. Si algun dia el balance se invierte, algo se rompio.

const { test } = require("node:test");
const assert = require("node:assert");
const politica = require("../src/groups/politica");

// Mediodia en Colombia (17:00 UTC), dentro del horario comercial.
const MEDIODIA = new Date("2026-08-17T17:00:00Z");

function escenario(extra = {}) {
  return {
    senal: { clase: "demanda", confianza: 0.95, respondida_at: null },
    publicables: [{ ref: "AP004", puntaje: 88 }],
    grupo: { responde: true },
    modo: "auto",
    respuestasRecientes: 0,
    ultimaRespuestaIso: null,
    ahora: MEDIODIA,
    ...extra,
  };
}

function motivo(extra) {
  return politica.decidir(escenario(extra)).motivo;
}

test("con todo en orden, se publica", () => {
  const d = politica.decidir(escenario());
  assert.strictEqual(d.publicar, true);
  assert.strictEqual(d.motivo, "ok");
  // La traza deja escrito que se verifico, para poder auditarlo despues.
  assert.ok(d.traza.includes("grupo:habilitado"));
  assert.ok(d.traza.includes("publicables:1"));
});

test("un grupo no habilitado nunca recibe respuesta", () => {
  // Es el gate mas importante: importar una linea trae TODOS sus grupos de
  // golpe (la asesora de julio tenia 80). Sin esto, un clic pone al bot a
  // hablar en ochenta grupos a la vez.
  assert.strictEqual(motivo({ grupo: { responde: false } }), "grupo_no_habilitado");
  assert.strictEqual(motivo({ grupo: {} }), "grupo_no_habilitado");
});

test("el modo apagado calla, y cualquier valor raro tambien", () => {
  // Fail-closed: si la variable de entorno viene con un typo, el bot NO habla.
  assert.strictEqual(motivo({ modo: "apagado" }), "modo_apagado");
  assert.strictEqual(motivo({ modo: "" }), "modo_apagado");
  assert.strictEqual(motivo({ modo: "AUTO" }), "modo_apagado");
});

test("el modo sombra corre exactamente las mismas comprobaciones", () => {
  // La prueba de humo no sirve si simula distinto a produccion.
  const d = politica.decidir(escenario({ modo: "sombra" }));
  assert.strictEqual(d.publicar, true);
  assert.strictEqual(motivo({ modo: "sombra", grupo: { responde: false } }), "grupo_no_habilitado");
  assert.strictEqual(motivo({ modo: "sombra", senal: { clase: "demanda", confianza: 0.4 } }), "confianza_baja");
});

test("solo se responden demandas, nunca ofertas ajenas", () => {
  // Contestarle a un colega que ofrece su propiedad no tiene sentido comercial
  // y se lee como un bot que no entiende el grupo.
  assert.strictEqual(motivo({ senal: { clase: "oferta", confianza: 0.99 } }), "no_es_demanda");
  assert.strictEqual(motivo({ senal: { clase: "ruido", confianza: 0.99 } }), "no_es_demanda");
  assert.strictEqual(motivo({ senal: null }), "no_es_demanda");
});

test("un pedido entendido a medias no se responde", () => {
  assert.strictEqual(motivo({ senal: { clase: "demanda", confianza: 0.84 } }), "confianza_baja");
  assert.strictEqual(motivo({ senal: { clase: "demanda", confianza: null } }), "confianza_baja");
  const justo = politica.decidir(escenario({ senal: { clase: "demanda", confianza: 0.85 } }));
  assert.strictEqual(justo.publicar, true);
});

test("una demanda ya respondida no se responde de nuevo", () => {
  // El mismo aviso se difunde a diez grupos: sin esto, diez respuestas.
  assert.strictEqual(motivo({ senal: { clase: "demanda", confianza: 0.95, respondida_at: "2026-08-17T15:00:00Z" } }), "ya_respondida");
});

// EDIFICIO ESPECIFICO (Juan, 2026-08-21 — caso Esteban Higuita, "edificio
// Murano Plaza" en Envigado): un puntaje alto por zona/precio no dice nada
// sobre si el match es EL edificio pedido — Wasi no marca por edificio.
test("un pedido que nombra un edificio especifico nunca se publica solo, aunque el match sea perfecto", () => {
  assert.strictEqual(motivo({ senal: { clase: "demanda", confianza: 0.95, respondida_at: null, edificio: "Murano Plaza" } }), "edificio_especifico");
});

test("sin nombrar edificio, la señal se publica normal (no se frena por algo que no aplica)", () => {
  const d = politica.decidir(escenario({ senal: { clase: "demanda", confianza: 0.95, respondida_at: null, edificio: "" } }));
  assert.strictEqual(d.publicar, true);
  assert.ok(d.traza.includes("sin_edificio_especifico"));
});

test("SIN restriccion de horario (Juan, 2026-08-20): el radar publica 24/7", () => {
  // Antes esto se callaba fuera de las 8am-7pm de Colombia. Un pedido real a
  // las 3am de un cliente no espera menos que uno a mediodia, y el que
  // llegaba antes de abrir la ventana se perdia para siempre sin reintento.
  assert.strictEqual(politica.decidir(escenario({ ahora: new Date("2026-08-17T08:00:00Z") })).publicar, true);
  assert.strictEqual(politica.decidir(escenario({ ahora: new Date("2026-08-18T01:00:00Z") })).publicar, true);
});


test("por defecto NO hay tope diario: si hay mil pedidos con match, se responden mil", () => {
  // Decision de producto (Juan, 2026-08-16). Un tope descarta pedidos buenos sin
  // mejorar la calidad de lo que se publica — de eso ya se ocupa publicable.js.
  assert.strictEqual(politica.LIMITES_DEFAULT.maxPorGrupoDia, 0);
  assert.strictEqual(politica.decidir(escenario({ respuestasRecientes: 0 })).publicar, true);
  assert.strictEqual(politica.decidir(escenario({ respuestasRecientes: 47 })).publicar, true);
  assert.strictEqual(politica.decidir(escenario({ respuestasRecientes: 999 })).publicar, true);
});

test("sin tope diario, no se exige poder contar las respuestas del dia", () => {
  // Antes se callaba si el conteo fallaba. Sin tope no hay nada que verificar,
  // así que un problema de la base no puede silenciar al radar por su cuenta.
  const d = politica.decidir(escenario({ respuestasRecientes: null }));
  assert.strictEqual(d.publicar, true);
  assert.ok(d.traza.includes("sin_tope_diario"));
});

test("si se configura un tope, se respeta y exige poder verificarlo", () => {
  // La capacidad queda por si el gremio reacciona mal al volumen: se pone un
  // numero en GRUPOS_RESPUESTA_MAX_DIA y se apaga sin tocar codigo.
  const conTope = { ...politica.LIMITES_DEFAULT, maxPorGrupoDia: 3 };
  assert.strictEqual(politica.decidir(escenario({ respuestasRecientes: 2, limites: conTope })).publicar, true);
  assert.strictEqual(motivo({ respuestasRecientes: 3, limites: conTope }), "limite_alcanzado");
  assert.strictEqual(motivo({ respuestasRecientes: null, limites: conTope }), "limite_no_verificable");
});

test("sin propiedades que pasen la compuerta, no hay nada que decir", () => {
  assert.strictEqual(motivo({ publicables: [] }), "sin_propiedades_publicables");
});

test("el motivo del silencio siempre queda registrado en la traza", () => {
  const d = politica.decidir(escenario({ publicables: [] }));
  assert.strictEqual(d.publicar, false);
  assert.ok(d.traza.at(-1).startsWith("NO:"), "la traza tiene que terminar diciendo por que no");
  assert.ok(d.traza.includes("clase:demanda"), "y conservar lo que si se verifico");
});

// ── decidirDm: el freno del DM directo al colega (Juan, 2026-08-24) ──────
//
// Distinto de `decidir`: protege al COLEGA (spam a una persona) y a la LINEA
// (volumen), no la calidad del dato ni el permiso del grupo. Ningun motivo de
// aca descarta el pedido — todos desvian a la asesora, eso lo prueba vivo.js.

const AHORA_DM = new Date("2026-08-24T15:00:00Z");

function escenarioDm(extra = {}) {
  return {
    telefono: "573001234567",
    fechaMensajeIso: new Date(AHORA_DM.getTime() - 5 * 60 * 1000).toISOString(), // hace 5 min
    ahora: AHORA_DM,
    dmsHoyColega: 0,
    dmsHoyLinea: 0,
    ...extra,
  };
}

test("con todo en orden (telefono, pedido reciente, cupo libre), se manda el DM", () => {
  const d = politica.decidirDm(escenarioDm());
  assert.strictEqual(d.enviarDm, true);
  assert.strictEqual(d.motivo, "ok");
  assert.ok(d.traza.includes("telefono:resuelto"));
});

test("sin telefono resuelto, se calla (y vivo.js cae a la asesora)", () => {
  const d = politica.decidirDm(escenarioDm({ telefono: null }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "sin_telefono");
});

test("sin la fecha del mensaje, no se puede medir la antiguedad -- se calla", () => {
  const d = politica.decidirDm(escenarioDm({ fechaMensajeIso: null }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "sin_fecha_mensaje");
});

test("un pedido mas viejo que el limite de antiguedad no se manda por DM", () => {
  // Default 30 min: a los 31 min ya se calla. La fecha es la DEL MENSAJE en el
  // grupo, no la de la fila (ver la nota de esAnteriorAlCorte en
  // src/channels/whatsapp-group.js: un backlog al arrancar es viejo aunque la
  // fila sea de hoy).
  const viejo = escenarioDm({ fechaMensajeIso: new Date(AHORA_DM.getTime() - 31 * 60 * 1000).toISOString() });
  assert.strictEqual(politica.decidirDm(viejo).motivo, "pedido_vencido");

  const justo = escenarioDm({ fechaMensajeIso: new Date(AHORA_DM.getTime() - 30 * 60 * 1000).toISOString() });
  assert.strictEqual(politica.decidirDm(justo).enviarDm, true);
});

test("un colega ya contactado hoy (tope 1) no recibe un segundo DM", () => {
  const d = politica.decidirDm(escenarioDm({ dmsHoyColega: 1 }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "limite_colega_alcanzado");
});

test("si no se puede contar cuantos DMs recibio el colega hoy, se calla -- ante la duda, no", () => {
  const d = politica.decidirDm(escenarioDm({ dmsHoyColega: null }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "limite_colega_no_verificable");
});

test("al tope diario de la linea (150), se calla -- es cortacircuito, no cuota", () => {
  assert.strictEqual(politica.LIMITES_DM_DEFAULT.topeDiarioLinea, 150);
  const d = politica.decidirDm(escenarioDm({ dmsHoyLinea: 150 }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "limite_linea_alcanzado");

  const conCupo = politica.decidirDm(escenarioDm({ dmsHoyLinea: 149 }));
  assert.strictEqual(conCupo.enviarDm, true);
});

test("si no se puede contar el volumen de la linea, se calla", () => {
  const d = politica.decidirDm(escenarioDm({ dmsHoyLinea: null }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "limite_linea_no_verificable");
});

test("los tres defaults son los pedidos: 1 DM/colega/dia, 30 min de antiguedad, 150/dia la linea", () => {
  assert.strictEqual(politica.LIMITES_DM_DEFAULT.dmsPorColegaDia, 1);
  assert.strictEqual(politica.LIMITES_DM_DEFAULT.antiguedadMaximaMin, 30);
  assert.strictEqual(politica.LIMITES_DM_DEFAULT.topeDiarioLinea, 150);
});

test("la traza de decidirDm tambien termina en NO: cuando se calla", () => {
  const d = politica.decidirDm(escenarioDm({ telefono: null }));
  assert.strictEqual(d.enviarDm, false);
  assert.ok(d.traza.at(-1).startsWith("NO:"));
});

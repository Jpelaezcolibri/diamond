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
  // `destino:telefono` reemplazo a `telefono:resuelto` (Juan, 2026-09-04):
  // ahora hay DOS vias posibles y la traza tiene que decir cual se uso, no
  // solo que habia telefono. Es lo que permite medir cuantos DMs salen por
  // numero y cuantos por identificador oculto.
  assert.ok(d.traza.includes("destino:telefono"), d.traza.join(","));
});

// ── EL LID COMO DESTINO VALIDO (Juan, 2026-09-04) ────────────────────────
//
// "todo lo que se pueda resolver con el lids lo hacemos por ahi". Ese mismo
// dia se confirmo con una entrega real que WhatsApp SI entrega un DM a
// <lid>@lid cuando el destinatario comparte un grupo con la linea, y se
// apago el descubrimiento de telefonos contra WAHA (rate-overlimit, y 9 de
// cada 10 colegas no exponen numero). Sin esta regla, apagar el
// descubrimiento significaria responderle a menos colegas.
test("sin telefono pero con lid, el DM sale igual por el identificador oculto", () => {
  const d = politica.decidirDm(escenarioDm({ telefono: null, lid: "141746805670125" }));
  assert.strictEqual(d.enviarDm, true);
  assert.strictEqual(d.motivo, "ok");
  assert.strictEqual(d.via, "lid");
  assert.ok(d.traza.includes("destino:lid"), d.traza.join(","));
});

test("con telefono Y lid se prefiere el telefono: es el destino verificado", () => {
  // El lid resuelve al mismo chat, pero el numero es el dato que ya se
  // confirmo (esCelularColombiano) y el que despues sirve para el link
  // wa.me del aviso a la asesora.
  const d = politica.decidirDm(escenarioDm({ lid: "141746805670125" }));
  assert.strictEqual(d.enviarDm, true);
  assert.strictEqual(d.via, "telefono");
  assert.ok(!d.traza.includes("destino:lid"), d.traza.join(","));
});

test("sin telefono y sin lid no hay a quien escribirle: se calla (y vivo.js cae a la asesora)", () => {
  // El motivo sigue llamandose `sin_telefono` a proposito: es la clave que
  // leen alerta-asesor.js (el texto que explica por que no salio solo),
  // digest-avisos.js y la consulta de src/api/crm.js. Lo que cambio es
  // cuando se emite -- ahora solo cuando NO hay ningun destino, no cada vez
  // que falta el numero.
  const d = politica.decidirDm(escenarioDm({ telefono: null, lid: null }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "sin_telefono");
  assert.strictEqual(d.via, null);
});

test("un lid con forma de basura no es un destino: se calla", () => {
  // waha.enviarDm exige >= 10 digitos para armar el chatId; un lid mas corto
  // (o vacio, o no numerico) no puede pasar por destino valido aca y hacer
  // que el pedido se de por respondido sin que salga nada.
  for (const basura of ["", "  ", "123", "abc", null, undefined]) {
    const d = politica.decidirDm(escenarioDm({ telefono: null, lid: basura }));
    assert.strictEqual(d.enviarDm, false, `el lid ${basura} no puede ser destino`);
    assert.strictEqual(d.motivo, "sin_telefono");
  }
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

// TOPE POR COLEGA QUITADO (Juan, 2026-09-04): "quita la restriccion de la
// cantidad de mensajes a un mismo colega ya que vamos a tener respuestas
// directas a mensajes enviados por ellos, entonces no veo el problema de que
// respondamos a mas de 2 mensajes en un dia".
//
// Lo que sigue protegiendo contra el spam NO es este tope: es el dedup por
// contenido (el mismo pedido difundido a cinco grupos manda UN solo DM) y la
// antiguedad maxima. Los dos siguen en pie.
test("un colega con tres pedidos distintos en el dia recibe los tres", () => {
  assert.strictEqual(politica.decidirDm(escenarioDm({ dmsHoyColega: 2 })).enviarDm, true);
  assert.strictEqual(politica.decidirDm(escenarioDm({ dmsHoyColega: 9 })).enviarDm, true);
});

// No poder contar los DMs del colega ya no puede frenar nada: sin tope, el
// numero es informacion para medir, no una compuerta.
test("no poder contar los DMs del colega ya no frena el envio", () => {
  const d = politica.decidirDm(escenarioDm({ dmsHoyColega: null }));
  assert.strictEqual(d.enviarDm, true);
});

// Se sigue registrando para poder medir el volumen por colega.
test("el conteo por colega sigue quedando en la traza", () => {
  const d = politica.decidirDm(escenarioDm({ dmsHoyColega: 4 }));
  assert.ok(d.traza.some((t) => t.includes("dms_colega_hoy:4")), d.traza.join(","));
});

// El tope de LA LINEA no se toca: es cortacircuitos, no cuota.
//
// (Aca vivia "el tope diario de la linea sigue frenando", borrado en la
// revision final del 2026-09-04: su unica asercion era la misma del test de
// abajo, que ademas prueba el borde con cupo.)
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

// LOS DEFAULTS, Y QUE RIGE CADA UNO. `dmsPorColegaDia` ya no esta en la lista
// (Juan, 2026-09-04): decidirDm dejo de aplicarlo, y el mismo dia los dos
// caminos manuales de vivo.js tambien perdieron el tope, asi que la propiedad
// se quedo sin un solo lector y se borro. La asercion de abajo es lo que
// impide que vuelva a aparecer como una perilla que no mueve nada.
test("los defaults del DM, y de quien es cada uno", () => {
  // Estos tres SI son compuertas de decidirDm.
  assert.strictEqual(politica.LIMITES_DM_DEFAULT.antiguedadMaximaMin, 30);
  assert.strictEqual(politica.LIMITES_DM_DEFAULT.topeDiarioLinea, 150);
  // La perilla del cortacircuitos por la cuota de WhatsApp (RADAR_DM_CUOTA_MAX):
  // 0.8 de 300 = 240, con 60 de colchon. No tenia ninguna asercion, y es la
  // proteccion mas nueva de la linea -- la que ya fue baneada una vez. Los
  // caminos MANUALES no usan esta fraccion: cortan al 100% (ver
  // vivo.js#cuotaAgotada y test/group-vivo.test.js).
  assert.strictEqual(politica.LIMITES_DM_DEFAULT.fraccionCuotaMaxima, 0.8);
  // Ningun tope por colega, en ningun camino.
  assert.ok(!("dmsPorColegaDia" in politica.LIMITES_DM_DEFAULT));
});

test("la traza de decidirDm tambien termina en NO: cuando se calla", () => {
  const d = politica.decidirDm(escenarioDm({ telefono: null, lid: null }));
  assert.strictEqual(d.enviarDm, false);
  assert.ok(d.traza.at(-1).startsWith("NO:"));
});

// CORTACIRCUITOS POR LA CUOTA DE WHATSAPP (2026-09-04). Es la unica adicion al
// pedido literal de Juan, y la aprobo: sin esto, abrir la manguera agota los
// 300 mensajes del ciclo cerca del dia 18 y el radar queda mudo el resto del
// mes. FRENA, NO DESCARTA: el pedido sigue llegando a Natalia.
const CUOTA_OK = { usados: 100, total: 300, fraccion: 100 / 300 };
const CUOTA_ALTA = { usados: 240, total: 300, fraccion: 0.8 };

test("con la cuota de WhatsApp al 80% no sale ningun DM", () => {
  const d = politica.decidirDm(escenarioDm({ cuotaLinea: CUOTA_ALTA }));
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "cuota_whatsapp_alta");
});

test("con cuota holgada el DM sale y queda registrada en la traza", () => {
  const d = politica.decidirDm(escenarioDm({ cuotaLinea: CUOTA_OK }));
  assert.strictEqual(d.enviarDm, true);
  assert.ok(d.traza.some((t) => t.includes("cuota_wa:100/300")), d.traza.join(","));
});

// DECISION DELIBERADA, distinta al resto del archivo: no poder leer la cuota
// NO frena. El principio "ante la duda, no" se aplica a los datos que son la
// unica proteccion; aca queda `topeDiarioLinea` cubriendo el mismo eje. Callar
// el radar entero por un hipo de WAHA es peor que el riesgo que evita.
test("no poder leer la cuota no frena el DM: queda el tope diario de la linea", () => {
  assert.strictEqual(politica.decidirDm(escenarioDm({ cuotaLinea: null })).enviarDm, true);
});

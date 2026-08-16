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
  assert.strictEqual(motivo({ modo: "sombra", respuestasRecientes: 3 }), "limite_alcanzado");
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

test("fuera del horario comercial colombiano, silencio", () => {
  // 08:00 UTC son las 03:00 en Colombia.
  assert.strictEqual(motivo({ ahora: new Date("2026-08-17T08:00:00Z") }), "fuera_de_horario");
  // 01:00 UTC del dia 18 son las 20:00 del 17 en Colombia: ya cerro.
  assert.strictEqual(motivo({ ahora: new Date("2026-08-18T01:00:00Z") }), "fuera_de_horario");
  // 13:00 UTC son las 08:00: abre.
  assert.strictEqual(politica.decidir(escenario({ ahora: new Date("2026-08-17T13:00:00Z") })).publicar, true);
});

test("la hora se calcula en Bogota, no en UTC", () => {
  // El servidor corre en UTC; restar cinco a mano se rompe en el borde del dia.
  assert.strictEqual(politica.horaEnBogota(new Date("2026-08-17T17:00:00Z")), 12);
  assert.strictEqual(politica.horaEnBogota(new Date("2026-08-18T02:00:00Z")), 21);
});

test("si no se puede contar cuantas veces hablamos hoy, se calla", () => {
  // null NO es cero. Cuando falta la migracion o falla la base, el sistema esta
  // a ciegas: publicar sin poder verificar el limite es exactamente el momento
  // en que se dispara la rafaga.
  assert.strictEqual(motivo({ respuestasRecientes: null }), "limite_no_verificable");
  assert.strictEqual(motivo({ respuestasRecientes: undefined }), "limite_no_verificable");
});

test("el limite por grupo y por dia se respeta", () => {
  assert.strictEqual(politica.decidir(escenario({ respuestasRecientes: 2 })).publicar, true);
  assert.strictEqual(motivo({ respuestasRecientes: 3 }), "limite_alcanzado");
  assert.strictEqual(motivo({ respuestasRecientes: 99 }), "limite_alcanzado");
});

test("el cooldown evita la rafaga cuando entran varios pedidos juntos", () => {
  const haceCinco = new Date(MEDIODIA.getTime() - 5 * 60000).toISOString();
  assert.strictEqual(motivo({ ultimaRespuestaIso: haceCinco }), "en_cooldown");

  const haceTreinta = new Date(MEDIODIA.getTime() - 30 * 60000).toISOString();
  assert.strictEqual(politica.decidir(escenario({ ultimaRespuestaIso: haceTreinta })).publicar, true);
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

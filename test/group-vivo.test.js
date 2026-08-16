// El pipeline de un mensaje en vivo, de punta a punta.
//
// Se prueba con las dependencias reemplazadas (require.cache) porque lo que
// importa aca no es que Haiku clasifique bien —eso ya lo cubre
// group-classify.test.js— sino QUE SE PUBLICA Y QUE NO. Cada camino que termina
// en un mensaje dentro de un grupo gremial tiene su test.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));

// ── Dobles de las dependencias con IO ────────────────────────────────────
let claseDevuelta = "demanda";
let matchesDevueltos = [];
let señalCreada = null;
let respuestasRecientes = { cantidad: 0, ultimaIso: null };
let marcadas = [];
let ofertasGuardadas = [];

function instalarDobles() {
  require.cache[RUTA("groups/classify.js")] = {
    exports: {
      classify: async (ms) => ({
        clasificados: ms.map((m) => ({
          id: m.id, clase: claseDevuelta, confianza: 0.95, operacion: "venta",
          tipo: "apartamento", zona: "el poblado", ciudad: "medellin",
          precio_min: 0, precio_max: 1200000000, habitaciones: 0, area_min: 0,
          banos: 0, garajes: 0, estrato: 0, contacto: "", notas: "", mensaje: m,
        })),
        uso: { costoUsd: 0 }, lotesFallidos: 0, reintentos: 0, lotes: 1,
      }),
    },
  };
  require.cache[RUTA("groups/match.js")] = {
    exports: {
      cruzar: async (cs) => {
        const c = { ...cs[0], matches: matchesDevueltos, utilizable: true };
        return claseDevuelta === "oferta"
          ? { demandas: [], ofertas: [c], ruido: [] }
          : { demandas: [c], ofertas: [], ruido: [] };
      },
    },
  };
  require.cache[RUTA("groups/persistir.js")] = {
    exports: {
      persistirSenal: async (org, c, opts) => {
        señalCreada = { org, c, opts };
        return { signal: { id: "sig-1", respondida_at: null }, duplicado: false };
      },
    },
  };
  require.cache[RUTA("groups/ofertas.js")] = {
    exports: { guardarOferta: async (org, o) => { ofertasGuardadas.push(o); } },
  };
  require.cache[RUTA("data/group-signals.js")] = {
    exports: {
      respuestasDesde: async () => respuestasRecientes,
      marcarRespondida: async (orgId, id, datos) => { marcadas.push({ id, ...datos }); return true; },
    },
  };
  require.cache[RUTA("data/organizations.js")] = {
    exports: { radarEncendido: (org) => org.radar_activo !== false },
  };
  delete require.cache[RUTA("groups/vivo.js")];
  return require("../src/groups/vivo");
}

const ORG = { id: "org-1", radar_activo: true };
const GRUPO = { id: "grp-1", jid: "vivo:gremial", nombre: "Gremial", responde: true };
const MEDIODIA = new Date("2026-08-17T17:00:00Z");

function mensaje(extra = {}) {
  return {
    id: "m1",
    waMessageId: "wamid.ABC123",
    texto: "busco apartamento en el poblado de 100 mts2 presupuesto 1.200 millones",
    autor: "Patricia Gomez",
    autorTelefono: "573001234567",
    instanteIso: MEDIODIA.toISOString(),
    esSistema: false,
    esMultimedia: false,
    ...extra,
  };
}

function matchBueno(extra = {}) {
  return {
    fuente: "diamond", ref: "AP004", titulo: "Apartamento en Venta Envigado",
    zona: "Centro, Envigado", precio: "$395.000.000", operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/ap004",
    habitaciones: 2, area: "62m2", puntaje: 88, razones: [], ...extra,
  };
}

let vivo;
beforeEach(() => {
  claseDevuelta = "demanda";
  matchesDevueltos = [matchBueno()];
  señalCreada = null;
  respuestasRecientes = { cantidad: 0, ultimaIso: null };
  marcadas = [];
  ofertasGuardadas = [];
  vivo = instalarDobles();
});

test("una demanda con match publicable se publica y queda registrada", async () => {
  const enviados = [];
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA,
    asesor: { name: "katherine Uribe", phone: "573028536489" },
    enviar: async (texto) => { enviados.push(texto); return { ok: true, wamid: "wamid.OUT" }; },
  });

  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0], /Ref AP004/);
  assert.match(enviados[0], /wa\.me\/573028536489/);
  // El texto exacto queda guardado: es la unica prueba honesta de que se dijo.
  assert.deepStrictEqual(marcadas, [{ id: "sig-1", texto: enviados[0], wamid: "wamid.OUT", modo: "auto" }]);
});

test("en modo sombra se redacta y se registra, pero NO se envia", async () => {
  let envios = 0;
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "sombra", ahora: MEDIODIA,
    enviar: async () => { envios++; return { ok: true, wamid: "x" }; },
  });

  assert.strictEqual(r.resultado, "sombra");
  assert.strictEqual(envios, 0, "la prueba de humo no puede tocar el grupo");
  assert.ok(r.texto.includes("Ref AP004"));
  assert.strictEqual(marcadas[0].modo, "sombra");
  assert.strictEqual(marcadas[0].wamid, null);
});

test("el telefono del remitente se guarda: es lo que falto en julio", async () => {
  // Con export el contacto llega como nombre; en vivo llega el numero. Los ~100
  // colegas se perdieron por no tenerlo (llegaban como @lid, no marcables).
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "sombra", ahora: MEDIODIA });
  assert.strictEqual(señalCreada.opts.autorTelefono, "573001234567");
  assert.strictEqual(señalCreada.opts.origen, "vivo");
});

test("el id de la senal usa el de WhatsApp, no el hash congelado del EPE", async () => {
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "sombra", ahora: MEDIODIA });
  assert.strictEqual(señalCreada.opts.waMessageId, "vivo:wamid.ABC123");
});

test("el saludo del grupo ni siquiera llega a la IA", async () => {
  // Etapa 0: el prefiltro lexico descarta ~85% gratis. Que este mensaje NO
  // llegue a clasificarse es lo que hace que el modo en vivo sea pagable.
  const r = await vivo.procesarMensaje(ORG, mensaje({ texto: "buenos dias a todos" }), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.resultado, "descartado_prefiltro");
  assert.strictEqual(señalCreada, null);
});

test("lo que la IA declara ruido no toca disco ni se responde", async () => {
  // Pasa el prefiltro (habla de apartamento y de una zona) pero no es ni oferta
  // ni demanda. Muere en memoria: invariante de privacidad del Radar.
  claseDevuelta = "ruido";
  const r = await vivo.procesarMensaje(
    ORG,
    mensaje({ texto: "alguien conoce un buen abogado para escrituracion de apartamento en el poblado?" }),
    { grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }) }
  );
  assert.strictEqual(r.resultado, "ruido");
  assert.strictEqual(señalCreada, null, "el ruido no se persiste nunca");
});

test("una oferta alimenta la red de aliados y nunca se responde", async () => {
  claseDevuelta = "oferta";
  let envios = 0;
  const r = await vivo.procesarMensaje(ORG, mensaje({ texto: "tengo apartamento en venta" }), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA,
    enviar: async () => { envios++; return { ok: true }; },
  });
  assert.strictEqual(r.resultado, "oferta");
  assert.strictEqual(envios, 0);
  assert.strictEqual(ofertasGuardadas.length, 1);
});

test("con el radar apagado no se gasta un token ni se escribe una fila", async () => {
  const r = await vivo.procesarMensaje({ ...ORG, radar_activo: false }, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA,
  });
  assert.strictEqual(r.resultado, "radar_apagado");
  assert.strictEqual(señalCreada, null);
});

test("un grupo sin permiso de responder guarda la senal pero se calla", async () => {
  // Escuchar y responder son permisos distintos: el digest sigue sirviendo.
  let envios = 0;
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: { ...GRUPO, responde: false }, modo: "auto", ahora: MEDIODIA,
    enviar: async () => { envios++; return { ok: true }; },
  });
  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(r.motivo, "grupo_no_habilitado");
  assert.strictEqual(envios, 0);
  assert.ok(señalCreada, "la senal si se guarda");
});

test("si ninguna propiedad pasa la compuerta, se calla y se explica por que", async () => {
  matchesDevueltos = [matchBueno({ precio: "$0" }), matchBueno({ ref: "9921388" })];
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(r.motivo, "sin_propiedades_publicables");
  assert.deepStrictEqual(r.descartados.map((d) => d.ref), ["AP004", "9921388"]);
});

test("si no se puede verificar el limite de frecuencia, no se publica", async () => {
  respuestasRecientes = null; // falta la migracion, o fallo la base
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.motivo, "limite_no_verificable");
});

test("sin transporte inyectado no se inventa una via de salida", async () => {
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "auto", ahora: MEDIODIA });
  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(r.motivo, "sin_transporte");
});

test("si el envio falla, no se registra como publicada", async () => {
  // Registrar un envio que no salio deja el limite de frecuencia mintiendo.
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA,
    enviar: async () => ({ ok: false, error: "sesion caida" }),
  });
  assert.strictEqual(r.resultado, "error_envio");
  assert.deepStrictEqual(marcadas, []);
});

test("fuera de horario se guarda la senal pero no se publica", async () => {
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: new Date("2026-08-17T08:00:00Z"),
    enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.motivo, "fuera_de_horario");
  assert.ok(señalCreada);
});

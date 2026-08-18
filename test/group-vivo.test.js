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
let crucesLeads = [];
let inventario = { fresco: true, iso: new Date().toISOString(), horas: 1 };
let linksAbren = true;

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
    exports: {
      guardarOferta: async (org, o) => {
        ofertasGuardadas.push(o);
        return { id: "ally-1", tipo: o.tipo, zona: o.zona };
      },
    },
  };
  require.cache[RUTA("groups/cruce-leads.js")] = {
    exports: {
      cruzarOfertaConLeads: async (org, allyProperty) => {
        crucesLeads.push({ org, allyProperty });
        return { resultado: "sin_leads_esperando", avisados: [] };
      },
    },
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
  require.cache[RUTA("data/sync-estado.js")] = {
    exports: { estadoDelInventario: async () => inventario },
  };
  require.cache[RUTA("groups/verificar-link.js")] = {
    exports: {
      verificar: async (ms) => ({
        verificadas: linksAbren ? ms : [],
        rotas: linksAbren ? [] : ms.map((m) => ({ ref: m.ref, link: m.link })),
      }),
    },
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
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado-ap004/9744456",
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
  crucesLeads = [];
  inventario = { fresco: true, iso: new Date().toISOString(), horas: 1 };
  linksAbren = true;
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
  // Mensaje "blanqueado" (Juan, 2026-08-18): sin derivar a la asesora, con
  // el link de Wasi — ver la nota de diseño en src/groups/redactar.js.
  assert.doesNotMatch(enviados[0], /wa\.me/);
  assert.match(enviados[0], /info\.wasi\.co/);
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
  // La oferta guardada se cruza contra los leads propios que la esperan —
  // aprobado por Juan 2026-08-18: "armalo".
  assert.strictEqual(crucesLeads.length, 1);
  assert.strictEqual(crucesLeads[0].allyProperty.id, "ally-1");
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

test("si el link no abre, esa propiedad no se publica", async () => {
  // La landing lee de la misma tabla, asi que esto no verifica disponibilidad:
  // verifica el artefacto que va a recibir el colega. El slug lo construyen dos
  // implementaciones separadas (src/lib/slug.js y web/lib/slug.ts) y nada mas
  // comprueba que sigan coincidiendo. Un 404 delante de 80 competidores cuesta
  // mas que perder el match.
  linksAbren = false;
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(r.motivo, "sin_propiedades_publicables");
  assert.ok(r.descartados.some((d) => d.motivos.includes("link_no_abre")));
});

test("con el sync de Wasi detenido no se publica nada", async () => {
  // Si el sync se paro el martes, no se sabe que se vendio desde entonces, y el
  // bot seguiria ofreciendo con total seguridad propiedades que ya no estan.
  // DMAP ya estuvo 16 dias detenido sin que nadie se enterara.
  inventario = { fresco: false, iso: "2026-08-10T00:00:00Z", horas: 150 };
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(r.motivo, "sin_propiedades_publicables");
  assert.ok(r.descartados.every((d) => d.motivos.includes("sync_viejo")));
});

test("si no se puede leer el estado del sync, tampoco se publica", async () => {
  // Falla cerrada: sin poder PROBAR que el inventario esta al dia, se calla.
  inventario = { fresco: false, iso: null, horas: null };
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.resultado, "callado");
});

test("sin tope diario, un fallo al contar no silencia al radar", async () => {
  // Antes se callaba si el conteo fallaba. Sin tope configurado no hay nada que
  // verificar, y un hipo de la base no puede dejar sin responder un pedido que
  // si tiene match.
  respuestasRecientes = null;
  const enviados = [];
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA,
    enviar: async (t) => { enviados.push(t); return { ok: true, wamid: "w" }; },
  });
  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(enviados.length, 1);
});

test("se responden todos los pedidos del dia, no los primeros tres", async () => {
  // El "maximo 3" es de PROPIEDADES dentro de una respuesta, no de respuestas.
  respuestasRecientes = { cantidad: 250, ultimaIso: new Date(MEDIODIA.getTime() - 60000).toISOString() };
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true, wamid: "w" }),
  });
  assert.strictEqual(r.resultado, "publicado");
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

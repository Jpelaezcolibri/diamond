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
let feedRegistrado = [];
let politicasGuardadas = [];
// Dobles para vivo.aprobarManual (Juan, 2026-08-20).
let señalParaAprobar = null;
let grupoParaAprobar = null;
let sesionesActivas = [{ nombre: "RADA-NATALIA", estado: "activa" }];
let envioResultado = { ok: true, wamid: "wm-aprobado" };
let enviadosManual = [];
// Dobles para vivo.js#avisarCercano (Juan, 2026-08-20).
let revisorEncontrado = { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" };
let avisosCercanosMarcados = [];
let avisosCercanosEnviados = [];
let envioAvisoCercanoResultado = { ok: true, wamid: "wm-aviso-cercano" };

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
      guardarPolitica: async (orgId, id, datos) => { politicasGuardadas.push({ id, ...datos }); return true; },
      obtenerPorId: async () => señalParaAprobar,
      marcarAvisoEnviado: async (orgId, id, datos) => { avisosCercanosMarcados.push({ id, ...datos }); return true; },
    },
  };
  require.cache[RUTA("data/whatsapp-groups.js")] = {
    exports: {
      obtenerGrupo: async () => grupoParaAprobar,
      listSessions: async () => sesionesActivas,
    },
  };
  require.cache[RUTA("data/advisors.js")] = {
    exports: {
      findByPhone: async () => revisorEncontrado,
    },
  };
  require.cache[RUTA("lib/waha.js")] = {
    exports: {
      enviarTexto: async (sesion, chatId, texto, opts) => {
        enviadosManual.push({ sesion, chatId, texto, replyTo: opts && opts.replyTo });
        return envioResultado;
      },
    },
  };
  require.cache[RUTA("lib/mensaje-asesor.js")] = {
    exports: {
      enviarYRegistrar: async (org, telefono, texto, opts) => {
        avisosCercanosEnviados.push({ telefono, texto, botones: opts && opts.botones });
        return envioAvisoCercanoResultado;
      },
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
  require.cache[RUTA("groups/feed-comando.js")] = {
    exports: {
      registrarAuto: async (org, señal, resultado, detalle) => {
        feedRegistrado.push({ señal, resultado, detalle });
      },
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
  politicasGuardadas = [];
  ofertasGuardadas = [];
  crucesLeads = [];
  inventario = { fresco: true, iso: new Date().toISOString(), horas: 1 };
  linksAbren = true;
  feedRegistrado = [];
  señalParaAprobar = null;
  grupoParaAprobar = null;
  sesionesActivas = [{ nombre: "RADA-NATALIA", estado: "activa" }];
  envioResultado = { ok: true, wamid: "wm-aprobado" };
  enviadosManual = [];
  revisorEncontrado = { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" };
  avisosCercanosMarcados = [];
  avisosCercanosEnviados = [];
  envioAvisoCercanoResultado = { ok: true, wamid: "wm-aviso-cercano" };
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
  // el link de Wasi — ver la nota de diseño en src/groups/redactar.js. Desde
  // el 2026-08-20 SI lleva el link de Sofi (no el de la asesora) en la firma.
  assert.doesNotMatch(enviados[0], /573028536489/); // el telefono de la asesora, no
  assert.match(enviados[0], /info\.wasi\.co/);
  // El texto exacto queda guardado: es la unica prueba honesta de que se dijo.
  assert.deepStrictEqual(marcadas, [{ id: "sig-1", texto: enviados[0], wamid: "wamid.OUT", modo: "auto", refs: ["AP004"] }]);
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

// Juan, 2026-08-20: "apaguemos las ofertas no las leamos solo quiero que lea
// los pedidos, las ofertas nos estan saturando y no son necesarias" — en un
// grupo activo las ofertas superan por volumen a las demandas (438 señales en
// 2 dias, 402 ofertas) y eran el grueso de lo que inflaba group_signals.
// Revoca la regla anterior ("una oferta alimenta la red de aliados"): ese
// camino sigue vivo solo en la importacion de export .txt
// (importar-export.js), que es una carga puntual y deliberada, no ruido
// continuo de la escucha en vivo.
test("una oferta se ignora por completo en la escucha en vivo: no se guarda ni se cruza contra leads", async () => {
  claseDevuelta = "oferta";
  let envios = 0;
  const r = await vivo.procesarMensaje(ORG, mensaje({ texto: "tengo apartamento en venta" }), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA,
    enviar: async () => { envios++; return { ok: true }; },
  });
  assert.strictEqual(r.resultado, "oferta_ignorada");
  assert.strictEqual(envios, 0);
  assert.strictEqual(ofertasGuardadas.length, 0);
  assert.strictEqual(crucesLeads.length, 0);
  assert.strictEqual(señalCreada, null, "la oferta no se persiste");
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

test("SIN restriccion de horario (Juan, 2026-08-20): publica igual a las 3am que a mediodia", async () => {
  const enviados = [];
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: new Date("2026-08-17T08:00:00Z"), // 03:00 Colombia
    enviar: async (t) => { enviados.push(t); return { ok: true, wamid: "w" }; },
  });
  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(enviados.length, 1);
});

// Pedido de Juan, 2026-08-19: en el camino determinista (auto/sombra) los
// CALLADOS tambien tienen que quedar en el feed del admin, no solo los
// publicados — es lo que permite hacerles seguimiento.
test("un pedido callado en modo auto queda registrado en el feed del admin", async () => {
  matchesDevueltos = [matchBueno({ precio: "$0" })];
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(feedRegistrado.length, 1);
  assert.strictEqual(feedRegistrado[0].resultado, "callado");
  assert.strictEqual(feedRegistrado[0].señal.autor_nombre, "Patricia Gomez");
  assert.strictEqual(feedRegistrado[0].detalle.descartados.length, 1);
});

// Bug real (Juan, 2026-08-20): el motivo de un callado solo quedaba en el
// feed de chat del admin — trazabilidad_radar no lo tenia, y Sofi terminaba
// inventando una razon cuando le preguntaban "por que no se envio esto".
test("un pedido callado guarda el motivo REAL en la señal misma, no solo en el feed", async () => {
  matchesDevueltos = [matchBueno({ precio: "$0" })];
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true }),
  });
  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(politicasGuardadas.length, 1);
  assert.strictEqual(politicasGuardadas[0].id, "sig-1");
  assert.strictEqual(politicasGuardadas[0].motivo, "sin_propiedades_publicables");
  assert.ok(Array.isArray(politicasGuardadas[0].traza));
});

test("un pedido publicado en modo auto tambien queda en el feed del admin", async () => {
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true, wamid: "w" }),
  });
  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(feedRegistrado.length, 1);
  assert.strictEqual(feedRegistrado[0].resultado, "publicado");
});

test("en modo sombra el registro en el feed dice 'sombra', no 'publicado'", async () => {
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "sombra", ahora: MEDIODIA });
  assert.strictEqual(r.resultado, "sombra");
  assert.strictEqual(feedRegistrado.length, 1);
  assert.strictEqual(feedRegistrado[0].resultado, "sombra");
});

test("marcarRespondida guarda los refs que quedaron dentro del mensaje, no todos los matches vistos", async () => {
  matchesDevueltos = [matchBueno({ ref: "AP004" }), matchBueno({ ref: "AP005", precio: "$0" })];
  await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true, wamid: "w" }),
  });
  assert.deepStrictEqual(marcadas[0].refs, ["AP004"]);
});

// ── aprobarManual: "que yo pueda aprobarlo de manera manual dentro del chat
// de Sofi y que una vez aprobado se responda de manera automatica" (Juan,
// 2026-08-20). Corre la misma compuerta y el mismo envio que el camino auto,
// pero SIN pasar por politica.decidir — la aprobacion humana la reemplaza.

function señalCallada(extra = {}) {
  return {
    id: "sig-callada", group_id: "grp-1", clase: "demanda",
    autor_nombre: "Camilo", texto_original: "busco apto", respondida_at: null,
    wa_message_id: "vivo:false_120363@g.us_ABCDEF",
    matches: [matchBueno()], ...extra,
  };
}

function grupoHabilitado(extra = {}) {
  return { id: "grp-1", jid: "vivo:gremial", nombre: "Gremial", responde: true, modo: "sombra", ...extra };
}

test("aprobarManual: publica el pedido callado y lo marca respondido", async () => {
  señalParaAprobar = señalCallada();
  grupoParaAprobar = grupoHabilitado();

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");

  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(enviadosManual.length, 1);
  assert.strictEqual(enviadosManual[0].sesion, "RADA-NATALIA");
  assert.strictEqual(enviadosManual[0].chatId, "vivo:gremial");
  // Cita el pedido original (Juan, 2026-08-20) — sin el prefijo "vivo:" que es
  // solo de nuestro almacenamiento, WhatsApp no lo conoce.
  assert.strictEqual(enviadosManual[0].replyTo, "false_120363@g.us_ABCDEF");
  assert.strictEqual(marcadas.length, 1);
  assert.strictEqual(marcadas[0].modo, "auto");
});

test("aprobarManual: una señal ya respondida no se vuelve a publicar", async () => {
  señalParaAprobar = señalCallada({ respondida_at: "2026-08-20T12:00:00Z" });
  grupoParaAprobar = grupoHabilitado();

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "ya_respondida");
  assert.strictEqual(enviadosManual.length, 0);
});

// Caso real (Juan, 2026-08-20): "el problema es que el bot debe de estar
// habilitado para responder por que si no no daría" — antes aprobarManual
// exigia grupo.responde=true, el MISMO permiso que el camino automatico. Eso
// habria obligado a activar "responder" en TODOS los grupos solo para poder
// aprobar algo a mano, justo lo que la norma de "avisale a Natalia" vino a
// evitar (grupos en modo escucha SI tienen que poder aprobarse a mano).
test("aprobarManual: un grupo en modo escucha (responde=false) SI se puede aprobar a mano", async () => {
  señalParaAprobar = señalCallada();
  grupoParaAprobar = grupoHabilitado({ responde: false });

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(enviadosManual.length, 1);
});

test("aprobarManual: un grupo apagado del todo (modo ignorar) SI sigue sin publicarse", async () => {
  señalParaAprobar = señalCallada();
  grupoParaAprobar = grupoHabilitado({ modo: "ignorar" });

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "grupo_no_habilitado");
  assert.strictEqual(enviadosManual.length, 0);
});

// Caso real (Ana Pabon, 2026-08-20): ambos matches propios quedaron en 66
// (puntaje_bajo, el umbral de publicar solo es 70) y "aprobar_pedido_radar"
// seguia devolviendo el mismo "no se puede" — la aprobacion humana no
// aprobaba nada porque seguia exigiendo el mismo umbral del camino 100%
// automatico.
test("aprobarManual: un match que SOLO fallo por puntaje bajo SI se publica aprobado a mano", async () => {
  señalParaAprobar = señalCallada({ matches: [matchBueno({ puntaje: 66 })] });
  grupoParaAprobar = grupoHabilitado();

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(enviadosManual.length, 1);
});

test("aprobarManual: la zona equivocada SIGUE sin publicarse aunque se apruebe a mano — es seguridad, no confianza", async () => {
  señalParaAprobar = señalCallada({ matches: [matchBueno({ puntaje: 66, ubicacion: "otra_zona" })] });
  grupoParaAprobar = grupoHabilitado();

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "sin_propiedades_publicables");
  assert.strictEqual(enviadosManual.length, 0);
});

test("aprobarManual: una propiedad de un aliado SIGUE sin publicarse aunque se apruebe a mano", async () => {
  señalParaAprobar = señalCallada({ matches: [matchBueno({ puntaje: 90, fuente: "aliado", link: null })] });
  grupoParaAprobar = grupoHabilitado();

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "sin_propiedades_publicables");
  assert.strictEqual(enviadosManual.length, 0);
});

test("aprobarManual: si el inventario ya no pasa la compuerta, no publica ninguna candidata vieja", async () => {
  // El precio $0 es exactamente el bug que src/groups/publicable.js existe
  // para atajar: si el dato cambio desde que llego el pedido, se revalida.
  señalParaAprobar = señalCallada({ matches: [matchBueno({ precio: "$0" })] });
  grupoParaAprobar = grupoHabilitado();

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "sin_propiedades_publicables");
  assert.strictEqual(enviadosManual.length, 0);
});

test("aprobarManual: sin exactamente una sesion activa, falla cerrado en vez de adivinar", async () => {
  señalParaAprobar = señalCallada();
  grupoParaAprobar = grupoHabilitado();
  sesionesActivas = [];

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "sesion_ambigua");
  assert.strictEqual(r.cantidad, 0);
  assert.strictEqual(enviadosManual.length, 0);
});

test("aprobarManual: si el envio falla, no se marca como respondida", async () => {
  señalParaAprobar = señalCallada();
  grupoParaAprobar = grupoHabilitado();
  envioResultado = { ok: false, error: "sesion caida" };

  const r = await vivo.aprobarManual({ id: "org-1" }, "sig-callada");
  assert.strictEqual(r.resultado, "error_envio");
  assert.strictEqual(marcadas.length, 0);
});

// ── avisarCercano: "necesito que catherine uribe reciba que se envió y que
// no y por que no para que ella apruebe desde su celular" — corregido despues
// a Natalia Velez, la misma linea vinculada al radar (Juan, 2026-08-20).

test("avisarCercano: un pedido que SOLO fallo por puntaje bajo avisa al revisor", async () => {
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  vivo = instalarDobles();
  matchesDevueltos = [matchBueno({ puntaje: 60 })];

  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "auto", ahora: MEDIODIA });

  delete process.env.RADAR_REVISOR_PHONE;

  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(avisosCercanosEnviados.length, 1);
  assert.strictEqual(avisosCercanosEnviados[0].telefono, "573001878024");
  assert.match(avisosCercanosEnviados[0].texto, /no salió solo/);
  assert.match(avisosCercanosEnviados[0].texto, /AP004/);
  assert.strictEqual(avisosCercanosMarcados.length, 1);
  assert.strictEqual(avisosCercanosMarcados[0].id, "sig-1");
  assert.strictEqual(avisosCercanosMarcados[0].advisorId, "adv-natalia");

  // BOTONES (Juan, 2026-08-21): el aviso ya no le pide escribir "si"/"no" —
  // el id del boton lleva la señal adentro, para que la respuesta se
  // resuelva sola sin depender de que el modelo interprete texto libre.
  const botones = avisosCercanosEnviados[0].botones;
  assert.strictEqual(botones.length, 2);
  assert.deepStrictEqual(botones[0], { id: "radar_si:sig-1", title: "Sí, publicar" });
  assert.deepStrictEqual(botones[1], { id: "radar_no:sig-1", title: "No sirve" });
  assert.doesNotMatch(avisosCercanosEnviados[0].texto, /Respondeme/);
});

test("avisarCercano: sin RADAR_REVISOR_PHONE configurado, no avisa a nadie", async () => {
  delete process.env.RADAR_REVISOR_PHONE;
  vivo = instalarDobles();
  matchesDevueltos = [matchBueno({ puntaje: 60 })];

  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "auto", ahora: MEDIODIA });

  assert.strictEqual(avisosCercanosEnviados.length, 0);
});

test("avisarCercano: si TAMBIEN le falta un dato (no solo puntaje), no es un 'casi' — no avisa", async () => {
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  vivo = instalarDobles();
  // precio $0 => sin_precio, ADEMAS de puntaje bajo: dos motivos, no uno.
  matchesDevueltos = [matchBueno({ puntaje: 60, precio: "$0" })];

  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "auto", ahora: MEDIODIA });

  delete process.env.RADAR_REVISOR_PHONE;
  assert.strictEqual(avisosCercanosEnviados.length, 0);
});

// Antes (primera version de avisarCercano) esto NO avisaba: se curaba por
// motivo, y "aliado" quedaba afuera aunque la barrera real (nunca publicar
// solo el inventario de un colega) sigue viva en aprobarManual. Simplificado
// (Juan, 2026-08-20, segunda vuelta): "lo que no se responda por el bot debe
// de ir de una al chat de natalia" — sin excepcion por fuente. Ella puede
// decidir avisarle al cliente de esta opcion por otra via; lo que NO puede
// pasar es que el bot la publique sola en el grupo, y eso sigue bloqueado.
test("avisarCercano: una propiedad de un aliado con puntaje bajo SI avisa — la barrera real sigue en la publicacion, no en el aviso", async () => {
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  vivo = instalarDobles();
  matchesDevueltos = [matchBueno({ puntaje: 60, fuente: "aliado", link: null })];

  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "auto", ahora: MEDIODIA });

  delete process.env.RADAR_REVISOR_PHONE;
  assert.strictEqual(avisosCercanosEnviados.length, 1);
});

test("avisarCercano: un pedido que si se publica (score alto) no molesta al revisor", async () => {
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  vivo = instalarDobles();
  // matchBueno() por defecto puntua 88 — pasa la compuerta, se publica solo.

  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "auto", ahora: MEDIODIA, enviar: async () => ({ ok: true, wamid: "w" }),
  });

  delete process.env.RADAR_REVISOR_PHONE;
  assert.strictEqual(r.resultado, "publicado");
  assert.strictEqual(avisosCercanosEnviados.length, 0);
});

// Caso real (Regnum Realty, 2026-08-20): un pedido con match de calidad
// COMPLETA no salio porque "SOLO VIVIENDA >$1000 MLLS" todavia esta en modo
// escucha (responde=false) — y no se avisó a nadie, nadie se enteró. Juan:
// "tenemos que crear una norma que no se salte ninguno de los dos" (ni el
// automatico ni el humano).
test("avisarCercano: un match de CALIDAD COMPLETA en un grupo que solo escucha SI avisa al revisor", async () => {
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  vivo = instalarDobles();
  // matchBueno() por defecto puntua 88 — pasaria la compuerta si el grupo respondiera.

  const grupoSoloEscucha = { ...GRUPO, responde: false };
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: grupoSoloEscucha, modo: "auto", ahora: MEDIODIA });

  delete process.env.RADAR_REVISOR_PHONE;

  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(r.motivo, "grupo_no_habilitado");
  assert.strictEqual(avisosCercanosEnviados.length, 1);
  assert.match(avisosCercanosEnviados[0].texto, /AP004/);
});

// Caso real (Juanita Monsalve, 2026-08-20): pedido "Medellín y área
// metropolitana", sin barrio. El motor no puede graduar mejor que "ciudad"
// (el grado mas debil, excluido de publicar aunque el puntaje sea alto), y
// el pedido se saltaba los DOS caminos: no se publicaba solo (correcto, es
// una zona sin confirmar) NI se avisaba a Natalia (el bug) — justo lo que la
// norma de hoy vino a evitar. Distinto de "otra_zona" (ahi SI sabemos que el
// barrio pedido no es ese, un no real): "ciudad" es un "no sabemos", y eso
// Natalia si lo puede resolver con una llamada.
test("avisarCercano: un match en 'ciudad' (el cliente no dio barrio) SI avisa al revisor", async () => {
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  vivo = instalarDobles();
  matchesDevueltos = [matchBueno({ puntaje: 72, ubicacion: "ciudad" })];

  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "auto", ahora: MEDIODIA });

  delete process.env.RADAR_REVISOR_PHONE;

  assert.strictEqual(r.resultado, "callado");
  assert.strictEqual(avisosCercanosEnviados.length, 1);
  assert.match(avisosCercanosEnviados[0].texto, /AP004/);
});

// Igual que el caso de aliado arriba: "otra_zona" ya NO se excluye del
// aviso — la barrera real (nunca publicar el barrio equivocado) sigue dura
// en aprobarManual, sea cual sea la respuesta de Natalia.
test("avisarCercano: 'otra_zona' (barrio pedido y confirmado distinto) TAMBIEN avisa ahora — la barrera real sigue en la publicacion", async () => {
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  vivo = instalarDobles();
  matchesDevueltos = [matchBueno({ puntaje: 72, ubicacion: "otra_zona" })];

  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "auto", ahora: MEDIODIA });

  delete process.env.RADAR_REVISOR_PHONE;
  assert.strictEqual(avisosCercanosEnviados.length, 1);
});

test("avisarCercano: un grupo apagado sin ningun match limpio no genera ruido", async () => {
  process.env.RADAR_REVISOR_PHONE = "573001878024";
  vivo = instalarDobles();
  // Zona equivocada Y precio $0: ni publicable ni "casi" — nada que avisar.
  matchesDevueltos = [matchBueno({ puntaje: 60, ubicacion: "otra_zona", precio: "$0" })];

  const grupoSoloEscucha = { ...GRUPO, responde: false };
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: grupoSoloEscucha, modo: "auto", ahora: MEDIODIA });

  delete process.env.RADAR_REVISOR_PHONE;
  assert.strictEqual(avisosCercanosEnviados.length, 0);
});

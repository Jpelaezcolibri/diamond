// Modo asistido: Sofi revalida y le avisa a la asesora, sin publicar nada.
//
// Es el paso previo a encender las respuestas en el grupo. Su razon de ser es
// calibrar: cada oportunidad queda con el puntaje del motor, el veredicto de
// Sofi y —via signal_events— lo que la asesora termino haciendo. Con esas tres
// se ajusta el umbral con evidencia en vez de intuicion.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
// Ver la nota en group-avisar-mandato.test.js: el freno de ritmo es de proceso.
const ritmo = require("../src/lib/ritmo-avisos");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));

let claseDevuelta = "demanda";
let matchesDevueltos = [];
let veredictoDeSofi = null;
let loQueVioSofi = null;
let revalidacionesGuardadas = [];
let avisosMarcados = [];
let enviadosPorSofi = [];
let envioFalla = false;
let feedRegistrado = [];
// Telefono que el directorio (src/groups/directorio.js) dice haber resuelto
// para el @lid del colega -- null simula el 33% que no se resuelve.
let telefonoColegaResuelto = null;
// ── DM directo al colega (Juan, 2026-08-24) ──────────────────────────────
let politicasGuardadas = [];
let marcadasRespondidas = [];
let dmsHoyColegaMock = 0; // cupo libre por defecto
let dmsHoyLineaMock = 0;
let enviosDm = [];
let envioDmResultado = { ok: true, wamid: "wm-dm-1" };
// ── Escalado inmediato marca la señal, para que radar-silencio no la reintente ──
let claimsEscaladoSilencio = [];

function instalar() {
  require.cache[RUTA("groups/classify.js")] = {
    exports: {
      classify: async (ms) => ({
        clasificados: ms.map((m) => ({
          id: m.id, clase: claseDevuelta, confianza: 0.95, operacion: "venta",
          tipo: "apartamento", zona: "laureles", ciudad: "medellin",
          precio_min: 0, precio_max: 900000000, habitaciones: 3, area_min: 0,
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
    exports: { persistirSenal: async () => ({ signal: { id: "sig-1", respondida_at: null }, duplicado: false }) },
  };
  require.cache[RUTA("groups/ofertas.js")] = { exports: { guardarOferta: async () => {} } };
  require.cache[RUTA("data/command.js")] = { exports: { leadsParaPropiedad: async () => [] } };
  require.cache[RUTA("groups/revalidar.js")] = {
    exports: {
      revalidar: async (c, matches) => {
        loQueVioSofi = matches;
        return { veredicto: veredictoDeSofi, uso: {} };
      },
      // FIX (Juan, 2026-09-01): este mock reimplementa apruebaAviso a mano en
      // vez de llamar al modulo real (que esta mockeado arriba) -- tiene que
      // seguir la misma logica que src/groups/revalidar.js#apruebaAviso o el
      // mock queda desincronizado del bug que se corrigio ahi: ahora aprueba
      // por refs_utiles O por refs_dudosas, no solo por refs_utiles.
      apruebaAviso: (v) =>
        Boolean(v && v.es_pedido_real && ((v.refs_utiles || []).length || (v.refs_dudosas || []).length)),
    },
  };
  require.cache[RUTA("data/group-signals.js")] = {
    exports: {
      guardarRevalidacion: async (org, id, v) => { revalidacionesGuardadas.push({ id, v }); return true; },
      // El link del aviso (2026-09-03): sin migracion no hay token, y el aviso sale sin link.
      asegurarToken: async () => null,
      marcarAvisoEnviado: async (org, id, opts) => { avisosMarcados.push({ id, ...opts }); return true; },
      respuestasDesde: async () => ({ cantidad: 0, ultimaIso: null }),
      marcarRespondida: async (orgId, id, datos) => { marcadasRespondidas.push({ id, ...datos }); return true; },
      guardarPolitica: async (orgId, id, datos) => { politicasGuardadas.push({ id, ...datos }); return true; },
      dmsHoyPorColega: async () => dmsHoyColegaMock,
      dmsHoyLinea: async () => dmsHoyLineaMock,
      claimEscaladoSilencio: async (orgId, signalId) => {
        claimsEscaladoSilencio.push({ orgId, signalId });
        return true;
      },
    },
  };
  require.cache[RUTA("data/organizations.js")] = {
    exports: {
      radarEncendido: () => true,
      // Carril de compra (2026-09-02): prendido, como en produccion hoy.
      mandatosActivos: () => true,
    },
  };
  require.cache[RUTA("groups/feed-comando.js")] = {
    exports: {
      registrar: async (org, señal, veredicto, matches, resultado) => {
        feedRegistrado.push({ señal, veredicto, matches, resultado });
      },
    },
  };
  require.cache[RUTA("data/sync-estado.js")] = {
    exports: { estadoDelInventario: async () => ({ fresco: true, iso: "x", horas: 1 }) },
  };
  // Sin este doble, cada test que llega a "demanda" dispara un colegas.upsert
  // REAL contra la Supabase compartida por las 4 apps (vivo.js hace
  // directorio.registrar best-effort, sin await). Hoy no falla nada porque
  // "org-1" no es un UUID valido y Postgres lo rechaza en silencio — pero eso
  // no protege a nadie: el dia que un fixture use un UUID valido, la suite
  // empieza a escribir basura en produccion sin que ningun test lo note.
  require.cache[RUTA("groups/directorio.js")] = {
    exports: { registrar: async () => null, telefonoDe: async () => telefonoColegaResuelto },
  };
  require.cache[RUTA("lib/waha.js")] = {
    exports: {
      enviarDm: async (sesion, telefono, texto) => {
        enviosDm.push({ sesion, telefono, texto });
        return envioDmResultado;
      },
      // Por defecto null: "no se pudo leer" es el caso que no frena (ver la
      // nota deliberada en politica.js#decidirDm) y es el que no debe romper
      // ningun test existente de esta suite.
      cuotaDeLinea: async () => null,
    },
  };
  require.cache[RUTA("channels/whatsapp.js")] = {
    exports: {
      sendWhatsApp: async (org, to, texto) => {
        enviadosPorSofi.push({ to, texto });
        return envioFalla ? { ok: false, error: "fuera de la ventana de 24h" } : { ok: true, wamid: "w" };
      },
    },
  };
  // El envio al asesor PRINCIPAL pasa por mensajeAsesor.enviarYRegistrar, no
  // por canalWhatsapp directo (deja el mensaje guardado como conversacion
  // real — ver src/lib/mensaje-asesor.js). Mismo comportamiento simulado que
  // el mock de arriba, para no duplicar aserciones: al test no le importa por
  // cual de los dos caminos salio, solo que salio.
  require.cache[RUTA("lib/mensaje-asesor.js")] = {
    exports: {
      enviarYRegistrar: async (org, to, texto) => {
        enviadosPorSofi.push({ to, texto });
        return envioFalla ? { ok: false, error: "fuera de la ventana de 24h" } : { ok: true, wamid: "w" };
      },
    },
  };
  delete require.cache[RUTA("groups/vivo.js")];
  return require("../src/groups/vivo");
}

const ORG = { id: "org-1", radar_activo: true };
const GRUPO = { id: "grp-1", jid: "123@g.us", nombre: "Inmobiliarias Medellin", responde: false };
const CATHERINE = { name: "katherine Uribe", phone: "573028536489" };

function mensaje() {
  return {
    id: "m1", waMessageId: "wamid.A",
    texto: "Busco apartamento en Laureles, 3 alcobas, hasta 900 millones para cliente",
    // @lid tipico que llega de WhatsApp (14-17 digitos, no marcable) — mismo
    // valor que usa test/alerta-asesor.test.js. Antes esto tenia forma de
    // telefono ("573001234567"), lo que quedo mal el 2026-08-24: alerta-asesor.js
    // aprendio a usar autor_telefono como ultimo intento cuando el directorio
    // no resuelve (ver ese archivo), y un default con forma de telefono se
    // colaba como si fuera un numero real resuelto en vez de un LID crudo.
    autor: "Patricia Gomez", autorTelefono: "141746805670125",
    instanteIso: new Date().toISOString(), esSistema: false, esMultimedia: false,
  };
}

function match(extra = {}) {
  return {
    fuente: "diamond", ref: "9780079", titulo: "Vendo Apartamento En Laureles",
    zona: "Laureles", precio: "$900.000.000", operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/x-9780079",
    // linkWasi (2026-08-24): match.js SIEMPRE lo agrega para fuente "diamond"
    // (ver src/groups/match.js). Hace falta en el fixture porque el DM directo
    // al colega arma su texto con redactar.mensajeGrupo, que publica
    // match.linkWasi (nunca match.link, ver la nota de "MENSAJE BLANQUEADO"
    // en ese archivo) -- sin este campo, la ficha del DM saldria con la
    // palabra literal "undefined" en el link.
    linkWasi: "https://info.wasi.co/vendo-apartamento-en-laureles-9780079/1234567",
    habitaciones: 3, area: "114m2", puntaje: 83, razones: ["Zona: Laureles"], ...extra,
  };
}

const APRUEBA = {
  es_pedido_real: true, sirve_alguna: true, refs_utiles: ["9780079"],
  por_que: "Es exactamente lo que pide: Laureles, 3 alcobas y entra en presupuesto.",
  confianza: 0.9, desacuerdo_con_puntaje: "",
};

let vivo;
beforeEach(() => {
  ritmo._reset();
  claseDevuelta = "demanda";
  matchesDevueltos = [match()];
  veredictoDeSofi = { ...APRUEBA };
  loQueVioSofi = null;
  revalidacionesGuardadas = [];
  avisosMarcados = [];
  enviadosPorSofi = [];
  envioFalla = false;
  feedRegistrado = [];
  telefonoColegaResuelto = null;
  politicasGuardadas = [];
  marcadasRespondidas = [];
  dmsHoyColegaMock = 0;
  dmsHoyLineaMock = 0;
  enviosDm = [];
  envioDmResultado = { ok: true, wamid: "wm-dm-1" };
  claimsEscaladoSilencio = [];
  delete process.env.RADAR_ALERTA_TO;
  delete process.env.CONTACT_WHATSAPP_NUMBER;
  vivo = instalar();
});

test("Sofi aprueba y la asesora recibe el aviso completo", async () => {
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });

  assert.strictEqual(r.resultado, "avisada");
  assert.strictEqual(enviadosPorSofi.length, 1);
  const t = enviadosPorSofi[0].texto;
  // Los cuatro datos que pidio Juan.
  assert.match(t, /Inmobiliarias Medellin/, "el nombre del grupo");
  assert.match(t, /Patricia Gomez/, "quien lo pidio");
  assert.match(t, /Busco apartamento en Laureles/, "lo que busca, en sus palabras");
  assert.match(t, /Ref 9780079/, "que propiedad le sirve");
  // Y el porque, que es lo que lo vuelve accionable.
  assert.match(t, /Sofi dice:/);
  assert.match(t, /Contame en qué quedó/, "pide respuesta: dato de calibracion y renueva la ventana");
});

// FIX (Juan, 2026-09-01) -- un veredicto con SOLO refs_dudosas (refs_utiles
// vacio) se estaba descartando ANTES de llegar a alertaAsesor.construir,
// exactamente el bug que refs_dudosas existe para evitar. Prueba de punta a
// punta sobre asistir(), no solo sobre las dos funciones por separado.
test("Sofi solo marca refs_dudosas (ninguna utiles) -- la asesora IGUAL recibe el aviso, con la seccion Para revisar", async () => {
  veredictoDeSofi = { ...APRUEBA, refs_utiles: [], refs_dudosas: ["9780079"] };

  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });

  assert.strictEqual(r.resultado, "avisada");
  assert.strictEqual(enviadosPorSofi.length, 1);
  assert.match(enviadosPorSofi[0].texto, /Para revisar/i);
  assert.match(enviadosPorSofi[0].texto, /9780079/);
});

test("en asistido NO se publica nada en el grupo", async () => {
  let publicaciones = 0;
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "asistido", asesor: CATHERINE,
    enviar: async () => { publicaciones++; return { ok: true, wamid: "x" }; },
  });
  assert.strictEqual(r.resultado, "avisada");
  assert.strictEqual(publicaciones, 0, "el transporte del grupo no se toca");
});

test("el grupo no necesita permiso de responder para que esto funcione", async () => {
  // Es la propiedad que permite arrancar sin habilitar Responder en ninguno.
  assert.strictEqual(GRUPO.responde, false);
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(r.resultado, "avisada");
});

test("Sofi ve TODAS las candidatas, tambien las de puntaje bajo", async () => {
  // Si solo viera las que pasan el umbral, nunca descubririamos que el umbral
  // esta dejando pasar oportunidades buenas. Los falsos negativos son
  // invisibles por definicion y son los caros.
  matchesDevueltos = [match({ ref: "A", puntaje: 83 }), match({ ref: "B", puntaje: 58 })];
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.deepStrictEqual(loQueVioSofi.map((m) => m.ref), ["A", "B"]);
});

test("si Sofi dice que no sirve, la asesora no se entera", async () => {
  veredictoDeSofi = {
    es_pedido_real: true, sirve_alguna: false, refs_utiles: [],
    por_que: "Pide finca en Llano Grande; lo que tenemos son apartamentos urbanos.",
    confianza: 0.95, desacuerdo_con_puntaje: "el puntaje 83 esta inflado: calza el precio pero no el tipo",
  };
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });

  assert.strictEqual(r.resultado, "descartada_por_sofi");
  assert.strictEqual(enviadosPorSofi.length, 0);
  // Pero el veredicto SI se guarda: el "no" tambien ensena.
  assert.strictEqual(revalidacionesGuardadas.length, 1);
  assert.match(revalidacionesGuardadas[0].v.desacuerdo_con_puntaje, /inflado/);
});

test("el veredicto se guarda siempre, apruebe o no", async () => {
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(revalidacionesGuardadas.length, 1);
  assert.strictEqual(revalidacionesGuardadas[0].id, "sig-1");
});

test("sin veredicto de Sofi no se le escribe a nadie", async () => {
  // Falla cerrada: si la llamada a la IA fallo, perder la oportunidad cuesta
  // menos que mandarle ruido a la asesora.
  veredictoDeSofi = null;
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(r.resultado, "sin_veredicto");
  assert.strictEqual(enviadosPorSofi.length, 0);
});

test("si el aviso no sale, queda pendiente y NO se marca enviado", async () => {
  // Fuera de la ventana de 24h Meta rechaza el texto libre. Marcarlo enviado
  // perderia la oportunidad para siempre; dejarlo pendiente permite mandarlo
  // cuando la asesora escriba y la ventana se reabra.
  envioFalla = true;
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(r.resultado, "aviso_pendiente");
  assert.deepStrictEqual(avisosMarcados, []);
});

test("el aviso sale por la Cloud API oficial, no por la linea vinculada", async () => {
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(enviadosPorSofi[0].to, "573028536489");
});

// CAMBIO DE POLITICA (Juan, 2026-08-22): "que se notifique al celular de
// natalia todo para que ella lo responda directamente desde su numero" — el
// gremio pide no llenar los grupos, asi que el aviso YA NO puede decir
// "respondele en el grupo" (era el bug real: mensaje.autorTelefono es un
// @lid, nunca marcable, asi que ese texto salia el 100% de las veces).
// vivo.js#asistir ahora resuelve el telefono real con
// src/groups/directorio.js ANTES de llamar a alertaAsesor.construir.
test("con telefono resuelto por el directorio, el aviso trae el link directo al privado", async () => {
  telefonoColegaResuelto = "573001234567";
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.match(enviadosPorSofi[0].texto, /Contacto: https:\/\/wa\.me\/573001234567/);
});

test("sin telefono resuelto (el 33% esperado), NO dice 'respondele en el grupo' -- dice que toque el nombre", async () => {
  telefonoColegaResuelto = null;
  await vivo.procesarMensaje(
    ORG,
    { ...mensaje(), autorTelefono: "141746805670125" },
    { grupo: GRUPO, modo: "asistido", asesor: CATHERINE }
  );
  assert.doesNotMatch(enviadosPorSofi[0].texto, /respondele en el grupo/i);
  assert.match(enviadosPorSofi[0].texto, /tocá el nombre de Patricia Gomez en el grupo/);
  assert.doesNotMatch(enviadosPorSofi[0].texto, /wa\.me\/141746805670125/);
});

test("si el directorio falla al resolver, el aviso sale igual (con la variante sin telefono)", async () => {
  require.cache[RUTA("groups/directorio.js")].exports.telefonoDe = async () => {
    throw new Error("WAHA caido");
  };
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(r.resultado, "avisada");
  assert.match(enviadosPorSofi[0].texto, /tocá el nombre/);
});

test("con CONTACT_WHATSAPP_NUMBER definida, el aviso agrega el link a la linea oficial de Sofi", async () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001";
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  // Con el fix de duplicacion (2026-09-01): cuando el directorio no resuelve el
  // telefono del colega, hay un "mensaje listo para reenviar" que YA trae la
  // invitacion a Sofi. No se agrega un segundo link separado que duplicaria la
  // invitacion. Verificamos que el link sigue estando ahi (dentro del reenvio):
  assert.match(enviadosPorSofi[0].texto, /escribirle.*a Sofi/);
  assert.match(enviadosPorSofi[0].texto, /https:\/\/wa\.me\/573000000001/);
});

test("sin CONTACT_WHATSAPP_NUMBER, el aviso sale sin el renglon de Sofi -- nunca un link a medias", async () => {
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.doesNotMatch(enviadosPorSofi[0].texto, /escribirle.*a Sofi/);
  assert.doesNotMatch(enviadosPorSofi[0].texto, /YOUR_CONTACT_LINK/);
});

test("se guarda el destinatario REAL del aviso, no quien observo el grupo", async () => {
  // Bug real 2026-08-18: sin esto, trazabilidad_radar no puede decir a quien
  // se le mando cada aviso, y Sofi termino inventando un nombre al preguntarle.
  await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "asistido", asesor: { ...CATHERINE, id: "adv-catherine" },
  });
  assert.strictEqual(avisosMarcados.length, 1);
  assert.strictEqual(avisosMarcados[0].advisorId, "adv-catherine");
  assert.strictEqual(avisosMarcados[0].wamid, "w");
});

test("el wamid guardado es del envio al asesor PRINCIPAL, no de un extra de calibracion", async () => {
  process.env.RADAR_ALERTA_TO = "573016981200";
  vivo = instalar();
  let n = 0;
  // El principal sale por mensajeAsesor.enviarYRegistrar; el extra de
  // RADAR_ALERTA_TO sigue saliendo por canalWhatsapp.sendWhatsApp directo.
  require.cache[RUTA("lib/mensaje-asesor.js")].exports.enviarYRegistrar = async (org, to) => {
    n++;
    return { ok: true, wamid: `w-${to}` };
  };
  require.cache[RUTA("channels/whatsapp.js")].exports.sendWhatsApp = async (org, to) => {
    n++;
    return { ok: true, wamid: `w-${to}` };
  };
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: { ...CATHERINE, id: "adv-catherine" } });
  assert.strictEqual(n, 2);
  assert.strictEqual(avisosMarcados[0].wamid, "w-573028536489");
});

test("se puede sumar un destinatario extra para la calibracion", async () => {
  process.env.RADAR_ALERTA_TO = "573016981200";
  vivo = instalar();
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.deepStrictEqual(enviadosPorSofi.map((e) => e.to).sort(), ["573016981200", "573028536489"]);
});

test("el mismo numero no recibe el aviso dos veces", async () => {
  process.env.RADAR_ALERTA_TO = "57 302 853 6489";
  vivo = instalar();
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(enviadosPorSofi.length, 1);
});

// Juan, 2026-08-20: las ofertas ya no se leen en la escucha en vivo (ver
// group-vivo.test.js) — se ignoran ANTES del modo asistido, asi que esto
// aplica igual con modo:"asistido".
//
// Reconectado 2026-08-25 (Juan): sin mandatos NI leads esperando (el mock de
// data/command.js arriba devuelve siempre []), la oferta sigue sin persistirse.
test("una oferta de un colega sin mandatos ni leads esperando se ignora, tambien en modo asistido", async () => {
  claseDevuelta = "oferta";
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(r.resultado, "oferta_sin_match");
  assert.strictEqual(enviadosPorSofi.length, 0);
});

test("sin candidatas no se molesta a Sofi", async () => {
  // Revalidar sin nada que revalidar seria pagar un token para nada.
  matchesDevueltos = [];
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(r.resultado, "sin_candidatas");
  assert.strictEqual(loQueVioSofi, null);
});

test("Sofi aprueba: el feed del admin se entera, con quien se avisó", async () => {
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: { ...CATHERINE, id: "adv-catherine" } });

  assert.strictEqual(feedRegistrado.length, 1);
  assert.strictEqual(feedRegistrado[0].veredicto.sirve_alguna, true);
  assert.strictEqual(feedRegistrado[0].resultado.avisada, true);
  assert.strictEqual(feedRegistrado[0].resultado.destinatarioNombre, CATHERINE.name);
});

test("Sofi rechaza: el feed del admin TAMBIEN se entera — es lo que Juan pidio explicitamente", async () => {
  veredictoDeSofi = {
    es_pedido_real: true, sirve_alguna: false, refs_utiles: [],
    por_que: "Pide finca en Llano Grande; lo que tenemos son apartamentos urbanos.",
    confianza: 0.95, desacuerdo_con_puntaje: "",
  };
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });

  assert.strictEqual(feedRegistrado.length, 1);
  assert.strictEqual(feedRegistrado[0].veredicto.sirve_alguna, false);
});

test("si el aviso aprobado no logra salir, el feed lo refleja (avisada:false)", async () => {
  envioFalla = true;
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });

  assert.strictEqual(feedRegistrado.length, 1);
  assert.strictEqual(feedRegistrado[0].resultado.avisada, false);
});

// ── DM directo al colega (Juan, 2026-08-24) ──────────────────────────────
//
// "que el bot responda solo": con telefono resuelto, pedido reciente, cupo
// libre y una sesion de WAHA para salir, el radar le escribe al colega
// directo en vez de avisarle a la asesora. Los tres limites de
// politica.js#decidirDm NUNCA descartan el pedido: siempre desvian a la
// asesora de siempre (ver los tests de mas abajo).

test("con telefono, pedido reciente, cupo libre y sesion, se manda el DM y NO se avisa a la asesora", async () => {
  telefonoColegaResuelto = "573001234567";
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA",
  });

  assert.strictEqual(r.resultado, "dm_enviado");
  assert.strictEqual(enviosDm.length, 1);
  assert.strictEqual(enviosDm[0].sesion, "RADA-NATALIA");
  assert.strictEqual(enviosDm[0].telefono, "573001234567");
  assert.match(enviosDm[0].texto, /Ref 9780079/);
  assert.strictEqual(enviadosPorSofi.length, 0, "la asesora no recibe nada: no tiene nada que hacer");
  assert.strictEqual(avisosMarcados.length, 0, "marcarAvisoEnviado es del camino de la asesora, no de este");
  assert.deepStrictEqual(marcadasRespondidas, [
    { id: "sig-1", texto: enviosDm[0].texto, wamid: "wm-dm-1", modo: "auto", refs: ["9780079"] },
  ]);
});

// FIX (Juan, 2026-09-01): "no tiene nada que hacer" solo es cierto si no queda
// nada pendiente -- si el mismo pedido tenia refs_dudosas, el DM sale igual
// pero la asesora tiene que enterarse de lo que quedo sin mandar.
test("con telefono resuelto Y refs_dudosas, el DM sale Y la asesora recibe el aviso de lo pendiente", async () => {
  telefonoColegaResuelto = "573001234567";
  matchesDevueltos = [match(), match({ ref: "9800000", titulo: "Apartamento en Sabaneta", zona: "Sabaneta" })];
  veredictoDeSofi = { ...APRUEBA, refs_dudosas: ["9800000"] };

  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA",
  });

  assert.strictEqual(r.resultado, "dm_enviado", "el DM sigue saliendo igual");
  assert.strictEqual(enviosDm.length, 1, "el colega sigue recibiendo su DM normal");
  assert.strictEqual(enviadosPorSofi.length, 1, "la asesora SI recibe algo ahora -- quedo una dudosa pendiente");
  assert.match(enviadosPorSofi[0].texto, /Ya le mandé por privado/i);
  assert.match(enviadosPorSofi[0].texto, /9780079/, "menciona la ref que ya se envio por DM");
  assert.match(enviadosPorSofi[0].texto, /9800000/, "lista la dudosa pendiente");
  assert.match(enviadosPorSofi[0].texto, /Sabaneta/);
  // AGREGADO (Juan, 2026-09-01): si decide mandar la dudosa, no puede tener
  // que volver al grupo a buscar quien la pidio -- grupo + link directo al
  // colega (el mismo telefono que ya recibio el DM).
  assert.match(enviadosPorSofi[0].texto, /Grupo: Inmobiliarias Medellin/);
  assert.match(enviadosPorSofi[0].texto, /Contacto: https:\/\/wa\.me\/573001234567/, "link directo al DM del colega");
});

test("el DM al colega usa el mismo texto que antes iba al grupo (redactar.mensajeGrupo)", async () => {
  telefonoColegaResuelto = "573001234567";
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  const t = enviosDm[0].texto;
  assert.match(t, /Hola Patricia, vi tu solicitud/);
  assert.match(t, /Comision compartida/);
  assert.match(t, /Sofi, asistente virtual/);
  assert.doesNotMatch(t, /Diamond/i, "el mensaje blanqueado nunca menciona Diamond");
});

// SALVEDAD DE DATOS NO CONFIRMADOS (Juan, 2026-08-24): caso real, colega
// pidio apto en Envigado con terraza y max 6 años de antiguedad, y 3
// propiedades con match del 100% se descartaron solo porque el inventario no
// registra esos dos datos. El DM directo ahora lleva esa salvedad cuando
// Sofi la reporta en el veredicto.
test("el DM lleva la salvedad de Sofi cuando el veredicto reporta datos sin confirmar", async () => {
  telefonoColegaResuelto = "573001234567";
  veredictoDeSofi = { ...APRUEBA, sin_confirmar: ["terraza", "antigüedad"] };
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.match(enviosDm[0].texto, /No tengo confirmado si tiene terraza ni antigüedad/);
});

test("sin datos sin confirmar en el veredicto, el DM sale igual que antes -- sin salvedad", async () => {
  telefonoColegaResuelto = "573001234567";
  veredictoDeSofi = { ...APRUEBA, sin_confirmar: [] };
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.doesNotMatch(enviosDm[0].texto, /No tengo confirmado/);
});

test("un veredicto VIEJO sin el campo 'sin_confirmar' no rompe el DM -- se degrada a sin salvedad", async () => {
  telefonoColegaResuelto = "573001234567";
  veredictoDeSofi = { ...APRUEBA };
  delete veredictoDeSofi.sin_confirmar;
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.strictEqual(r.resultado, "dm_enviado");
  assert.doesNotMatch(enviosDm[0].texto, /No tengo confirmado/);
});

test("el DM incluye el link a la linea oficial de Sofi cuando hay numero configurado", async () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000009";
  telefonoColegaResuelto = "573001234567";
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.match(enviosDm[0].texto, /https:\/\/wa\.me\/573000000009/);
});

test("sin CONTACT_WHATSAPP_NUMBER, el DM sale sin ese renglon -- nunca un link a medias", async () => {
  telefonoColegaResuelto = "573001234567";
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.doesNotMatch(enviosDm[0].texto, /línea oficial/);
});

test("el feed del admin se entera del DM directo, con trazabilidad de a quien se le escribio", async () => {
  telefonoColegaResuelto = "573001234567";
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.strictEqual(feedRegistrado.length, 1);
  assert.strictEqual(feedRegistrado[0].resultado.avisada, true);
  assert.match(feedRegistrado[0].resultado.destinatarioNombre, /DM directo a Patricia Gomez/);
});

test("la decision (DM u asesora) queda guardada en la señal, igual que el resto de las decisiones del radar", async () => {
  telefonoColegaResuelto = "573001234567";
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.strictEqual(politicasGuardadas.length, 1);
  assert.strictEqual(politicasGuardadas[0].id, "sig-1");
  assert.strictEqual(politicasGuardadas[0].motivo, "ok");
  assert.ok(Array.isArray(politicasGuardadas[0].traza));
});

test("sin telefono resuelto, se avisa a la asesora de siempre -- ningun pedido se pierde", async () => {
  telefonoColegaResuelto = null;
  const r = await vivo.procesarMensaje(ORG, mensaje(), {
    grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA",
  });

  assert.strictEqual(r.resultado, "avisada");
  assert.strictEqual(enviosDm.length, 0);
  assert.strictEqual(enviadosPorSofi.length, 1);
  assert.strictEqual(politicasGuardadas[0].motivo, "sin_telefono");
});

test("sin sesion de WAHA, no se puede intentar el DM -- se avisa a la asesora", async () => {
  telefonoColegaResuelto = "573001234567";
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE }); // sin sesion

  assert.strictEqual(r.resultado, "avisada");
  assert.strictEqual(enviosDm.length, 0);
  assert.strictEqual(enviadosPorSofi.length, 1);
});

test("un pedido fuera de ventana (mas de 30 min desde el mensaje del grupo) se avisa a la asesora", async () => {
  telefonoColegaResuelto = "573001234567";
  const viejo = { ...mensaje(), instanteIso: new Date(Date.now() - 31 * 60 * 1000).toISOString() };
  const r = await vivo.procesarMensaje(ORG, viejo, { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.strictEqual(r.resultado, "avisada");
  assert.strictEqual(enviosDm.length, 0);
  assert.strictEqual(politicasGuardadas[0].motivo, "pedido_vencido");
});

// TOPE POR COLEGA QUITADO en este camino (Juan, 2026-09-04): "quita la
// restriccion de la cantidad de mensajes a un mismo colega ya que vamos a
// tener respuestas directas a mensajes enviados por ellos, entonces no veo el
// problema de que respondamos a mas de 2 mensajes en un dia". Antes esto
// esperaba que el tercer DM del dia se desviara a la asesora (motivo
// limite_colega_alcanzado); ahora el DM automatico sale igual, sin importar
// cuantos van en el dia -- ver src/groups/politica.js#decidirDm.
test("un colega ya contactado varias veces hoy sigue recibiendo el DM -- ya no hay tope por colega", async () => {
  telefonoColegaResuelto = "573001234567";
  dmsHoyColegaMock = 9;
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.strictEqual(r.resultado, "dm_enviado");
  assert.strictEqual(enviosDm.length, 1);
  assert.strictEqual(enviadosPorSofi.length, 0, "la asesora no recibe nada: el DM automatico salio");
  assert.strictEqual(politicasGuardadas[0].motivo, "ok");
});

test("al tope diario de la linea, se avisa a la asesora -- es cortacircuito, no descarte", async () => {
  telefonoColegaResuelto = "573001234567";
  dmsHoyLineaMock = 150;
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.strictEqual(r.resultado, "avisada");
  assert.strictEqual(enviosDm.length, 0);
  assert.strictEqual(politicasGuardadas[0].motivo, "limite_linea_alcanzado");
});

test("si el envio del DM falla, se avisa a la asesora en su lugar -- ningun pedido se pierde", async () => {
  telefonoColegaResuelto = "573001234567";
  envioDmResultado = { ok: false, error: "sesion caida" };
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.strictEqual(r.resultado, "avisada");
  assert.strictEqual(enviosDm.length, 1, "si se intento, solo una vez -- sin reintento");
  assert.strictEqual(enviadosPorSofi.length, 1);
  assert.deepStrictEqual(marcadasRespondidas, [], "un DM que no salio no se marca como respondida");
});

// ACLARACION DE LO QUE NO CUMPLE (Juan, 2026-08-24) — caso real Edwin
// Ramirez: la ref 10077095 cumplia zona, precio, alcobas, area y baños del
// pedido, y solo tenia 1 garaje de los 2 pedidos. Se manda diciendolo, en vez
// de perderla: "esa decision es del colega, no nuestra".
test("el DM lleva la aclaracion cuando Sofi reporta que una propiedad no cumple algo accesorio", async () => {
  telefonoColegaResuelto = "573001234567";
  veredictoDeSofi = {
    ...APRUEBA,
    le_falta: [{ ref: "9780079", detalle: "tiene 1 garaje y pediste 2" }],
  };
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.match(enviosDm[0].texto, /Aclaración: tiene 1 garaje y pediste 2/);
});

// ── Escalado INMEDIATO a Catherine si a Natalia no le llega (Juan, 2026-08-26) ──
test("si el envio a la asesora principal (Natalia) falla, se intenta un envio extra a RADAR_ESCALADO_PHONE", async () => {
  process.env.RADAR_ESCALADO_PHONE = "573028536489";
  const intentos = [];
  require.cache[RUTA("lib/mensaje-asesor.js")].exports.enviarYRegistrar = async (org, to, texto) => {
    intentos.push(to);
    if (to === "573001878024") return { ok: false, error: "fuera de ventana" };
    return { ok: true, wamid: `w-${to}` };
  };
  const NATALIA = { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" };
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: NATALIA });

  assert.deepStrictEqual(intentos, ["573001878024", "573028536489"]);
  assert.strictEqual(r.escaladoInmediato, true);
  assert.strictEqual(r.resultado, "avisada", "el escalado si logro entregarse cuenta como avisada");
  delete process.env.RADAR_ESCALADO_PHONE;
});

// Bug CRITICAL (Juan, review sobre c41d1b4): el escalado inmediato no marcaba
// la señal, asi que radar-silencio.js la volvia a agarrar como "sin escalar"
// pasados los 30 minutos y le mandaba el mismo aviso a Catherine DOS VECES.
test("el escalado INMEDIATO marca la señal como escalada por silencio, para que el scheduler no la reintente", async () => {
  process.env.RADAR_ESCALADO_PHONE = "573028536489";
  require.cache[RUTA("lib/mensaje-asesor.js")].exports.enviarYRegistrar = async (org, to) => {
    if (to === "573001878024") return { ok: false, error: "fuera de ventana" };
    return { ok: true, wamid: `w-${to}` };
  };
  const NATALIA = { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" };
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: NATALIA });

  assert.strictEqual(r.escaladoInmediato, true);
  assert.strictEqual(claimsEscaladoSilencio.length, 1);
  assert.deepStrictEqual(claimsEscaladoSilencio[0], { orgId: ORG.id, signalId: "sig-1" });
  delete process.env.RADAR_ESCALADO_PHONE;
});

test("el escalado INMEDIATO marca la señal como escalada por silencio aunque el envio a Catherine tambien falle", async () => {
  process.env.RADAR_ESCALADO_PHONE = "573028536489";
  require.cache[RUTA("lib/mensaje-asesor.js")].exports.enviarYRegistrar = async () => ({ ok: false, error: "fuera de ventana" });
  const NATALIA = { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" };
  await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: NATALIA });

  assert.strictEqual(claimsEscaladoSilencio.length, 1);
  assert.deepStrictEqual(claimsEscaladoSilencio[0], { orgId: ORG.id, signalId: "sig-1" });
  delete process.env.RADAR_ESCALADO_PHONE;
});

test("si el envio a la asesora principal (Natalia) SI funciona, no se intenta ningun envio extra a Catherine", async () => {
  process.env.RADAR_ESCALADO_PHONE = "573028536489";
  const intentos = [];
  require.cache[RUTA("lib/mensaje-asesor.js")].exports.enviarYRegistrar = async (org, to) => {
    intentos.push(to);
    return { ok: true, wamid: `w-${to}` };
  };
  const NATALIA = { id: "adv-natalia", name: "Natalia Velez", phone: "573001878024" };
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: NATALIA });

  assert.deepStrictEqual(intentos, ["573001878024"]);
  assert.strictEqual(r.escaladoInmediato, false);
  delete process.env.RADAR_ESCALADO_PHONE;
});

test("un veredicto VIEJO sin el campo 'le_falta' no rompe el DM -- se degrada a sin aclaracion", async () => {
  telefonoColegaResuelto = "573001234567";
  veredictoDeSofi = { ...APRUEBA };
  delete veredictoDeSofi.le_falta;
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE, sesion: "RADA-NATALIA" });

  assert.strictEqual(r.resultado, "dm_enviado");
  assert.doesNotMatch(enviosDm[0].texto, /Aclaración:/);
});

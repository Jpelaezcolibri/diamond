// Modo asistido: Sofi revalida y le avisa a la asesora, sin publicar nada.
//
// Es el paso previo a encender las respuestas en el grupo. Su razon de ser es
// calibrar: cada oportunidad queda con el puntaje del motor, el veredicto de
// Sofi y —via signal_events— lo que la asesora termino haciendo. Con esas tres
// se ajusta el umbral con evidencia en vez de intuicion.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
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
  require.cache[RUTA("groups/revalidar.js")] = {
    exports: {
      revalidar: async (c, matches) => {
        loQueVioSofi = matches;
        return { veredicto: veredictoDeSofi, uso: {} };
      },
      apruebaAviso: (v) => Boolean(v && v.es_pedido_real && v.sirve_alguna && (v.refs_utiles || []).length),
    },
  };
  require.cache[RUTA("data/group-signals.js")] = {
    exports: {
      guardarRevalidacion: async (org, id, v) => { revalidacionesGuardadas.push({ id, v }); return true; },
      marcarAvisoEnviado: async (org, id, opts) => { avisosMarcados.push({ id, ...opts }); return true; },
      respuestasDesde: async () => ({ cantidad: 0, ultimaIso: null }),
      marcarRespondida: async () => true,
    },
  };
  require.cache[RUTA("data/organizations.js")] = {
    exports: { radarEncendido: () => true },
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
    autor: "Patricia Gomez", autorTelefono: "573001234567",
    instanteIso: new Date().toISOString(), esSistema: false, esMultimedia: false,
  };
}

function match(extra = {}) {
  return {
    fuente: "diamond", ref: "9780079", titulo: "Vendo Apartamento En Laureles",
    zona: "Laureles", precio: "$900.000.000", operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/x-9780079",
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
  claseDevuelta = "demanda";
  matchesDevueltos = [match()];
  veredictoDeSofi = { ...APRUEBA };
  loQueVioSofi = null;
  revalidacionesGuardadas = [];
  avisosMarcados = [];
  enviadosPorSofi = [];
  envioFalla = false;
  feedRegistrado = [];
  delete process.env.RADAR_ALERTA_TO;
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

test("el link al colega solo se arma si el numero es marcable (@lid queda descartado)", async () => {
  // Bug real 2026-08-18: antes se armaba el link con CUALQUIER telefono, sin
  // filtrar los @lid (14-15 digitos) — el asesor lo tocaba y no llevaba a
  // ningun lado.
  await vivo.procesarMensaje(
    ORG,
    { ...mensaje(), autorTelefono: "141746805670125" },
    { grupo: GRUPO, modo: "asistido", asesor: CATHERINE }
  );
  assert.match(enviadosPorSofi[0].texto, /sin teléfono — respondele en el grupo/);
  assert.doesNotMatch(enviadosPorSofi[0].texto, /wa\.me\/141746805670125/);
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

test("una oferta de un colega no dispara aviso", async () => {
  claseDevuelta = "oferta";
  const r = await vivo.procesarMensaje(ORG, mensaje(), { grupo: GRUPO, modo: "asistido", asesor: CATHERINE });
  assert.strictEqual(r.resultado, "oferta");
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

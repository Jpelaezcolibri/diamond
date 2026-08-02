// EPE — Edge Processing Engine. El nucleo de procesamiento local.
//
// QUE ES: la etapa del pipeline que corre en el dispositivo del asesor. Recibe
// mensajes crudos, descarta lo que no es negocio, y devuelve solo lo que vale
// la pena mirar. Hoy tiene un unico host — WhatsApp Web — y por eso no hay
// ninguna abstraccion de plataforma aca adentro.
//
// POR QUE IMPORTA: es lo que hace que ~85% de lo que el asesor ve en sus grupos
// nunca salga de su computador. No es una optimizacion de costo (aunque tambien
// lo sea): es la razon por la que un asesor puede aceptar instalarlo.
//
// ESTE ARCHIVO Y TODA SU CADENA VIAJAN AL NAVEGADOR. No pueden importar
// `node:*`, Supabase, `process.env`, `chrome.*` ni tocar el DOM. Lo custodian
// test/prefilter-puro.test.js y test/epe-bundle.test.mjs — el segundo revisa el
// bundle ya construido, no el fuente, que es donde un `require` transitivo se
// escaparia.
//
// LO QUE EL NUCLEO NO SABE: nada de la cuenta. Ni `org_id`, ni `groupId`, ni
// quien es el asesor. Esos son identidad de tenant y viven en el servidor. El
// sensor procesa texto y devuelve texto; el servidor decide de quien es.
//
// ORDEN DE LAS ETAPAS — no es arbitrario:
//   1. corte temporal   descarta lo viejo antes de gastar nada en ello
//   2. dedup            el mismo aviso difundido en N grupos se paga una vez
//   3. prefiltro        lo unico caro de las tres, va ultimo
// Invertir 2 y 3 costaria prefiltrar repetidos; invertir 1 y 2 costaria hashear
// mensajes que el corte iba a tirar igual.

const { prefilter } = require("../../src/groups/prefilter");
const { huella } = require("./hash");

// Tope de mensajes por corrida. Es la unica defensa real contra un costo
// sorpresa: sin el, un export completo de una linea activa (1.600 mensajes/dia
// por varios meses) son cientos de miles de mensajes en una sola tarde.
const MAX_MENSAJES = 20000;

// `desde` es la marca de agua: hasta donde se leyo este grupo la vez pasada.
// `dias` es una ventana relativa. Manda el mas reciente de los dos — si el
// grupo ya se leyo hasta ayer, no tiene sentido reprocesar la semana aunque el
// usuario haya pedido "ultimos 7 dias".
function aplicarCorte(mensajes, dias, desde = null) {
  const limites = [
    dias ? new Date(Date.now() - dias * 86400000).toISOString() : null,
    desde,
  ].filter(Boolean);
  if (limites.length === 0) return { dentro: mensajes, fuera: 0 };

  const corte = limites.sort().at(-1);
  // Un mensaje sin fecha no se puede fechar y por lo tanto no se puede
  // garantizar que sea reciente: se descarta.
  //
  // El limite es EXCLUSIVO (`>`): el mensaje que marca la frontera ya se
  // proceso en la corrida anterior.
  //
  // Se compara por el INSTANTE (con hora) y no por el dia: si no, todos los
  // mensajes de una jornada comparten limite y la marca de agua de la mañana se
  // come lo que llegue al mediodia — justo el caso que esto habilita.
  const dentro = mensajes.filter((m) => m.instanteIso && m.instanteIso > corte);
  return { dentro, fuera: mensajes.length - dentro.length };
}

// Dedup por contenido, ignorando el grupo: los colegas difunden el mismo aviso
// en diez grupos a la vez.
async function deduplicar(mensajes) {
  const vistos = new Set();
  const unicos = [];
  for (const m of mensajes) {
    const h = await huella(m);
    if (vistos.has(h)) continue;
    vistos.add(h);
    unicos.push(m);
  }
  return { unicos, repetidos: mensajes.length - unicos.length };
}

// ── La entrada publica ───────────────────────────────────────────────────
//
// mensajes: [{ id, texto, autor, instanteIso, esSistema, esMultimedia }]
//   `grupo` es opcional y solo se usa aguas abajo (idDeMensaje); el nucleo no
//   lo necesita.
//
// config: { dias, desde, maxMensajes }
//
// Devuelve { aEnviar, descartados, metricas }.
//   `descartados` sirve para auditar falsos negativos — el fallo mas caro del
//   sistema, porque es invisible. Quien lo consuma decide si lo mira o lo tira;
//   el nucleo no lo persiste ni lo manda a ningun lado.
async function procesar(mensajes, { dias = null, desde = null, maxMensajes = MAX_MENSAJES } = {}) {
  const crudos = mensajes.length;

  const corte = aplicarCorte(mensajes, dias, desde);

  // El tope se evalua DESPUES del corte: un export de tres años con marca de
  // agua de ayer trae dos mensajes, no cien mil.
  if (corte.dentro.length > maxMensajes) {
    const e = new Error(
      `${corte.dentro.length} mensajes superan el tope de ${maxMensajes}. Acorta el rango.`
    );
    e.codigo = "DEMASIADOS_MENSAJES";
    e.cuantos = corte.dentro.length;
    throw e;
  }

  const dedup = await deduplicar(corte.dentro);
  const { pasan, descartados, stats } = prefilter(dedup.unicos);

  return {
    aEnviar: pasan,
    descartados,
    metricas: {
      crudos,
      fueraDeCorte: corte.fuera,
      repetidos: dedup.repetidos,
      prefiltrados: stats.descartados,
      porMotivo: stats.porMotivo,
      aEnviar: pasan.length,
      // La metrica que vuelve medible el principio de minimizacion: que
      // proporcion de lo que el asesor ve NO sale de su equipo. Si baja
      // sostenidamente de ~0.70, el lexico necesita trabajo.
      tasaDescarte: crudos === 0 ? 0 : (crudos - pasan.length) / crudos,
    },
  };
}

module.exports = { procesar, aplicarCorte, deduplicar, MAX_MENSAJES };

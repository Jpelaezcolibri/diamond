// Procesa UN mensaje de grupo en tiempo real y decide si responde.
//
// El orquestador que ya existia (src/groups/importar-export.js) esta acoplado a
// archivos .txt: recibe buffers, arma grupos virtuales con prefijo "export" y
// reporta progreso para una barra. Nada de eso sirve para un mensaje suelto que
// acaba de llegar. Las ETAPAS puras, en cambio, sirven tal cual: todas aceptan
// un array de uno.
//
// El envio se INYECTA (`enviar`). No es un detalle de testeo: es lo que mantiene
// la capacidad de publicar en un solo lugar auditable —el transporte— en vez de
// repartirla por el pipeline. Este modulo decide QUE decir; no sabe como sale.
//
// Orden de las etapas y por que:
//   1. prefiltro lexico   gratis, descarta ~85% antes de gastar un token
//   2. clasificacion      Haiku, ~0.001 USD por mensaje suelto
//   3. cruce              codigo puro contra el inventario
//   4. persistencia       la senal vale aunque despues se decida callar
//   5. compuerta+politica lo ultimo: son las unicas que pueden publicar

const epe = require("../../epe/core");
const { classify } = require("./classify");
const { cruzar } = require("./match");
const { persistirSenal } = require("./persistir");
const publicable = require("./publicable");
const revalidar = require("./revalidar");
const alertaAsesor = require("./alerta-asesor");
const feedComando = require("./feed-comando");
const verificarLink = require("./verificar-link");
const politica = require("./politica");
const redactar = require("./redactar");
const groupSignals = require("../data/group-signals");
const organizations = require("../data/organizations");
const syncEstado = require("../data/sync-estado");
const whatsappGroups = require("../data/whatsapp-groups");
const advisors = require("../data/advisors");
const avisoCercano = require("./aviso-cercano");
const directorio = require("./directorio");
const waha = require("../lib/waha");
const formato = require("../lib/formato");
// Se importa el MODULO y no la funcion suelta: destructurar congela la
// referencia y deja los tests sin forma de mockear el envio.
const canalWhatsapp = require("../channels/whatsapp");
const mensajeAsesor = require("../lib/mensaje-asesor");
const ofertas = require("./ofertas");
const avisarMandato = require("./avisar-mandato");
const mandatosData = require("../data/mandatos");
const { evaluarOferta } = require("./cruce-mandatos");
const command = require("../data/command");
const cruceLeads = require("./cruce-leads");
const ritmo = require("../lib/ritmo-avisos");

const VENTANA_LIMITE_HORAS = 24;

// Quien revisa los "casi" del radar (Juan, 2026-08-20) — el telefono de
// Natalia Velez, la misma linea vinculada al radar. Configurable a proposito,
// mismo criterio que RADAR_ALERTA_TO: si cambia quien revisa, no hay que
// tocar codigo.
const RADAR_REVISOR_PHONE = process.env.RADAR_REVISOR_PHONE || "";

// A quien se escala de inmediato si el envio al asesor PRINCIPAL (Natalia)
// falla — Catherine (Juan, 2026-08-26): "si a Natalia no le llega, se escala".
// Se lee en cada llamado (no como constante de modulo) para que los tests
// puedan setear/cambiar la env var entre corridas sin recargar el modulo.
const radarEscaladoPhone = () => process.env.RADAR_ESCALADO_PHONE || "";

// El id de la senal en vivo NO se calcula con el hash del EPE: WhatsApp ya trae
// un id unico y estable por mensaje. Se prefija para que convivan las tres vias
// (export:, reenvio:, vivo:) en la misma columna sin colisionar, y para no tocar
// la semilla congelada de D2, que es contrato persistido.
function idEnVivo(waMessageId) {
  return `vivo:${waMessageId}`;
}

/**
 * @param org      organizacion resuelta
 * @param mensaje  { id, texto, autor, autorTelefono, instanteIso, esSistema,
 *                   esMultimedia, groupId, waMessageId }
 * @param grupo    fila de whatsapp_groups; `responde` decide si puede contestar
 * @param modo     'sombra' (redacta y no publica) | 'auto' (publica)
 * @param enviar   async (texto) => { ok, wamid } — lo provee el transporte
 * @param asesor   a quien se deriva en el mensaje (se resuelve afuera)
 * @param sesion   nombre de la sesion de WAHA (ej. "RADA-NATALIA"), no la fila
 *                 de whatsapp_groups; es lo que el directorio necesita para
 *                 pedirle a WAHA los participantes de este grupo.
 *
 * Devuelve siempre un objeto con `resultado`, para poder medir la corrida sin
 * leer logs. Nunca lanza por un mensaje suelto: un error en uno no puede tumbar
 * la escucha del grupo.
 */
async function procesarMensaje(org, mensaje, { grupo, modo = "sombra", enviar = null, asesor = null, advisorId = null, sesion = null, ahora = new Date() } = {}) {
  // Mismo interruptor que apaga el import: si el radar esta apagado no se gasta
  // un token ni se escribe una fila.
  if (!organizations.radarEncendido(org)) return { resultado: "radar_apagado" };

  // 1. Prefiltro. `procesar` acepta un array de uno sin cambios; el corte
  // temporal no aplica en vivo (el mensaje acaba de llegar) y el tope tampoco.
  const { aEnviar } = await epe.procesar([mensaje], { dias: null });
  if (!aEnviar.length) return { resultado: "descartado_prefiltro" };

  // 2. Clasificacion.
  const { clasificados } = await classify(aEnviar);
  const c = clasificados[0];
  if (!c) return { resultado: "sin_clasificar" };

  // El ruido muere aca, en memoria, sin tocar disco: invariante de privacidad
  // del Radar. La mayoria de los mensajes de un grupo gremial son ruido.
  if (c.clase === "ruido") return { resultado: "ruido" };

  // Ofertas de colegas: VOLVIERON a la escucha en vivo el 2026-08-25, pero no
  // como estaban antes.
  //
  // HISTORIA, porque el motivo importa. Juan las apago el 2026-08-20 ("apaguemos
  // las ofertas no las leamos solo quiero que lea los pedidos, las ofertas nos
  // estan saturando"): se persistian TODAS y eran el grueso de group_signals
  // (402 de 438 señales en dos dias), inflando cada consulta del radar sin
  // aportar lo que el negocio necesitaba. El problema nunca fue leerlas: fue
  // guardar cientos que nadie miraba.
  //
  // Lo que cambio es que ahora hay contra QUE cruzarlas — los mandatos de compra
  // (db/migrations/2026-08-25_mandatos_compra.sql). Asi que se invierte el orden:
  // se cruza en memoria y se persiste SOLO lo que le sirve a alguien. Con la tasa
  // de cruce medida (12 matches sobre 329 ofertas, ~4%), eso es un orden de
  // magnitud menos escritura que antes, y cada fila que queda tiene un dueño.
  //
  // Si algun dia hace falta el archivo completo de ofertas, el camino es el
  // import de export .txt (importar-export.js), que sigue guardando todo a
  // proposito: ahi es una carga puntual, no ruido continuo.
  // OJO: `jid` NO es una variable suelta en este scope (procesarMensaje solo
  // destructura grupo, modo, enviar, asesor, advisorId, sesion, ahora). El jid del
  // grupo vive en `grupo.jid` — pasar un `jid` inexistente aca es un
  // ReferenceError que revienta el primer mensaje de tipo oferta en produccion.
  if (c.clase === "oferta") return manejarOferta(org, c, grupo, { advisorId, sesion, jid: grupo && grupo.jid });

  // 3. Cruce contra inventario propio y aliados.
  const { demandas } = await cruzar([c], { org });
  const señal = demandas[0];
  if (!señal) return { resultado: "sin_señal" };
  señal.mensaje = { ...mensaje, groupId: grupo.id };

  // 4. Persistencia. Va antes de decidir: la senal es valiosa aunque despues se
  // resuelva callar, y el digest de la manana la va a usar igual.
  const { signal, duplicado } = await persistirSenal(org, señal, {
    origen: "vivo",
    advisorId,
    autorTelefono: mensaje.autorTelefono || null,
    waMessageId: idEnVivo(mensaje.waMessageId || mensaje.id),
  });
  if (duplicado) return { resultado: "duplicado" };

  // Deja constancia de QUIEN publico, con su telefono si WhatsApp lo deja ver.
  // Va aca y no antes a proposito: se registra a quien publica un pedido que
  // vale la pena cruzar, no a los 1.012 participantes que se podrian listar de
  // los grupos (ver db/migrations/2026-08-22_colegas_grupos.sql — el limite es
  // deliberado, no una optimizacion).
  //
  // Best-effort y SIN await, mismo patron que whatsappGroups.touchSession en
  // src/channels/whatsapp-group.js: nada rio abajo (politica.decidir, la
  // redaccion, la publicacion) usa el telefono que devuelve, y el primer
  // registro de cada ventana de 10 min puede disparar un HTTP a WAHA que trae
  // hasta 878 participantes — esperarlo pagaria esa latencia ANTES de que el
  // radar decida si publica, y como el procesamiento va en cola por grupo, el
  // pedido siguiente esperaria detras.
  // `pista` es el numero que WhatsApp a veces manda en el payload del propio
  // mensaje, ya validado como celular colombiano
  // (whatsapp-group.js#telefonoVisible): cuando viene, ahorra la unica fuente
  // que teniamos y ademas siembra el indice para el resto del grupo.
  directorio.registrar(org.id, {
    lid: mensaje.autorTelefono,
    nombre: mensaje.autor,
    grupo: mensaje.grupo,
    sesion,
    jid: grupo.jid,
    pista: mensaje.autorTelefonoVisible || null,
  }).catch((e) => console.warn("[radar] No se pudo registrar al colega en el directorio:", e.message));

  // MODO ASISTIDO: no se publica NADA en el grupo. Sofi revalida las candidatas
  // y, si aprueba, le escribe a la asesora. Es el paso previo a encender las
  // respuestas: sirve para calibrar el motor sin exponer la marca.
  if (modo === "asistido") {
    return asistir(org, c, señal, signal, { mensaje, grupo, asesor, ahora, sesion });
  }

  // 5. Compuerta de calidad del dato, y despues politica de conducta. Son dos
  // preguntas distintas: "¿este dato es publicable?" y "¿corresponde hablar?".
  //
  // La frescura del inventario entra ACA y no en la politica porque no es una
  // regla de conducta: es una propiedad del dato. Si el sync de Wasi se detuvo,
  // no se sabe que se vendio desde entonces, y ofrecer en un grupo gremial algo
  // vendido hace tres dias es el error que no se puede deshacer.
  const inventario = await syncEstado.estadoDelInventario(org.id, { ahora });
  const { publicables: candidatas, descartados } = publicable.filtrar(señal.matches || [], {
    syncFresco: inventario.fresco,
  });

  // Ultimo control, sobre las tres finalistas: que el link ABRA de verdad. La
  // landing lee de la misma tabla, asi que esto no dice nada sobre si la
  // propiedad se vendio —de eso se ocupa la compuerta de frescura— pero si
  // verifica el artefacto exacto que va a recibir el colega. El slug lo
  // construyen dos implementaciones separadas y nada mas comprueba que sigan
  // coincidiendo.
  const { verificadas: publicables, rotas } = await verificarLink.verificar(candidatas);
  for (const r of rotas) descartados.push({ ref: r.ref, motivos: ["link_no_abre"] });

  const recientes = await groupSignals.respuestasDesde(
    org.id,
    grupo.id,
    new Date(ahora.getTime() - VENTANA_LIMITE_HORAS * 3600 * 1000).toISOString()
  );

  const decision = politica.decidir({
    senal: { clase: c.clase, confianza: c.confianza, respondida_at: signal && signal.respondida_at, edificio: c.edificio || null },
    publicables,
    grupo,
    modo,
    respuestasRecientes: recientes ? recientes.cantidad : null,
    ahora,
  });

  // Feed del admin, tambien para el camino determinista (auto/sombra): sin
  // esto, todo lo que la compuerta de calidad o la politica callan desaparece
  // sin dejar rastro — "callar es gratis" para el grupo, pero no puede serlo
  // para el seguimiento de Juan/Catherine. Best-effort: un problema
  // escribiendo el feed no puede tumbar el pipeline del radar.
  const señalParaFeed = { grupo_nombre: grupo.nombre || grupo.jid, autor_nombre: mensaje.autor, texto_original: mensaje.texto };
  const avisarFeed = (resultado, extra = {}) =>
    feedComando
      .registrarAuto(org, señalParaFeed, resultado, { publicables, descartados, decision, ...extra })
      .catch((e) => console.warn("[radar] No se pudo escribir en el feed del admin:", e.message));

  if (!decision.publicar) {
    await avisarFeed("callado");
    // Guardado en la senal misma, no solo en el feed de chat: sin esto, "por
    // que no se envio X" solo se podia responder buscando a mano entre los
    // mensajes del feed — y Sofi, sin ese cruce, terminaba inventando un motivo.
    await groupSignals.guardarPolitica(org.id, signal.id, { motivo: decision.motivo, traza: decision.traza }).catch(() => {});
    // "que no se salte ninguno de los dos" (Juan, 2026-08-20), simplificado
    // en una segunda vuelta el mismo dia: "lo que no se responda por el bot
    // debe de ir de una al chat de natalia... no podemos dejar pasar ningun
    // pedido". Antes esto avisaba SOLO para dos motivos puntuales
    // (sin_propiedades_publicables, grupo_no_habilitado) y cada motivo nuevo
    // era un hueco nuevo — el pedido de Juanita Monsalve (zona "ciudad", sin
    // barrio) se salto los dos caminos por un tercer motivo que la lista
    // todavia no cubria. Ya no se filtra por motivo: cualquier "callado"
    // avisa, salvo los dos que serian ruido real:
    //   - ya_respondida: el pedido YA se resolvio (por este mismo camino o
    //     por auto), avisar de nuevo confundiria a Natalia sobre algo cerrado.
    //   - modo_apagado: la respuesta del radar esta apagada a proposito para
    //     toda la org — avisar contradiria esa decision.
    if (!["ya_respondida", "modo_apagado"].includes(decision.motivo)) {
      await avisarCercano(org, signal, mensaje, grupo, señal.matches || [], { edificio: c.edificio || null })
        .catch((e) => console.warn("[radar] No se pudo avisar el candidato cercano:", e.message));
    }
    return { resultado: "callado", motivo: decision.motivo, traza: decision.traza, descartados, signalId: signal && signal.id };
  }

  // Mensaje "blanqueado" (Juan, 2026-08-18): sin asesor, a proposito — ver
  // la nota de diseño en redactar.js. Se pasa `org` para que el renglon de
  // invitacion a Sofi (si lo hay) resuelva el numero multi-tenant.
  const texto = redactar.mensajeGrupo({ autor_nombre: mensaje.autor }, publicables, { org });
  if (!texto) return { resultado: "callado", motivo: "sin_texto", traza: decision.traza, signalId: signal && signal.id };

  const refs = publicables.map((m) => m.ref).filter(Boolean);

  // En sombra se redacta y se registra, pero NO se publica. Es la prueba de humo
  // que valida la calidad del mensaje sin que nadie en el grupo vea nada.
  if (modo === "sombra") {
    await groupSignals.marcarRespondida(org.id, signal.id, { texto, wamid: null, modo: "sombra", refs });
    await avisarFeed("sombra");
    return { resultado: "sombra", texto, publicables, traza: decision.traza, signalId: signal.id };
  }

  if (typeof enviar !== "function") {
    return { resultado: "callado", motivo: "sin_transporte", traza: decision.traza, signalId: signal.id };
  }

  const envio = await enviar(texto);
  if (!envio || !envio.ok) {
    return { resultado: "error_envio", error: envio && envio.error, traza: decision.traza, signalId: signal.id };
  }

  // Se registra DESPUES de que salio, con el id real del mensaje publicado: si
  // manana un colega reclama por lo que se dijo, la unica respuesta honesta es
  // mostrar el texto tal como salio.
  await groupSignals.marcarRespondida(org.id, signal.id, { texto, wamid: envio.wamid, modo: "auto", refs });
  await avisarFeed("publicado");
  return { resultado: "publicado", texto, wamid: envio.wamid, publicables, traza: decision.traza, signalId: signal.id };
}

// El texto que recibe el colega en el DM directo (Juan, 2026-08-24).
//
// Reusa redactar.mensajeGrupo TAL CUAL — "el mismo texto que antes iba al
// grupo" (mismo mensaje "blanqueado": ficha completa, sin mencionar Diamond,
// firmado "Sofi, asistente virtual"). Ver la nota de diseño en redactar.js.
//
// CORRECCION (Juan, 2026-08-24): esta funcion armaba su PROPIO renglon
// adicional con linkContactoOficial(org) encima del que redactar.js ya ponia
// con su propio numero fijo (SOFI_WHATSAPP_NUMBER) -- el colega recibia dos
// invitaciones a escribirle a Sofi, una debajo de la otra. redactar.js#mensajeGrupo
// ya resuelve el numero multi-tenant (recibe `org` en las opciones), asi que
// no hace falta nada mas aca. Se deja la funcion, en vez de llamar a
// mensajeGrupo directo desde el llamador, porque documenta con nombre la
// intencion (el texto que le llega al colega por DM).
// `sinConfirmar` y `leFalta` (Juan, 2026-08-24, opcionales): los dos huecos
// que el veredicto de Sofi declara sobre estas mismas `utiles` -- lo que no
// sabemos y lo que sabemos que no cumple (ver revalidar.js). Se pasan tal
// cual a redactar.mensajeGrupo, que decide donde va cada uno.
function textoParaColega(autorNombre, utiles, org, sinConfirmar = [], leFalta = []) {
  return redactar.mensajeGrupo({ autor_nombre: autorNombre }, utiles, { org, sinConfirmar, leFalta });
}

// Sofi da su veredicto y, si aprueba, le avisa a la asesora.
//
// Sofi ve TODAS las candidatas, tambien las de puntaje bajo: es la unica forma
// de descubrir que el umbral esta dejando pasar oportunidades buenas. Los falsos
// negativos son invisibles por definicion y son los caros.
//
// Quien decide si se avisa es Sofi, no el puntaje. El veredicto se guarda
// SIEMPRE —aunque diga que no sirve— porque el "no" tambien ensena.
async function asistir(org, c, señal, signal, { mensaje, grupo, asesor, ahora, sesion = null }) {
  const matches = señal.matches || [];
  if (matches.length === 0) return { resultado: "sin_candidatas", signalId: signal && signal.id };

  const { veredicto } = await revalidar.revalidar(c, matches);
  if (!veredicto) {
    // Falla cerrada: sin veredicto no se le escribe a nadie.
    return { resultado: "sin_veredicto", signalId: signal && signal.id };
  }
  await groupSignals.guardarRevalidacion(org.id, signal.id, veredicto);

  const señalParaFeed = { grupo_nombre: grupo.nombre || grupo.jid, autor_nombre: mensaje.autor, texto_original: mensaje.texto };

  if (!revalidar.apruebaAviso(veredicto)) {
    // Feed del admin: tambien los rechazados. Best-effort — un problema
    // escribiendo el feed no puede tumbar el pipeline del radar.
    await feedComando.registrar(org, señalParaFeed, veredicto, matches).catch((e) =>
      console.warn("[radar] No se pudo escribir en el feed del admin:", e.message)
    );
    return { resultado: "descartada_por_sofi", veredicto, signalId: signal.id };
  }

  // Telefono REAL del colega, resuelto por el directorio a partir del @lid
  // (mensaje.autorTelefono). CORRECCION (code review post-merge, 2026-08-24):
  // este comentario decia "nunca se le pasa el lid crudo a alertaAsesor", pero
  // si se le pasa — como autor_telefono, mas abajo — porque construir() lo usa
  // de ULTIMO intento para el 33% que no se resuelve (ver la nota en ese
  // archivo, revision 2026-08-24). Lo que evita que un lid crudo se muestre
  // como si fuera un telefono no es que no llegue, es que contactoPara lo
  // filtra con esCelularColombiano antes de usarlo. Falla cerrado y en
  // silencio: sin telefono resuelto NI autor_telefono que pase el filtro,
  // alertaAsesor.construir arma igual el aviso, solo que con la instruccion
  // de tocar el nombre en el grupo en vez de un link directo — un fallo aca
  // nunca puede tumbar el aviso.
  const telefonoColega = await directorio
    .telefonoDe(org.id, mensaje.autorTelefono, { sesion, jid: grupo.jid, pista: mensaje.autorTelefonoVisible || null })
    .catch((e) => {
      console.warn("[radar] No se pudo resolver el telefono del colega para el aviso:", e.message);
      return null;
    });

  // DM DIRECTO AL COLEGA (Juan, 2026-08-24): "que el bot responda solo" — el
  // gremio espera la respuesta al interno, nunca en el grupo. Antes de
  // intentarlo pasa por el freno de politica.js#decidirDm (una vez por colega
  // por dia, pedido reciente, tope diario de la linea): NINGUNO de esos tres
  // descarta el pedido, todos desvian a la asesora de siempre — "no podemos
  // dejar pasar ningun pedido" (Juan). Sin `sesion` (nombre de la sesion de
  // WAHA) tampoco se puede intentar: es el dato que le dice a waha.enviarDm
  // por cual linea salir, y sin el no hay como enviar nada.
  //
  // Candidatas que Sofi marco utiles — la misma lista que alertaAsesor.js
  // recalcula mas abajo para el aviso a la asesora, pero hace falta ACA
  // tambien para poder armar el DM con redactar.mensajeGrupo antes de saber
  // si el DM va a poder salir.
  const utilesSegunSofi = (veredicto.refs_utiles || [])
    .map((ref) => matches.find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);

  // COMPUERTA DE CALIDAD DEL DATO, tambien en el DM automatico (auditoria
  // 2026-09-02): responderPorDmManual y aprobarManual ya recalculaban
  // publicable.filtrar + verificarLink, pero este camino mandaba lo que Sofi
  // aprobara tal cual -- una ref con precio corrupto, sin link de Wasi, de un
  // aliado, o con el sync de Wasi detenido salia igual al privado del colega.
  // umbral: 0 porque el veredicto de Sofi reemplaza al puntaje (mismo criterio
  // que el DM manual); las barreras de dato y de seguridad siguen duras. Lo
  // que no pasa NO se pierde: cae al aviso a la asesora de siempre.
  const inventarioDm = await syncEstado.estadoDelInventario(org.id, { ahora: ahora || new Date() });
  const { publicables: utilesLimpias, descartados: descartadosDm } = publicable.filtrar(utilesSegunSofi, {
    syncFresco: inventarioDm.fresco,
    umbral: 0,
  });
  const { verificadas: utiles, rotas: rotasDm } = await verificarLink.verificar(utilesLimpias);
  for (const r of rotasDm) descartadosDm.push({ ref: r.ref, motivos: ["link_no_abre"] });
  if (utilesSegunSofi.length > 0 && utiles.length === 0) {
    console.warn(
      `[radar] Sofi aprobo ${utilesSegunSofi.length} ref(s) pero ninguna pasa la compuerta de calidad para el DM: ` +
        descartadosDm.map((d) => `${d.ref}:${d.motivos.join("|")}`).join(", ")
    );
  }

  const desdeIso = new Date((ahora || new Date()).getTime() - VENTANA_LIMITE_HORAS * 3600 * 1000).toISOString();
  const [dmsColegaHoy, dmsLineaHoy] = telefonoColega
    ? await Promise.all([
        groupSignals.dmsHoyPorColega(org.id, mensaje.autorTelefono, desdeIso),
        groupSignals.dmsHoyLinea(org.id, desdeIso),
      ])
    : [null, null];

  const decisionDm = politica.decidirDm({
    telefono: telefonoColega,
    fechaMensajeIso: mensaje.instanteIso,
    ahora: ahora || new Date(),
    dmsHoyColega: dmsColegaHoy,
    dmsHoyLinea: dmsLineaHoy,
  });

  // Auditable igual que el resto de las decisiones del radar (mismo llamado
  // que usa el camino auto/sombra mas arriba en este archivo, sobre la misma
  // columna): la razon por la que un pedido salio por DM o por la asesora
  // queda en la señal misma, no solo en un log que se pierde.
  await groupSignals.guardarPolitica(org.id, signal.id, { motivo: decisionDm.motivo, traza: decisionDm.traza }).catch(() => {});

  if (decisionDm.enviarDm && sesion && utiles.length > 0) {
    const textoDm = textoParaColega(
      mensaje.autor,
      utiles,
      org,
      veredicto.sin_confirmar || [],
      veredicto.le_falta || []
    );
    if (textoDm) {
      let envioDm = await waha.enviarDm(sesion, telefonoColega, textoDm).catch((e) => ({ ok: false, error: e.message }));
      // UN solo reintento, y solo si el fallo fue ANTES de que el mensaje
      // saliera (WAHA lo rechazo, o la conexion ni se establecio -- ver
      // `previoAlEnvio` en waha.js#enviarDm). Un timeout NO se reintenta: el
      // estado es desconocido y duplicarle el DM a un colega es justo la
      // conducta que hace que a uno lo reporten. La linea reconecta ~10 veces
      // al dia (medido 2026-09-02), asi que este caso es real y hoy tiraba el
      // pedido al camino manual sin necesidad.
      if (envioDm && !envioDm.ok && envioDm.previoAlEnvio) {
        console.warn(`[radar] El DM no llego a salir (${envioDm.error}); un reintento en 3 s.`);
        await new Promise((r) => setTimeout(r, 3000));
        envioDm = await waha.enviarDm(sesion, telefonoColega, textoDm).catch((e) => ({ ok: false, error: e.message }));
      }
      if (envioDm && envioDm.ok) {
        // Se registra con modo 'auto' — igual que el camino que publica DENTRO
        // del grupo (ver la nota en group-signals.js#dmsHoyPorColega sobre por
        // que no hace falta un valor nuevo en la columna): en modo asistido,
        // que es el UNICO que llega hasta aca, 'auto' solo puede significar
        // "el sistema lo mando solo por DM", nunca "lo publico en el grupo".
        const refsDm = utiles.map((m) => m.ref).filter(Boolean);
        await groupSignals.marcarRespondida(org.id, signal.id, { texto: textoDm, wamid: envioDm.wamid, modo: "auto", refs: refsDm });

        // Aviso post-DM (Juan, 2026-09-01): "no tiene nada que hacer" solo es
        // cierto si no queda nada pendiente -- si el pedido tenia dudosas,
        // esas se le avisan igual, aparte del DM que ya salio. Best-effort:
        // un fallo aca no puede tumbar el resultado "dm_enviado", que ya es
        // verdad sin importar si este aviso extra sale o no.
        //
        // Deliberadamente NO pasa por marcarAvisoEnviado/tracking de avisos al
        // asesor (revision post-review, 2026-09-01): esta señal YA quedo
        // resuelta por el DM (marcarRespondida, arriba). Si este aviso extra
        // quedara registrado con ese mismo mecanismo, candidatosRecordatorio y
        // candidatosEscaladoSilencio (src/data/group-signals.js) la tomarian
        // como candidata a recordatorio/escalado a Catherine -- filtran solo
        // por `aviso_advisor_id` + `enviado_at`, no por si el pedido ya se
        // resolvio. Es exactamente el bug de doble escalado que ya se corrigio
        // en el commit 5db7e74. No "arreglar" esto conectando el tracking.
        let avisoPostDm = null;
        if (asesor && asesor.phone) {
          // Grupo + telefono ya resuelto (Juan, 2026-09-01): si la asesora
          // decide que SI vale la pena mandar una dudosa, no puede tener que
          // volver al grupo a buscar quien la pidio -- telefonoColega ya esta
          // resuelto aca mismo (es el que acaba de recibir el DM).
          avisoPostDm = alertaAsesor.construirAvisoPostDm(
            { autor_nombre: mensaje.autor, grupo_nombre: grupo.nombre || grupo.jid, autor_telefono: mensaje.autorTelefono },
            veredicto,
            matches,
            refsDm,
            telefonoColega
          );
          if (avisoPostDm) {
            // Mismo criterio que telefonoPrincipal mas abajo en esta funcion: la
            // tabla advisors guarda el numero en formatos distintos segun quien lo
            // cargo (ver src/data/advisors.js) y enviarYRegistrar espera solo digitos.
            const telefonoAsesor = String(asesor.phone).replace(/\D/g, "");
            await mensajeAsesor.enviarYRegistrar(org, telefonoAsesor, avisoPostDm).catch((e) =>
              console.warn("[radar] No se pudo mandar el aviso post-DM:", e.message)
            );
          }
        }

        // El feed del admin SI se entera siempre — es la trazabilidad que ya
        // usa el resto de este archivo, con quien realmente se avisó. Si
        // ademas salio el aviso post-DM de pendientes, se suma a la misma
        // linea -- de lo contrario el feed reportaria solo la mitad de a
        // quien realmente se le avisó (este radar ya tuvo un caso de un
        // reporte de avisos inventado, ver 2026-08-18 en el historial).
        await feedComando
          .registrar(org, señalParaFeed, veredicto, matches, {
            avisada: true,
            destinatarioNombre: `DM directo a ${mensaje.autor || "el colega"}${avisoPostDm ? ` + aviso de pendientes a ${asesor.name || "la asesora"}` : ""}`,
          })
          .catch((e) => console.warn("[radar] No se pudo escribir en el feed del admin:", e.message));
        return { resultado: "dm_enviado", veredicto, texto: textoDm, telefono: telefonoColega, signalId: signal.id };
      }
      // Si el envio falla, se cae al aviso a la asesora de siempre: ningun
      // pedido puede quedar sin que alguien lo atienda. Y la señal deja de
      // decir "ok": el motivo real es que el transporte fallo.
      console.warn(`[radar] Fallo el DM al colega, se avisa a la asesora en su lugar: ${envioDm && envioDm.error}`);
      await groupSignals
        .guardarPolitica(org.id, signal.id, { motivo: "dm_fallido", traza: [...decisionDm.traza, `NO:dm_fallido:${envioDm && envioDm.error}`] })
        .catch(() => {});
    }
  }

  // Se le pasan tambien los campos del clasificado (Juan, 2026-09-02: "que
  // entienda que busca el colega") y el motivo por el que el DM no salio
  // ("que entienda por que no se envio de manera automatica"). Los dos datos
  // ya existian —el clasificador los extrae, decidirDm decide el motivo— y
  // solo faltaba llevarlos hasta el mensaje que lee la asesora.
  const texto = alertaAsesor.construir(
    {
      grupo_nombre: grupo.nombre || grupo.jid,
      autor_nombre: mensaje.autor,
      autor_telefono: mensaje.autorTelefono,
      texto_original: mensaje.texto,
      operacion: c.operacion,
      tipo: c.tipo,
      zona: c.zona,
      zonas: c.zonas,
      precio_max: c.precio_max,
      habitaciones: c.habitaciones,
      flexible_habitaciones: c.flexible_habitaciones,
      area_min: c.area_min,
      banos: c.banos,
      garajes: c.garajes,
      estrato: c.estrato,
    },
    veredicto,
    matches,
    telefonoColega,
    org,
    decisionDm.motivo
  );
  if (!texto) {
    await feedComando.registrar(org, señalParaFeed, veredicto, matches).catch((e) =>
      console.warn("[radar] No se pudo escribir en el feed del admin:", e.message)
    );
    return { resultado: "descartada_por_sofi", veredicto, signalId: signal.id };
  }

  const destinos = destinatarios(asesor);
  if (destinos.length === 0) {
    console.warn("[radar] Sofi aprobo una oportunidad pero no hay a quien avisarle.");
    return { resultado: "sin_destinatario", veredicto, texto, signalId: signal.id };
  }

  // FRENO DE RITMO (Juan, 2026-09-02: "no quiero que seas tan insistente").
  // Si a esta asesora ya se le escribio hace poco, el aviso NO sale ahora: la
  // señal queda con enviado_at en null y la bandeja de salida
  // (src/scheduler/avisos-salida.js) la entrega agrupada con lo demas que se
  // acumule. Medido ese dia: 23 mensajes a Natalia en tres horas, cero
  // respuestas y cuatro rechazados por WhatsApp por exceso de frecuencia.
  //
  // El PRIMER aviso siempre pasa y sale en el momento — la agrupacion existe
  // para la rafaga, no para el goteo.
  if (asesor && asesor.id && !ritmo.puedeEnviar(asesor.id)) {
    await feedComando
      .registrar(org, señalParaFeed, veredicto, matches, { avisada: false, destinatarioNombre: "en cola de salida" })
      .catch((e) => console.warn("[radar] No se pudo escribir en el feed del admin:", e.message));
    return { resultado: "en_cola", veredicto, texto, signalId: signal.id };
  }

  // Sale por la Cloud API OFICIAL de Sofi, no por la linea vinculada.
  //
  // El telefono PRINCIPAL (asesor.phone) es el UNICO que pasa por
  // mensajeAsesor.enviarYRegistrar: queda guardado como mensaje real (visible
  // en el panel "Equipo" del CRM) y es de quien se guarda el wamid, para
  // matchear una respuesta citada con esta señal exacta. RADAR_ALERTA_TO es
  // para monitoreo (Juan, calibracion) — gente de quien no se espera un
  // resultado — y sigue siendo un envio directo, sin crearle una conversacion.
  const telefonoPrincipal = asesor && asesor.phone ? String(asesor.phone).replace(/\D/g, "") : null;
  let alguno = false;
  let wamidPrincipal = null;
  let entregadoATelefonoPrincipal = false;
  for (const to of destinos) {
    const r = to === telefonoPrincipal
      ? await mensajeAsesor.enviarYRegistrar(org, to, texto).catch((e) => ({ ok: false, error: e.message }))
      : await canalWhatsapp.sendWhatsApp(org, to, texto).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) {
      alguno = true;
      if (to === telefonoPrincipal) {
        wamidPrincipal = r.wamid || null;
        entregadoATelefonoPrincipal = true;
      }
    } else {
      console.warn(`[radar] No se pudo avisar a ${to}: ${r && r.error}`);
    }
  }

  // Escalado INMEDIATO a Catherine si especificamente a Natalia (el asesor
  // PRINCIPAL) no le llego el aviso (Juan, 2026-08-26) — sin importar si algun
  // destino extra de RADAR_ALERTA_TO si lo recibio: la condicion de Juan es
  // "si a Natalia no le llega", no "si a nadie le llega". Es un intento EXTRA,
  // no reemplaza los destinos existentes.
  let escaladoInmediato = false;
  const RADAR_ESCALADO_PHONE = radarEscaladoPhone();
  if (telefonoPrincipal && !entregadoATelefonoPrincipal && RADAR_ESCALADO_PHONE && RADAR_ESCALADO_PHONE !== telefonoPrincipal) {
    const rEscalado = await mensajeAsesor.enviarYRegistrar(org, RADAR_ESCALADO_PHONE, texto).catch((e) => ({ ok: false, error: e.message }));
    if (rEscalado && rEscalado.ok) {
      escaladoInmediato = true;
      alguno = true;
      console.log(`[radar] el aviso a ${telefonoPrincipal} no se pudo entregar, se escalo a ${RADAR_ESCALADO_PHONE}`);
    } else {
      console.warn(`[radar] tampoco se pudo escalar a ${RADAR_ESCALADO_PHONE}: ${rEscalado && rEscalado.error}`);
    }
    // Se marca la señal como escalada YA se intento el escalado, sin importar
    // si salio o no (Juan, review sobre c41d1b4): si no se marca, el scheduler
    // radar-silencio.js la vuelve a agarrar como "sin escalar" pasados los 30
    // min y le manda el MISMO aviso a Catherine por segunda vez. Que esto
    // falle no puede tumbar la funcion — a lo sumo el scheduler reintenta.
    await groupSignals
      .claimEscaladoSilencio(org.id, signal.id)
      .catch((e) => console.warn("[radar] No se pudo marcar el escalado inmediato como escalado por silencio:", e.message));
  }

  // Solo se marca enviado si SALIO. Si no, queda pendiente: fuera de la ventana
  // de 24 h Meta rechaza el texto libre, y esa senal se puede reintentar cuando
  // la asesora escriba y la ventana se reabra.
  //
  // Se guarda el destinatario REAL (asesor.id) — nunca "quien observo el
  // grupo" (advisorId, el dueño de la linea vinculada): son cosas distintas y
  // confundirlas fue justo el bug que le hizo inventar un nombre a Sofi el
  // 2026-08-18.
  if (alguno) {
    // Solo cuenta para el ritmo si llego a la asesora PRINCIPAL: una copia de
    // calibracion que si salio no justifica callar el aviso siguiente.
    if (entregadoATelefonoPrincipal && asesor && asesor.id) ritmo.registrarEnvio(asesor.id);
    await groupSignals.marcarAvisoEnviado(org.id, signal.id, {
      wamid: wamidPrincipal,
      advisorId: asesor && asesor.id ? asesor.id : null,
    });
  }

  await feedComando
    .registrar(org, señalParaFeed, veredicto, matches, { avisada: alguno, destinatarioNombre: asesor && asesor.name })
    .catch((e) => console.warn("[radar] No se pudo escribir en el feed del admin:", e.message));

  return {
    resultado: alguno ? "avisada" : "aviso_pendiente",
    veredicto,
    texto,
    destinos,
    escaladoInmediato,
    signalId: signal.id,
  };
}

// A quien se le avisa. Por defecto la asesora de la rotacion de venta; la
// variable permite sumar a alguien mas durante la calibracion sin tocar codigo.
function destinatarios(asesor) {
  const extra = (process.env.RADAR_ALERTA_TO || "")
    .split(",")
    .map((t) => t.trim().replace(/\D/g, ""))
    .filter(Boolean);
  const base = asesor && asesor.phone ? [String(asesor.phone).replace(/\D/g, "")] : [];
  return [...new Set([...base, ...extra])];
}

// Aviso a quien revisa los pedidos que el bot no respondio solo (Juan,
// 2026-08-20): "necesito que catherine uribe reciba que se envió y que no y
// por que no para que ella apruebe desde su celular" — corregido despues a
// Natalia Velez, la misma linea vinculada, "para no perder la trazabilidad".
// Si dice que si, se publica por la MISMA via auditada (aprobarManual mas
// abajo) desde su propio chat con Sofi (src/agent/tools.js#aprobar_pedido_radar).
//
// SIMPLIFICADO en una segunda vuelta el mismo dia (Juan): "lo que no se
// responda por el bot debe de ir de una al chat de natalia... el bot
// contesta los de puntaje mas alto y el resto que lo revise natalia". Antes
// esto curaba por MOTIVO (solo puntaje_bajo, despues tambien zona "ciudad")
// y cada motivo nuevo era un hueco nuevo — el pedido de Juanita Monsalve se
// salto los dos caminos por un motivo que la curaduria de ese momento
// todavia no cubria. Ya no se cura por motivo: si el motor encontro AL MENOS
// UNA candidata con dato usable, se avisa — sea cual sea la razon por la que
// el bot no respondio solo (puntaje, zona, aliado, config del grupo). El
// unico filtro que queda es de DATO, no de negocio: un match sin titulo, sin
// zona o sin precio no le sirve a Natalia en un mensaje de texto, sea cual
// sea el motivo. La decision de si SIRVE la toma ella, no el motivo.
//
// Las barreras de seguridad reales (zona explicitamente equivocada, aliado)
// no se relajaron: siguen bloqueando la PUBLICACION incluso si Natalia dice
// que si (ver aprobarManual mas abajo) — lo que cambia aca es solo a quien
// se le avisa, nunca que se puede publicar sin revisar.
async function avisarCercano(org, signal, mensaje, grupo, matches, { edificio = null } = {}) {
  if (!RADAR_REVISOR_PHONE) return;

  // `formato.parsearPrecio` y no un truthy check crudo: un precio "$0" (label
  // vacio en Wasi) es un string no vacio, asi que pasaria el filtro sin esto
  // — el mismo bug de dato corrupto que publicable.js ya resuelve para la
  // publicacion, pero esto corre ANTES de esa compuerta.
  const candidatas = (matches || []).filter(
    (m) => m && (m.titulo || m.ref) && String(m.zona || "").trim() && formato.parsearPrecio(m.precio) !== null
  );
  // EDIFICIO ESPECIFICO (Juan, 2026-08-21): se avisa SIEMPRE, aunque no haya
  // ninguna candidata por zona — Natalia puede conocer un inmueble en ese
  // edificio que el cruce por zona nunca iba a encontrar, y es justo por eso
  // que el pedido tiene que llegarle (ver politica.js#edificio_especifico).
  if (!candidatas.length && !edificio) return;

  const revisor = await advisors.findByPhone(org.id, RADAR_REVISOR_PHONE).catch(() => null);
  if (!revisor) return;

  const señalParaAviso = { grupo_nombre: grupo.nombre || grupo.jid, autor_nombre: mensaje.autor, texto_original: mensaje.texto };
  let texto = edificio
    ? avisoCercano.construirEdificio(señalParaAviso, candidatas, edificio)
    : avisoCercano.construir(señalParaAviso, candidatas, org);
  if (!texto) return;
  // El cuerpo de un mensaje interactivo tiene tope duro de 1024 caracteres en
  // la API de Meta (un pedido con muchas candidatas lo puede pasar); un
  // recorte silencioso es preferible a que el envio entero falle sin avisar.
  if (texto.length > 1024) texto = `${texto.slice(0, 1000)}\n\n(recortado — ver el pedido completo en el CRM)`;

  // SIN BOTONES en el caso de edificio (Juan, 2026-08-21): "Sí, publicar"
  // publicaria las candidatas de zona tal cual, como si fueran el edificio
  // pedido — exactamente el dato no verificable que esta señal existe para
  // frenar. Aca la accion correcta no es un toque, es que Natalia responda
  // ELLA con lo que sabe del edificio.
  //
  // SOLO "No sirve" en el resto (Juan, 2026-08-22): el boton "Sí, publicar"
  // se saco de aca — publicaba en el grupo, que es justo la accion que el
  // gremio pidio dejar de hacer (ver la cabecera de aviso-cercano.js). Natalia
  // lo toco dos veces el mismo dia porque el aviso se lo seguia ofreciendo
  // aunque la norma ya habia cambiado. "No sirve" queda porque sigue siendo
  // valido: registra el descarte (ver src/agent/tools.js#rechazarPedidoRadar)
  // y no publica nada. aprobarManual (mas abajo) sigue existiendo para
  // publicar a proposito desde el CRM — ese camino no se toco.
  const opts = edificio
    ? {}
    : { botones: [
        { id: `radar_no:${signal.id}`, title: "No sirve" },
      ] };

  const envio = await mensajeAsesor
    .enviarYRegistrar(org, revisor.phone, texto, opts)
    .catch((e) => ({ ok: false, error: e.message }));
  if (envio && envio.ok) {
    await groupSignals.marcarAvisoEnviado(org.id, signal.id, { wamid: envio.wamid, advisorId: revisor.id }).catch(() => {});
  }
}

// Aprobacion manual de un pedido que el radar callo (Juan, 2026-08-20): "que
// yo pueda aprobarlo de manera manual dentro del chat de Sofi y que una vez
// aprobado se responda de manera automatica". Corre EXACTAMENTE la misma
// compuerta de calidad y el mismo envio que el camino auto — la unica
// diferencia es que la politica de conducta (horario, confianza, etc.) ya no
// aplica: un admin que dice "mandalo" es una decision humana, no necesita que
// politica.decidir lo confirme otra vez.
//
// Se recalcula publicable.filtrar/verificarLink con el estado ACTUAL del
// inventario, no con lo que se veia cuando llego el mensaje: si el sync se
// detuvo o la propiedad se vendio desde entonces, sigue sin publicarse.
async function aprobarManual(org, signalId) {
  const signal = await groupSignals.obtenerPorId(org.id, signalId);
  if (!signal) return { resultado: "no_encontrada" };
  if (signal.respondida_at) return { resultado: "ya_respondida" };
  if (signal.clase !== "demanda") return { resultado: "no_es_demanda" };

  const grupo = await whatsappGroups.obtenerGrupo(org.id, signal.group_id);
  if (!grupo) return { resultado: "grupo_no_encontrado" };
  // OJO: aca NO se exige grupo.responde=true (a diferencia del camino
  // automatico). Ese permiso existe para controlar la publicacion SIN
  // supervision — un grupo nuevo en modo escucha, sin nadie revisando. Una
  // aprobacion manual YA ES esa supervision: Natalia (o el admin) miro el
  // pedido y decidio. Exigir el mismo permiso aca habria obligado a Juan a
  // activar "responder" en cada grupo antes de poder aprobar nada — justo lo
  // que la norma del 2026-08-20 vino a evitar. Lo unico que sigue duro es que
  // el grupo se este escuchando de verdad (no "ignorar"): eso no es
  // supervision, es si el radar sigue prestando atencion a ese grupo.
  if (grupo.modo === "ignorar") return { resultado: "grupo_no_habilitado" };

  // BUG real (Juan, 2026-08-20): "aun no puedo enviar mensajes que el bot
  // callo". La causa: esto seguia exigiendo el mismo umbral de puntaje (70)
  // que el camino 100% automatico, asi que aprobar un pedido que se callo por
  // "puntaje_bajo" volvia a chocar con la MISMA razon — la aprobacion humana
  // no aprobaba nada. Un admin/asesor que ya miro el pedido y decide mandarlo
  // esta reemplazando esa confianza, no un dato de calidad — por eso el
  // umbral se apaga aca (umbral: 0) y NADA MAS: zona_no_publicable (nunca
  // publicar el barrio equivocado), no_es_inventario_propio (nunca la
  // propiedad de un aliado) y todos los motivos de dato corrupto (sin_ref,
  // sin_precio, precio_fuera_de_rango, sync_viejo, etc.) siguen exactamente
  // igual de duros — esos no son de confianza, son de seguridad y de dato.
  const inventario = await syncEstado.estadoDelInventario(org.id, {});
  const { publicables: candidatas, descartados } = publicable.filtrar(signal.matches || [], {
    syncFresco: inventario.fresco,
    umbral: 0,
  });
  const { verificadas: publicables, rotas } = await verificarLink.verificar(candidatas);
  for (const r of rotas) descartados.push({ ref: r.ref, motivos: ["link_no_abre"] });

  if (!publicables.length) return { resultado: "sin_propiedades_publicables", descartados };

  const texto = redactar.mensajeGrupo({ autor_nombre: signal.autor_nombre }, publicables);
  if (!texto) return { resultado: "sin_texto" };

  // Una sola sesion vinculada por org en este piloto (Juan, 2026-08-16): si
  // manana hay mas de una, esto se vuelve ambiguo a proposito — falla cerrado
  // en vez de adivinar por cual linea publicar.
  const sesiones = await whatsappGroups.listSessions(org.id);
  const activas = sesiones.filter((s) => s.estado === "activa");
  if (activas.length !== 1) return { resultado: "sesion_ambigua", cantidad: activas.length };

  // Citar el pedido original (ver la nota en waha.js#enviarTexto): en un
  // grupo activo ya se perdio en el scroll, y sin la cita el colega no se
  // entera de que le respondieron — es justo el problema que motivo la
  // aprobacion manual.
  const idOriginal = String(signal.wa_message_id || "").replace(/^vivo:/, "") || null;
  const envio = await waha.enviarTexto(activas[0].nombre, grupo.jid, texto, { replyTo: idOriginal });
  if (!envio || !envio.ok) return { resultado: "error_envio", error: envio && envio.error };

  const refs = publicables.map((m) => m.ref).filter(Boolean);
  await groupSignals.marcarRespondida(org.id, signal.id, { texto, wamid: envio.wamid, modo: "auto", refs });

  return { resultado: "publicado", texto, wamid: envio.wamid, publicables, grupo: grupo.nombre || grupo.jid };
}

// DM manual al colega, desde el CRM (Juan, 2026-08-24): "que pueda mandar el
// DM despues, no solo en el momento en que entro el pedido". El camino
// automatico (asistir, mas arriba) solo corre EN VIVO, cuando el mensaje
// acaba de llegar -- dos casos reales quedan sin cubrir: un pedido que entro
// cuando la org estaba en otro modo (sombra/auto, no asistido) y nunca se
// intento el DM, y un pedido que si se intento pero quedo fuera de la
// ventana de RADAR_DM_ANTIGUEDAD_MAX_MIN y un admin decide mandarlo igual.
//
// Mismo espiritu que aprobarManual, pero por DM en vez de publicacion en el
// grupo: se recalcula la compuerta de calidad con el estado ACTUAL del
// inventario (umbral:0 -- la aprobacion humana reemplaza esa confianza, no
// el dato) y las barreras de seguridad (zona_no_publicable,
// no_es_inventario_propio, sin_ref, sin_precio, sync_viejo, link_no_abre)
// siguen exactamente igual de duras: no son de confianza, son de seguridad.
//
// SELECCION MANUAL (Juan, 2026-08-24): "se fueron las 3 propiedades y solo
// una servía. No tuvo forma de elegir" — caso real, el primer DM manual que
// salio a produccion mando las 3 candidatas cuando el usuario solo queria
// una. `refs` (opcional) es la lista de refs que el panel del CRM marco: si
// viene, se cruza contra `signal.matches` (los matches REALES de esta señal)
// ANTES de la compuerta de calidad -- nunca se confia en lo que llega del
// request para armar el mensaje, porque cualquiera podria mandar la ref de
// otra propiedad. Sin `refs` (undefined/null), el comportamiento es
// exactamente el de antes: se manda TODO lo publicable. Una `refs` vacia
// ([]) es una seleccion explicita de "nada", no "sin preferencia" -- se
// respeta igual, y el resultado sale como sin_propiedades_publicables.
async function responderPorDmManual(org, signalId, { sesion = null, refs = null } = {}) {
  const signal = await groupSignals.obtenerPorId(org.id, signalId);
  if (!signal) return { resultado: "no_encontrada" };
  if (signal.respondida_at) return { resultado: "ya_respondida" };
  if (signal.clase !== "demanda") return { resultado: "no_es_demanda" };

  // El grupo se usa SOLO por su `jid`, para que directorio.telefonoDe pueda
  // refrescar la lista de participantes si el lid todavia no esta resuelto.
  // A diferencia de aprobarManual, aca NO se exige grupo.modo !== "ignorar":
  // esa compuerta protege que el radar siga ESCUCHANDO ese grupo, algo que
  // no tiene nada que ver con escribirle al privado a un colega que ya
  // publico su pedido -- si el grupo se dejo de escuchar despues, el DM
  // manual sigue siendo una decision valida sobre un pedido ya capturado.
  const grupo = await whatsappGroups.obtenerGrupo(org.id, signal.group_id).catch(() => null);

  // Filtro de seguridad ANTES de la compuerta de calidad: se recorta la lista
  // REAL de matches por las refs que el usuario elegio, nunca al reves. Una
  // ref que no aparece en `signal.matches` (typo, o alguien probando con la
  // ref de otra propiedad) simplemente no entra -- se ignora en silencio, no
  // se reporta como error, porque no es un dato roto, es una eleccion que no
  // aplica.
  const refsElegidas = Array.isArray(refs) ? new Set(refs.map((r) => String(r || "").trim()).filter(Boolean)) : null;
  const matchesDisponibles = signal.matches || [];
  const matchesAEvaluar = refsElegidas
    ? matchesDisponibles.filter((m) => m && refsElegidas.has(String(m.ref)))
    : matchesDisponibles;

  const inventario = await syncEstado.estadoDelInventario(org.id, {});
  const { publicables: candidatas, descartados } = publicable.filtrar(matchesAEvaluar, {
    syncFresco: inventario.fresco,
    umbral: 0,
  });
  const { verificadas: publicables, rotas } = await verificarLink.verificar(candidatas);
  for (const r of rotas) descartados.push({ ref: r.ref, motivos: ["link_no_abre"] });
  // `descartados` viaja SIEMPRE, tambien cuando si hay algo publicable: si el
  // usuario elige una propiedad que no pasa la compuerta (zona, precio, sync
  // viejo, etc), elegirla no la exime -- el resultado tiene que decirlo, no
  // fallar en silencio ni desaparecer la propiedad sin explicacion.
  if (!publicables.length) return { resultado: "sin_propiedades_publicables", descartados };

  const telefonoColega = await directorio
    .telefonoDe(org.id, signal.autor_telefono, { sesion, jid: grupo && grupo.jid })
    .catch((e) => {
      console.warn("[radar] No se pudo resolver el telefono del colega para el DM manual:", e.message);
      return null;
    });
  // Nunca se inventa un envio: sin telefono resuelto, el resultado lo dice
  // clarito para que el CRM lo muestre, en vez de quedarse en silencio.
  if (!telefonoColega) return { resultado: "sin_telefono" };

  if (!sesion) return { resultado: "sin_sesion" };

  // La salvedad de datos no confirmados (Juan, 2026-08-24) se reusa del
  // veredicto que Sofi YA dio para esta señal, si paso por modo asistido (ver
  // la nota en group-signals.js#obtenerPorId) -- no se vuelve a llamar a la
  // IA aca. Una señal que nunca paso por asistido no trae `revalidacion`, y
  // esto se degrada a "sin salvedad", igual que un mensaje redactado antes de
  // este cambio.
  const sinConfirmar = (signal.revalidacion && signal.revalidacion.sin_confirmar) || [];
  const leFalta = (signal.revalidacion && signal.revalidacion.le_falta) || [];
  const texto = redactar.mensajeGrupo({ autor_nombre: signal.autor_nombre }, publicables, {
    org,
    sinConfirmar,
    leFalta,
  });
  if (!texto) return { resultado: "sin_texto" };

  // LIMITES QUE SI SE RESPETAN (Juan, 2026-08-24): una vez por colega por dia
  // y el tope diario de la linea. Protegen al colega (spam) y a la linea (la
  // misma que ya fue baneada en julio de 2026, ver src/lib/waha.js) -- no son
  // una cuota de confianza, siguen firmes aunque decida un humano.
  //
  // NO se aplica el limite de antiguedad de politica.js#decidirDm (los 30 min
  // desde el mensaje del grupo): ese es EXACTAMENTE el freno que esta funcion
  // existe para saltar a conciencia -- "que un admin decida mandarlo igual"
  // (ver la nota de diseno arriba). Por eso no se llama a decidirDm (no tiene
  // como apagar solo esa pieza) y se replica aca a mano solo lo que SI sigue
  // protegiendo, con los mismos limites de politica.js#LIMITES_DM_DEFAULT.
  const desdeIso = new Date(Date.now() - VENTANA_LIMITE_HORAS * 3600 * 1000).toISOString();
  const [dmsColegaHoy, dmsLineaHoy] = await Promise.all([
    groupSignals.dmsHoyPorColega(org.id, signal.autor_telefono, desdeIso),
    groupSignals.dmsHoyLinea(org.id, desdeIso),
  ]);
  const limites = politica.LIMITES_DM_DEFAULT;
  if (dmsColegaHoy === null || dmsColegaHoy === undefined) return { resultado: "limite_colega_no_verificable" };
  if (dmsColegaHoy >= limites.dmsPorColegaDia) return { resultado: "limite_colega_alcanzado" };
  if (dmsLineaHoy === null || dmsLineaHoy === undefined) return { resultado: "limite_linea_no_verificable" };
  if (dmsLineaHoy >= limites.topeDiarioLinea) return { resultado: "limite_linea_alcanzado" };

  const envioDm = await waha.enviarDm(sesion, telefonoColega, texto).catch((e) => ({ ok: false, error: e.message }));
  if (!envioDm || !envioDm.ok) return { resultado: "error_envio", error: envioDm && envioDm.error };

  // Mismo modo 'auto' que usa el DM automatico (ver la nota en asistir, mas
  // arriba, y en group-signals.js#dmsHoyPorColega): en la columna
  // respuesta_modo 'auto' solo puede significar "salio por DM directo" o
  // "se publico en el grupo" -- las dos vias nunca coexisten para la misma
  // org (ver organizations.js#modoDeRespuesta), asi que reusarlo aca no
  // ambiguo nada, y evita otra migracion sobre el check existente.
  // Nombrado distinto del parametro `refs` de entrada (la seleccion del
  // usuario) a proposito: esto es lo que de verdad quedo dentro del mensaje
  // enviado, que puede ser un subconjunto de lo elegido si algo no paso la
  // compuerta (ver `descartados` mas abajo).
  const refsEnviadas = publicables.map((m) => m.ref).filter(Boolean);
  await groupSignals.marcarRespondida(org.id, signal.id, { texto, wamid: envioDm.wamid, modo: "auto", refs: refsEnviadas });
  // Distingue en la señal misma que esto lo mando una PERSONA desde el CRM
  // (auditoria 2026-09-02): respuesta_modo='auto' lo comparten el DM
  // automatico, este DM manual y la publicacion en el grupo de agosto, y el
  // dashboard los sumaba como "bot resolvio solo". El DM automatico deja
  // motivo 'ok'; este deja 'dm_manual'.
  await groupSignals
    .guardarPolitica(org.id, signal.id, { motivo: "dm_manual", traza: ["dm_manual", `refs:${refsEnviadas.join(",")}`] })
    .catch(() => {});

  return {
    resultado: "dm_enviado",
    texto,
    wamid: envioDm.wamid,
    telefono: telefonoColega,
    publicables,
    descartados,
  };
}

/**
 * Una oferta de colega en vivo: se cruza contra los mandatos activos Y contra
 * los leads propios que la estan esperando, y solo se persiste si le sirve a
 * alguna de las dos poblaciones.
 *
 * @returns { resultado, matches? }
 *   'oferta_sin_match' | 'oferta_cruzada'
 */
async function manejarOferta(org, c, grupo = {}, { advisorId = null, sesion = null, jid = null } = {}) {
  const activos = await mandatosData.listarActivos(org.id).catch((e) => {
    console.warn("[radar] no se pudieron leer los mandatos:", e.message);
    return [];
  });

  // Prueba baratísima antes de escribir nada: el shape del clasificador se
  // aproxima al de ally_properties solo para este tanteo. La evaluacion real,
  // con la fila persistida, la hace cruzarOfertaConMandatos.
  const tanteo = {
    tipo: c.tipo || null,
    operacion: c.operacion || null,
    zona: (Array.isArray(c.zonas) && c.zonas[0]) || c.zona || null,
    ciudad: c.ciudad || null,
    precio: c.precio_max || c.precio_min || 0,
    habitaciones: c.habitaciones || null,
    area: c.area_min || null,
    banos: c.banos || null,
    garajes: c.garajes || null,
    estrato: c.estrato || null,
  };
  const sirveAAlguno = activos.some((m) => {
    const e = evaluarOferta(tanteo, m);
    return Boolean(e && e.sirve);
  });

  // Segunda poblacion a la que le puede servir esta oferta, ademas de los
  // mandatos curados: los leads propios del embudo esperando exactamente esto.
  // Reconectado 2026-08-25 (Juan): este cruce (cruce-leads.js) corrio en
  // produccion del 2026-08-18 al 2026-08-20 y quedo huerfano cuando se apago
  // el procesamiento de ofertas por saturacion -- la saturacion la causaba
  // GUARDAR todo, no cruzarlo, asi que restaurar el cruce (con el mismo gate
  // de persistencia que ya protege del volumen) no reintroduce el problema.
  // Sondeo barato (limit 1): solo interesa saber si hay AL MENOS un candidato,
  // no la lista completa -- eso lo resuelve cruzarOfertaConLeads mas abajo,
  // ya con la fila persistida y su id real para el dedup.
  const leadsCandidatos = await command
    .leadsParaPropiedad({ orgId: org.id, viewerUid: null, isAdmin: true }, tanteo, 1)
    .catch((e) => {
      console.warn("[radar] no se pudieron leer los leads para el tanteo:", e.message);
      return [];
    });
  const sirveAUnLead = leadsCandidatos.length > 0;

  if (!sirveAAlguno && !sirveAUnLead) return { resultado: "oferta_sin_match" };

  const fila = await ofertas
    .guardarOferta(org, {
      ...c,
      mensaje: { ...(c.mensaje || {}), groupId: (grupo && grupo.id) || null, advisorId },
    })
    .catch((e) => {
      console.warn("[radar] no se pudo guardar la oferta que cruzo:", e.message);
      return null;
    });
  if (!fila || !fila.id) return { resultado: "oferta_sin_match" };

  const rMandatos = sirveAAlguno
    ? await avisarMandato.cruzarOfertaConMandatos(org, { ...tanteo, ...fila }, {
        allyPropertyId: fila.id,
        colega: { lid: c.mensaje?.autorTelefono || null, nombre: c.mensaje?.autor || null },
        grupo: grupo?.nombre || null,
        vistoEnIso: new Date().toISOString(),
        sesion, jid,
      })
    : { matches: 0, avisados: [] };

  // Igual que las demas llamadas de I/O de esta funcion (listarActivos,
  // leadsParaPropiedad, guardarOferta): degrada en vez de reventar. Sin este
  // .catch, un problema en el cruce contra leads (RLS, red, algo en
  // ally_property_alerts) tumbaba toda la funcion y se perdia el cruce contra
  // mandatos que ya habia corrido bien.
  const rLeads = await cruceLeads.cruzarOfertaConLeads(org, fila).catch((e) => {
    console.warn("[radar] no se pudo cruzar la oferta contra los leads propios:", e.message);
    return { avisados: [] };
  });

  return {
    resultado: "oferta_cruzada",
    matches: rMandatos.matches,
    avisados: rMandatos.avisados.length,
    leadsAvisados: rLeads.avisados.length,
  };
}

module.exports = {
  procesarMensaje, idEnVivo, asistir, destinatarios, aprobarManual, responderPorDmManual,
  manejarOferta, VENTANA_LIMITE_HORAS,
};

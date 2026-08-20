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
const { guardarOferta } = require("./ofertas");
const { cruzarOfertaConLeads } = require("./cruce-leads");
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
const waha = require("../lib/waha");
// Se importa el MODULO y no la funcion suelta: destructurar congela la
// referencia y deja los tests sin forma de mockear el envio.
const canalWhatsapp = require("../channels/whatsapp");
const mensajeAsesor = require("../lib/mensaje-asesor");

const VENTANA_LIMITE_HORAS = 24;

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
 *
 * Devuelve siempre un objeto con `resultado`, para poder medir la corrida sin
 * leer logs. Nunca lanza por un mensaje suelto: un error en uno no puede tumbar
 * la escucha del grupo.
 */
async function procesarMensaje(org, mensaje, { grupo, modo = "sombra", enviar = null, asesor = null, advisorId = null, ahora = new Date() } = {}) {
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

  // 3. Cruce contra inventario propio y aliados.
  const { demandas, ofertas } = await cruzar([c], { org });
  const señal = demandas[0] || ofertas[0];
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

  // Las ofertas alimentan la red de aliados y no se responden nunca: contestarle
  // a un colega que publica su propiedad no tiene sentido comercial. Lo que SI
  // puede pasar es que un lead propio la este esperando — ese cruce es puro
  // (base de datos, cero tokens) y no puede tumbar el resultado "oferta" si
  // falla, por eso va atajado aparte.
  if (c.clase === "oferta") {
    if (señal.utilizable) {
      const allyProperty = await guardarOferta(org, señal, { vistoEn: mensaje.instanteIso });
      await cruzarOfertaConLeads(org, allyProperty).catch((e) =>
        console.warn("[radar] No se pudo cruzar la oferta contra leads propios:", e.message)
      );
    }
    return { resultado: "oferta", signalId: signal && signal.id };
  }

  // MODO ASISTIDO: no se publica NADA en el grupo. Sofi revalida las candidatas
  // y, si aprueba, le escribe a la asesora. Es el paso previo a encender las
  // respuestas: sirve para calibrar el motor sin exponer la marca.
  if (modo === "asistido") {
    return asistir(org, c, señal, signal, { mensaje, grupo, asesor, ahora });
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
    senal: { clase: c.clase, confianza: c.confianza, respondida_at: signal && signal.respondida_at },
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
    return { resultado: "callado", motivo: decision.motivo, traza: decision.traza, descartados, signalId: signal && signal.id };
  }

  // Mensaje "blanqueado" (Juan, 2026-08-18): sin asesor, a proposito — ver
  // la nota de diseño en redactar.js.
  const texto = redactar.mensajeGrupo({ autor_nombre: mensaje.autor }, publicables);
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

// Sofi da su veredicto y, si aprueba, le avisa a la asesora.
//
// Sofi ve TODAS las candidatas, tambien las de puntaje bajo: es la unica forma
// de descubrir que el umbral esta dejando pasar oportunidades buenas. Los falsos
// negativos son invisibles por definicion y son los caros.
//
// Quien decide si se avisa es Sofi, no el puntaje. El veredicto se guarda
// SIEMPRE —aunque diga que no sirve— porque el "no" tambien ensena.
async function asistir(org, c, señal, signal, { mensaje, grupo, asesor, ahora }) {
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

  const texto = alertaAsesor.construir(
    {
      grupo_nombre: grupo.nombre || grupo.jid,
      autor_nombre: mensaje.autor,
      autor_telefono: mensaje.autorTelefono,
      texto_original: mensaje.texto,
    },
    veredicto,
    matches
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
  for (const to of destinos) {
    const r = to === telefonoPrincipal
      ? await mensajeAsesor.enviarYRegistrar(org, to, texto).catch((e) => ({ ok: false, error: e.message }))
      : await canalWhatsapp.sendWhatsApp(org, to, texto).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) {
      alguno = true;
      if (to === telefonoPrincipal) wamidPrincipal = r.wamid || null;
    } else {
      console.warn(`[radar] No se pudo avisar a ${to}: ${r && r.error}`);
    }
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
  if (grupo.responde !== true) return { resultado: "grupo_no_habilitado" };

  const inventario = await syncEstado.estadoDelInventario(org.id, {});
  const { publicables: candidatas, descartados } = publicable.filtrar(signal.matches || [], {
    syncFresco: inventario.fresco,
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

module.exports = { procesarMensaje, idEnVivo, asistir, destinatarios, aprobarManual, VENTANA_LIMITE_HORAS };

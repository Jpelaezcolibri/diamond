const config = require("../config");
const leads = require("../data/leads");
const conversations = require("../data/conversations");
const properties = require("../data/properties");
const advisors = require("../data/advisors");
const directorio = require("../groups/directorio");
const groupSignals = require("../data/group-signals");
const { buildSystemPrompt } = require("./prompts");
const { TOOL_DEFINITIONS, executeTool, maybeCaptadorAlert } = require("./tools");
const { isQualified } = require("./qualification");
const { buildAdvisorAlert, formatCitaFechaHora } = require("../notifications/advisor");
const { detectSellerIntent, detectClientLanguage } = require("./intent");
const { getClient } = require("../lib/anthropic");

const MAX_TOOL_ITERATIONS = 5;
const HISTORY_LIMIT = 12;

// Fecha y hora actual en Colombia, legible + ISO, para que Sofi resuelva
// referencias relativas ("manana a las 8") a una fecha concreta al agendar.
function nowInBogota() {
  const tz = "America/Bogota";
  const d = new Date();
  const legible = d.toLocaleString("es-CO", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Offset fijo de Colombia (-05:00, sin horario de verano) para el ISO.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const iso = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}-05:00`;
  return { legible, iso };
}
// Referencias: codigo Wasi de 6-8 digitos (ej 9702941) o formato legacy AA000
const REF_PATTERN = /\b([A-Z]{2}\d{3}|\d{6,8})\b/;

// Procesa un mensaje entrante de cualquier canal.
// adReferral: objeto "referral" que WhatsApp Cloud API adjunta al PRIMER
// mensaje cuando la conversacion se origino en un anuncio de clic-a-WhatsApp
// (Click-to-WhatsApp Ads) — permite separar en el CRM los leads que llegaron
// por un anuncio pago de los organicos, sin tocar `source` (canal).
// Devuelve { reply, lead, transfer } — transfer: { motivo, advisorAlert } si aplico.
async function procesarMensaje({ org, phone, text, source = "whatsapp", messageExtras = {}, phoneNumberId = null, adReferral = null, radarSignalId = null }) {
  const client = getClient();

  // ¿Escribe un asesor de la casa? Se resuelve ANTES de tocar el lead: casi
  // todo lo que sigue (calificacion, categoria, alerta al captador, intencion
  // de venta) solo tiene sentido con un cliente enfrente. Aplicarselo a un
  // asesor deja un lead falso en el embudo y hace que Sofi le hable como si
  // hubiera visto un anuncio.
  const advisor = await advisors.findByPhone(org.id, phone).catch((e) => {
    // Falla ABIERTA: si la consulta revienta se lo atiende como cliente, que es
    // el comportamiento de siempre. Quedarse mudo con un cliente real por no
    // poder descartar que sea asesor seria mucho peor.
    console.warn("[engine] No se pudo verificar si el telefono es de un asesor:", e.message);
    return null;
  });

  // ¿Y si no es de la casa, es un colega de otra inmobiliaria? Se resuelve
  // contra el directorio de los grupos gremiales (src/groups/directorio.js).
  //
  // Solo se pregunta si NO hay asesor: un asesor propio que ademas esta en un
  // grupo sigue siendo de la casa, y asi no se paga la consulta de mas.
  //
  // Falla ABIERTA, igual que la del asesor: si revienta se lo atiende como
  // cliente, que es el comportamiento de siempre.
  const colega = advisor ? null : await directorio.esColega(org.id, phone).catch((e) => {
    console.warn("[engine] No se pudo verificar si el telefono es de un colega:", e.message);
    return null;
  });

  const fuenteLead = advisor ? "asesor" : colega ? "colega" : source;
  const lead = await leads.findOrCreate(org.id, phone, fuenteLead);
  // Un asesor o un colega que ya tenia lead de antes (escribio a Sofi antes de
  // que existiera esta rama) queda marcado, para que el embudo no lo cuente.
  if ((advisor || colega) && lead.source !== fuenteLead) {
    try {
      Object.assign(lead, await leads.update(lead.id, { source: fuenteLead }));
    } catch (e) {
      console.warn(`[engine] No se pudo marcar el lead como ${fuenteLead}:`, e.message);
    }
  }

  // Todo este bloque describe a un CLIENTE: de que anuncio vino, en que idioma
  // habla, por donde va en el kanban. Un asesor no tiene nada de eso, y
  // aplicarselo lo mete en el embudo como si fuera una oportunidad de venta.
  //
  // Un COLEGA (par de otra inmobiliaria) TAMPOCO es un cliente, pero no es
  // identico al asesor: hasta el 2026-08-24 este bloque entero corria igual
  // para un colega, porque solo se blindo "asesor" cuando se escribio (ver el
  // comentario de arriba). Efecto real: un colega quedaba con property_ref_
  // origen/ad_referral (arranca un aviso al captador como si fuera un cliente
  // interesado, ver maybeCaptadorAlert mas abajo), pasaba de "nuevo" a
  // "en_conversacion" en EL kanban de leads, y su categoria de tablero se
  // fijaba como compra/alquiler — todo eso es exactamente "entrar al embudo
  // como oportunidad de venta", lo que promptColega dice explicitamente que
  // NO es. Por eso cada pieza de aca abajo se decide por separado, no con un
  // solo `&& !colega` a la entrada del bloque:
  //   - idioma: SI aplica a un colega. Es un dato neutro (como le contesta
  //     Sofi, no que es) y no lo mete en ningun tablero.
  //   - ref de origen / ad_referral / transicion de estado / categoria: NO
  //     aplican. Son literalmente los campos que arman al lead como
  //     oportunidad comercial — origen de anuncio, kanban, tablero — y un
  //     colega no tiene ads ni oportunidad propia, tiene un cliente de OTRA
  //     inmobiliaria.
  if (!advisor) {
  // Idioma del cliente (o colega), estampado UNA vez. El prellenado EN de la
  // landing es señal fuerte en cualquier turno; la heuristica organica solo
  // aplica al PRIMER mensaje (alguien que escribe en español y pega un
  // anuncio en ingles despues no debe voltear la conversacion). Best-effort:
  // sin la columna (migracion 2026-07-24_lead_idioma pendiente) queda en
  // memoria para este turno.
  if (!lead.idioma) {
    const idioma = detectClientLanguage(text);
    const esPrellenado = idioma === "en" && /^hi\b/i.test(text.trim());
    if (idioma && (lead._isNew || esPrellenado)) {
      lead.idioma = idioma;
      try {
        Object.assign(lead, await leads.update(lead.id, { idioma }));
      } catch (e) {
        console.warn("[engine] No se pudo persistir idioma (revisar migracion lead_idioma):", e.message);
      }
    }
  }
  // De aca para abajo, EXCLUSIVO de un cliente final (ver el razonamiento
  // arriba): origen de anuncio, kanban, categoria de tablero. Un colega
  // nunca pasa por esto.
  if (!colega) {
  // Deep link / click-to-WhatsApp: la primera mencion de una ref queda como origen
  const refMatch = text.toUpperCase().match(REF_PATTERN);
  if (refMatch && !lead.property_ref_origen) {
    Object.assign(lead, await leads.update(lead.id, { property_ref_origen: refMatch[1] }));
  }
  // Igual que arriba: solo se guarda del PRIMER mensaje que lo trae (el
  // origen del lead no cambia si mas adelante escribe mencionando otro anuncio).
  if (adReferral && !lead.ad_referral) {
    Object.assign(lead, await leads.update(lead.id, { ad_referral: adReferral }));
  }
  // Un lead recien creado entra al kanban en "nuevo"; pasa a "en_conversacion"
  // cuando vuelve a escribir (segunda interaccion en adelante)
  if (!lead._isNew && lead.estado === "nuevo") {
    Object.assign(lead, await leads.update(lead.id, { estado: "en_conversacion" }));
  }
  }
  }

  const conv = await conversations.findOrCreate(org.id, lead.id, phoneNumberId);
  await conversations.appendMessage(conv.id, "user", text, messageExtras);

  // Conversacion tomada por un asesor desde el CRM: guardar el mensaje y callar a Sofi
  if (conv.modo === "humano") {
    return { reply: null, lead, transfer: null, assistantMessageId: null };
  }

  const history = await conversations.getRecentMessages(conv.id, HISTORY_LIMIT);
  const messages = history.map((m) => ({ role: m.role, content: m.content }));

  // Intencion de VENTA detectada de forma deterministica sobre TODO el historial
  // reciente del cliente (no solo el mensaje actual): la declaracion "quiero
  // vender" puede venir en un turno anterior y la transferencia en otro. Al
  // re-derivarla del historial, el encuadre correcto (link + alerta al asesor)
  // se mantiene aunque la columna `intencion` aun no exista para persistirla.
  // Piso de confiabilidad: no depende de que el modelo registre la intencion.
  // Un asesor diciendo "tengo un cliente que quiere vender" no es un
  // propietario declarando que vende: marcarlo dispararia el encuadre de
  // captacion y una alerta a otro asesor por un negocio que no existe.
  //
  // Lo mismo para un colega (blindaje extendido 2026-08-24): "tengo un
  // cliente que quiere vender" en boca de un colega de OTRA inmobiliaria es
  // todavia menos un propietario declarando que vende — es un negocio de un
  // tercero, del que ni siquiera sabemos el nombre. Este caso se blindo antes
  // solo para el asesor porque el colega como rol no existia todavia; el
  // riesgo es identico.
  if (!advisor && !colega && lead.intencion !== "vender") {
    const clienteDijoVender = history.some((m) => m.role === "user" && detectSellerIntent(m.content));
    if (clienteDijoVender) {
      lead.intencion = "vender";
      try {
        Object.assign(lead, await leads.update(lead.id, { intencion: "vender" }));
      } catch {
        // Columna aun no existe (migracion pendiente): queda en memoria, suficiente
        // para este turno; se re-detecta del historial en los siguientes.
      }
    }
  }

  const ctx = {
    org, lead, advisor,
    // Para que las tools (ver src/agent/tools.js) puedan distinguir a un
    // colega de un cliente final sin volver a consultar el directorio. Ej:
    // maybeCaptadorAlert lo usa para no mandarle a un asesor un aviso de
    // "cliente interesado" cuando en realidad es un colega buscando para el
    // suyo (Juan, 2026-08-24 — ver el comentario de esa funcion).
    colega,
    propertyInteres: null, transfer: null, cita: null, allyMatch: null, allyAlert: null,
    appointmentAlert: null, captadorAlert: null, lastUserMessage: text,
    // Solo tiene sentido con un asesor citando el aviso de un pedido del
    // radar; con un cliente esto siempre viene null y no se usa.
    radarSignalId,
  };
  // Este bloque solo tiene sentido con property_ref_origen, que un colega ya
  // no puede tener (ver el bloque de arriba) — el !colega es defensivo, para
  // un colega con lead viejo de antes de este blindaje que ya traia ese campo
  // seteado.
  if (!advisor && !colega && lead.property_ref_origen) {
    const origen = await properties.findByRef(org, lead.property_ref_origen);
    if (origen?.disponible) {
      ctx.propertyInteres = origen;
      // El lead entro por el ad de una propiedad marcada: avisar al captador.
      await maybeCaptadorAlert(ctx, origen);
    }
    // La propiedad de origen define el tablero del lead (compra/alquiler)
    if (origen && (!lead.categoria || lead.categoria === "otros")) {
      const categoria = (origen.operacion || "").toLowerCase() === "arriendo" ? "alquiler" : "compra";
      Object.assign(lead, await leads.update(lead.id, { categoria }));
    }
  }

  // Que le respondimos la ultima vez a este colega (auditoria 2026-09-02):
  // solo si ES un colega, y best-effort — si la consulta falla, Sofi lo
  // atiende igual, solo que sin el contexto.
  const ultimoPedido = colega
    ? await groupSignals.buscarPorTelefono(org.id, phone).catch((e) => {
        console.warn("[engine] No se pudo traer el ultimo pedido del colega:", e.message);
        return null;
      })
    : null;

  // Quien coordina las visitas del gremio, para que Sofi pueda pasarle el
  // contacto al colega al confirmarle una cita (Juan, 2026-09-04: "el mensaje
  // de confirmación que le llega al colega debe de ir con el contacto... con
  // su numero celular"). Se resuelve aca y NO se hardcodea en el prompt: es
  // un dato del tenant. Es la misma persona a la que le llega el aviso de la
  // cita (ver resolveLeadAdvisor en tools.js), asi que el colega y el asesor
  // no pueden quedar apuntando a numeros distintos. Best-effort: si falla,
  // Sofi confirma la cita sin contacto en vez de inventarlo.
  const coordinador = colega
    ? await advisors
        .findAsesorPrincipalRadar(org)
        .then((a) => (a ? { nombre: a.name, telefono: a.phone } : null))
        .catch((e) => {
          console.warn("[engine] No se pudo resolver quien coordina las visitas del colega:", e.message);
          return null;
        })
    : null;

  const system = buildSystemPrompt({
    org, lead, qualified: isQualified(lead), now: nowInBogota(), advisor, colega, ultimoPedido, coordinador,
  });

  const extractText = (r) =>
    r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

  let response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 2048,
    system,
    messages,
    tools: TOOL_DEFINITIONS,
  });

  // Claude puede escribir texto conversacional EN EL MISMO turno en que llama
  // una tool (ej. agradecer a un aliado no depende del resultado de guardarlo)
  // — ese texto se acumula aqui por cada turno, en vez de leerse solo de la
  // ultima respuesta del loop, para no perderlo (bug real 2026-07-06: Sofi
  // quedaba en blanco al reconocer una propiedad de aliado).
  const textParts = [];
  let iterations = 0;
  while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    const text = extractText(response);
    if (text) textParts.push(text);

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        result = await executeTool(block.name, block.input, ctx);
      } catch (e) {
        console.error(`[engine] Error en tool ${block.name}:`, e.message);
        result = `Error ejecutando la herramienta: ${e.message}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 2048,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    });
  }

  const finalText = extractText(response);
  if (finalText) textParts.push(finalText);
  let reply = textParts.join("\n").trim();

  if (!reply && response.stop_reason !== "tool_use") {
    // Respuesta vacia transitoria (sin texto en ningun turno): reintentar una
    // vez antes de rendirse.
    console.warn("[engine] Respuesta vacia del modelo — reintentando");
    response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 2048,
      system,
      messages,
      tools: TOOL_DEFINITIONS,
    });
    reply = extractText(response);
  }
  reply = reply || "Disculpa, no pude procesar tu mensaje. ¿Puedes intentarlo de nuevo? 🙏";

  const assistantMsg = await conversations.appendMessage(conv.id, "assistant", reply);

  let transfer = null;
  if (ctx.transfer) {
    Object.assign(lead, await leads.update(lead.id, { estado: "transferido" }));
    const advisor = ctx.transfer.advisor;
    const transferidoAt = new Date().toISOString();
    // Registro de a quien y cuando se transfirio. Best-effort: si las columnas
    // aun no existen (migracion 2026-07-23_lead_transferencia pendiente), la
    // transferencia sigue funcionando igual que antes.
    try {
      Object.assign(
        lead,
        await leads.update(lead.id, {
          transferido_advisor_id: advisor.id || null,
          transferido_a_nombre: advisor.name,
          transferido_at: transferidoAt,
        })
      );
    } catch (e) {
      console.warn("[engine] No se pudo persistir la transferencia (revisar migracion lead_transferencia):", e.message);
    }
    // Nota de sistema en el historial de la conversacion — queda guardada en
    // Sofi y visible en el CRM. Best-effort: requiere el role 'system' de la
    // misma migracion.
    try {
      const en = formatCitaFechaHora(transferidoAt);
      const nota = en
        ? `Transferido a ${advisor.name} — ${en.fecha}, ${en.hora}`
        : `Transferido a ${advisor.name}`;
      await conversations.appendMessage(conv.id, "system", nota);
    } catch (e) {
      console.warn("[engine] No se pudo guardar la nota de transferencia (revisar migracion lead_transferencia):", e.message);
    }
    transfer = {
      motivo: ctx.transfer.motivo,
      especialidad: ctx.transfer.especialidad,
      advisorName: advisor.name,
      advisorPhone: advisor.phone,
      advisorAlert: buildAdvisorAlert(org, lead, ctx.transfer.motivo, ctx.propertyInteres, ctx.transfer.especialidad, ctx.cita, ctx.allyMatch),
      // Para poder dejar constancia EN LA MISMA conversacion si el aviso al
      // asesor falla (Juan, 2026-08-20 — ver whatsapp.js). Antes el envio se
      // disparaba y su resultado se descartaba: un fallo (ej. la ventana de
      // 24h de Meta cerrada, porque este es texto libre, no una plantilla) no
      // dejaba ningun rastro, ni en el chat ni en ningun lado — se veia
      // identico a un exito.
      conversationId: conv.id,
    };
  }

  // Aviso inmediato al asesor dueno de una propiedad de colega que hizo match
  // con este cliente — independiente de transfer: no espera a que el lead
  // se transfiera o califique (ver ctx.allyAlert en tools.js).
  const allyAlert = ctx.allyAlert || null;

  // Aviso inmediato al asesor cuando se le confirma una cita con dia/hora
  // validados contra su agenda — independiente de transfer (ver agendar_cita).
  const appointmentAlert = ctx.appointmentAlert || null;

  // Aviso inmediato al asesor CAPTADOR de una propiedad propia cuando este
  // cliente mostro interes en ella — independiente de transfer (ver
  // maybeCaptadorAlert en tools.js).
  const captadorAlert = ctx.captadorAlert || null;

  return { reply, lead, transfer, allyAlert, appointmentAlert, captadorAlert, assistantMessageId: assistantMsg?.id || null };
}

module.exports = { procesarMensaje };

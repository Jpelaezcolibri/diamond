// Motor de Sofi-Comando (Centro de Comando interno). Reutiliza el patron de
// loop tool-use de src/agent/engine.js, pero DESACOPLADO de procesarMensaje
// (que esta atado al ciclo lead/calificacion/transferencia). Aqui el
// interlocutor es un asesor/admin.
//
// El briefing (EXP-001) y el cierre (EXP-006) se arman de forma DETERMINISTA
// (renderBriefing/renderClose) a partir de la salida de las funciones de
// consulta — sin pasar por el modelo. El LLM solo se usa en processMessage
// (conversacion de seguimiento y siguiente mejor accion, EXP-013).
const config = require("../config");
const command = require("../data/command");
const { buildCommandSystemPrompt } = require("./sofi-comando-prompts");
const { COMMAND_TOOL_DEFINITIONS, executeCommandTool } = require("./sofi-comando-tools");
const { getClient } = require("../lib/anthropic");

// 8, no 5: encontrado en produccion 2026-08-18 — Juan le pidio a Sofi mandarle
// un WhatsApp a Catherine por cada uno de 6 pedidos pendientes (una tool por
// mensaje) y se quedo sin iteraciones a mitad de camino. Con el limite viejo,
// el ultimo turno del loop terminaba en un tool_use sin texto -> reply vacio
// -> caia en el fallback generico "No pude procesar eso", sin decir que
// habia mandado 5 de 6 ni que quedaba uno. Ver el fallback mas abajo para la
// otra mitad del arreglo: aunque el limite se suba, sigue siendo finito.
const MAX_TOOL_ITERATIONS = 8;
const HISTORY_LIMIT = 12;

// TODO(reuse): nowInBogota vive tambien en src/agent/engine.js; no se exporta
// desde alli para no cambiar el contrato de ese modulo. Duplicacion minima
// aceptada; unificar en un util comun si aparece un tercer uso.
function nowInBogota() {
  const tz = "America/Bogota";
  const d = new Date();
  const legible = d.toLocaleString("es-CO", {
    timeZone: tz, weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return { legible };
}

function horaBogota(iso) {
  try {
    return new Date(iso).toLocaleTimeString("es-CO", {
      timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// Compara el DIA calendario (Bogota) de un ISO contra el de ahora mismo.
//
// `command_sessions` no se cierra sola: "Cerrar el dia" es un boton manual, y
// sin ese clic la sesion sigue "abierta" indefinidamente (verificado en
// produccion 2026-08-18: tres sesiones open desde julio, con el ultimo
// mensaje de hace dias o semanas). openSession() la necesita para saber si el
// ultimo mensaje de la sesion YA es el briefing de hoy, no solo si la sesion
// tiene algun mensaje en su historia.
function esDeHoyBogota(iso) {
  if (!iso) return false;
  const dia = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
  return dia(new Date(iso)) === dia(new Date());
}

function nombreDe(item) {
  return item.nombre || (item.phone ? `+${item.phone}` : "un cliente");
}

// La API de Anthropic exige que los mensajes empiecen en rol "user" y alternen
// user/assistant. El historial del comando puede empezar con el briefing
// (assistant) o traer dos assistant seguidos (una respuesta + el resumen de
// cierre), o quedar recortado por HISTORY_LIMIT empezando en un assistant — todos
// darian 400. Esto normaliza: descarta assistants iniciales y fusiona turnos
// consecutivos del mismo rol.
function toApiMessages(history) {
  const out = [];
  for (const m of history) {
    if (!out.length && m.role === "assistant") continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n${m.content}`;
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

// ── Ensamblador determinista del briefing (EXP-001) ───────────────────────
function renderBriefing({ userName, metrics, follow, seed, recordatorios }) {
  const saludo = `Buenos dias${userName ? `, ${userName}` : ""}.`;
  const lineas = [];

  const items = (follow && follow.items) || [];
  const citas = items.filter((i) => i.motivo === "cita");
  const calientes = items.filter((i) => i.motivo === "sin_actividad" && (i.score || 0) >= 70);
  const otros = items.filter((i) => i.motivo === "sin_actividad" && (i.score || 0) < 70);

  if (Array.isArray(seed) && seed.length) {
    const nombres = seed.slice(0, 3).map(nombreDe).join(", ");
    lineas.push(`Ayer quedaron ${seed.length} pendiente(s) para hoy: ${nombres}.`);
  }

  // Recordatorios personales (crear_recordatorio) vencidos o de hoy — nunca
  // se mezclan con los de otro asesor, ya vienen filtrados por user_id.
  if (Array.isArray(recordatorios) && recordatorios.length) {
    const detalle = recordatorios.slice(0, 3).map((r) => r.descripcion).join("; ");
    lineas.push(`Tienes ${recordatorios.length} recordatorio(s) tuyo(s) para hoy: ${detalle}.`);
  }

  if (citas.length) {
    const detalle = citas
      .slice(0, 3)
      .map((c) => `${nombreDe(c)}${c.cita_fecha ? ` a las ${horaBogota(c.cita_fecha)}` : ""}`)
      .join(", ");
    lineas.push(`Hoy tienes ${citas.length} cita(s): ${detalle}.`);
  }

  if (calientes.length) {
    const c = calientes[0];
    const dias = c.dias_inactivo != null ? `${c.dias_inactivo} dias` : "varios dias";
    lineas.push(`Ojo: ${nombreDe(c)} esta caliente y lleva ${dias} sin respuesta${calientes.length > 1 ? ` (y ${calientes.length - 1} mas)` : ""}.`);
  }

  const nuevos = (metrics && metrics.nuevos) || 0;
  if (nuevos > 0) {
    const fuentes = metrics.por_fuente || {};
    const detalleFuente = Object.keys(fuentes).length
      ? ` (${Object.entries(fuentes).map(([k, v]) => `${v} de ${k}`).join(", ")})`
      : "";
    lineas.push(`Llegaron ${nuevos} lead(s) nuevo(s)${detalleFuente}.`);
  }

  if (!lineas.length) {
    lineas.push("Hoy no tienes pendientes urgentes ni leads nuevos. Buen momento para retomar clientes en frio.");
  }

  // Propone por donde arrancar.
  const primero = citas[0] || calientes[0] || otros[0] || null;
  const cierre = primero
    ? `¿Arrancamos por ${nombreDe(primero)}?`
    : "¿En que te ayudo?";

  return `${saludo}\n${lineas.join("\n")}\n${cierre}`;
}

// Briefing degradado: cuando no se pudieron cargar los datos (Supabase caido o
// RPC no disponible), la sesion igual se abre y el chat sigue usable en vez de
// romper la pantalla con un 500.
function renderBriefingFallback({ userName }) {
  return `Buenos dias${userName ? `, ${userName}` : ""}.\nNo pude cargar tus datos en este momento. Puedes preguntarme de nuevo en un momento o hacerme una consulta puntual.`;
}

// ── Cola de manana (siembra de EXP-006) ───────────────────────────────────
function buildTomorrowQueue(follow) {
  const items = (follow && follow.items) || [];
  return items.slice(0, 10).map((i) => ({
    lead_id: i.lead_id,
    nombre: i.nombre || null,
    phone: i.phone || null,
    motivo: i.motivo,
  }));
}

// ── Ensamblador determinista del cierre (EXP-006) ─────────────────────────
function renderClose({ userName, metrics, follow, tomorrowQueue }) {
  const partes = [];
  partes.push(`Buen dia hoy${userName ? `, ${userName}` : ""}.`);

  const nuevos = (metrics && metrics.nuevos) || 0;
  const pendientes = (tomorrowQueue && tomorrowQueue.length) || 0;
  const resumen = [];
  if (nuevos > 0) resumen.push(`${nuevos} lead(s) nuevo(s)`);
  if (follow && follow.total) resumen.push(`${follow.total} en seguimiento`);
  if (resumen.length) partes.push(`Resumen del dia: ${resumen.join(", ")}.`);

  if (pendientes > 0) {
    const nombres = tomorrowQueue.slice(0, 3).map(nombreDe).join(", ");
    partes.push(`Te dejo ${pendientes} pendiente(s) de primeros para manana: ${nombres}.`);
  } else {
    partes.push("No quedan pendientes abiertos. Descansa.");
  }

  return partes.join("\n");
}

// ── Orquestacion ──────────────────────────────────────────────────────────

// Abre (o retoma) la sesion del dia y garantiza que el briefing sea el primer
// mensaje. Devuelve { sessionId, messages }.
async function openSession(scope, { userName } = {}) {
  const session = await command.ensureSession(scope);
  const sessionMessages = await command.getRecentCommandMessages(session.id, 1);
  const ultimoEsDeHoy = sessionMessages[0] && esDeHoyBogota(sessionMessages[0].created_at);

  if (!ultimoEsDeHoy) {
    let briefing;
    try {
      const [metrics, follow, seed, recordatorios] = await Promise.all([
        command.metricasLeads(scope, {}),
        command.seguimientos(scope, { dias: 3 }),
        command.lastClosedTomorrowQueue(scope),
        command.recordatoriosPendientes(scope, { incluirFuturos: false }),
      ]);
      briefing = renderBriefing({ userName, metrics, follow, seed, recordatorios });
    } catch (e) {
      console.error("[sofi-comando] briefing degradado:", e.message);
      briefing = renderBriefingFallback({ userName });
    }
    await command.appendCommandMessage(session.id, "assistant", briefing);
  }

  // El chat del CRM muestra el historial CONTINUO del usuario (todas sus
  // sesiones): hoy + ayer al abrir; lo anterior se pagina con /history.
  const { messages, hasMore } = await command.getUserCommandMessages(scope);
  return { sessionId: session.id, messages, hasMore };
}

// Pagina hacia atras el historial del usuario (scroll-up tipo WhatsApp).
async function historyPage(scope, { before }) {
  return command.getUserCommandMessages(scope, { before });
}

// Turno de chat: corre el loop tool-use con las tools de comando. Devuelve
// { reply }.
async function processMessage(scope, sessionId, text, { userName } = {}) {
  const client = getClient();
  await command.appendCommandMessage(sessionId, "user", text);
  const session = await command.getSession(sessionId);
  const history = await command.getRecentCommandMessages(sessionId, HISTORY_LIMIT);
  const messages = toApiMessages(history);

  const system = buildCommandSystemPrompt({ scope, userName, now: nowInBogota() });
  const ctx = { scope, session };

  const extractText = (r) =>
    r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();

  let response = await client.messages.create({
    model: config.claudeModel,
    max_tokens: 1024,
    system,
    messages,
    tools: COMMAND_TOOL_DEFINITIONS,
  });

  const textParts = [];
  let iterations = 0;
  while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    const t = extractText(response);
    if (t) textParts.push(t);

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      let result;
      try {
        result = await executeCommandTool(block.name, block.input, ctx);
      } catch (e) {
        console.error(`[sofi-comando] Error en tool ${block.name}:`, e.message);
        result = `Error ejecutando la herramienta: ${e.message}`;
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system,
      messages,
      tools: COMMAND_TOOL_DEFINITIONS,
    });
  }

  // El loop se corto por el tope de iteraciones mientras el modelo TODAVIA
  // queria seguir usando herramientas (no porque termino de responder). Ese
  // ultimo turno no trae texto —fue puro tool_use— asi que sin esto caia en
  // el fallback generico, que no dice ni que ya hizo varias acciones ni que
  // queda trabajo pendiente. Bug real 2026-08-18: Juan pidio mandar un
  // WhatsApp por cada uno de 6 pedidos y el turno murio en silencio a mitad
  // de camino.
  const agotoIteraciones = response.stop_reason === "tool_use" && iterations >= MAX_TOOL_ITERATIONS;

  const finalText = extractText(response);
  if (finalText) textParts.push(finalText);
  let reply = textParts.join("\n").trim();
  if (!reply) {
    reply = agotoIteraciones
      ? 'Ya hice varias de las acciones que me pediste, pero llegue al limite de pasos para un solo mensaje. Decime "segui" y continuo con el resto.'
      : "No pude procesar eso. ¿Lo intentamos de otra forma?";
  }

  await command.appendCommandMessage(sessionId, "assistant", reply);
  return { reply };
}

// Cierra el dia: resume y siembra la cola de manana (EXP-006). Devuelve
// { summary, tomorrowQueue }.
async function closeSession(scope, sessionId, { userName } = {}) {
  // renderClose/buildTomorrowQueue toleran metrics/follow null: si el fetch
  // falla, el cierre igual persiste (con cola vacia) en vez de romper.
  let metrics = null;
  let follow = null;
  try {
    [metrics, follow] = await Promise.all([
      command.metricasLeads(scope, {}),
      command.seguimientos(scope, { dias: 3 }),
    ]);
  } catch (e) {
    console.error("[sofi-comando] cierre degradado:", e.message);
  }
  const tomorrowQueue = buildTomorrowQueue(follow);
  await command.closeSession(sessionId, tomorrowQueue);
  const summary = renderClose({ userName, metrics, follow, tomorrowQueue });
  await command.appendCommandMessage(sessionId, "assistant", summary);
  return { summary, tomorrowQueue };
}

module.exports = {
  openSession,
  processMessage,
  closeSession,
  historyPage,
  // Exportadas para tests: funciones puras.
  renderBriefing,
  renderClose,
  buildTomorrowQueue,
  toApiMessages,
  esDeHoyBogota,
};

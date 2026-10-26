// Sofi le pregunta al asesor hasta tener la respuesta (Juan, 2026-10-25;
// spec docs/superpowers/specs/2026-10-25-sofi-pregunta-al-asesor-design.md).
// Registra la pregunta, avisa al asesor de turno (campana + WhatsApp con la
// pregunta para que pueda contestar citandolo), cierra con la primera
// respuesta (CRM o WhatsApp) y se la pasa LITERAL al colega.
const { VENTANA_CERRADA } = require("./mensaje-asesor");

const TIPOS = ["precio", "unidad", "administracion", "otro"];
const PRENDIDO = /^(true|1|si|sí|on)$/i;

function activo() {
  return PRENDIDO.test(String(process.env.SOFI_PREGUNTA_ASESOR || ""));
}

function depsPorDefecto() {
  return {
    datos: require("../data/preguntas-asesor"),
    ciclo: (orgId) => require("../data/rotacion-citas").asesoresDelCiclo(orgId),
    avisarAsesor: (...a) => require("../notifications/avisar-asesor").avisarAsesor(...a),
    mensaje: (...a) => require("./mensaje-asesor").enviarYRegistrar(...a),
    texto: (...a) => require("../channels/whatsapp").sendWhatsApp(...a),
    plantilla: (...a) => require("../channels/whatsapp").sendWhatsAppTemplate(...a),
    notificar: (...a) => require("../notifications/notificar").notificar(...a),
    soloLlamada: (orgId, tel) => require("../data/colegas").esSoloLlamada(orgId, { telefono: tel }),
    registrar: (...a) => require("./registrar-saliente").registrarSaliente(...a),
    lead: (orgId, id) => require("../data/leads").findById(orgId, id),
    actualizarLead: (id, patch) => require("../data/leads").update(id, patch),
  };
}
const conDeps = (deps) => ({ ...depsPorDefecto(), ...(deps || {}) });

const primerNombre = (lead) => String((lead && lead.nombre) || "").trim().split(/\s+/)[0] || "";
const quienDe = (lead) => (lead && (lead.nombre || `+${lead.phone}`)) || "alguien";

function textoParaAsesor(p) {
  return `Pregunta de un colega${p.ref ? ` — Ref ${p.ref}` : ""}: ${p.pregunta}\nRespóndeme este mensaje con el dato y se lo paso.`;
}

function textoRespuesta({ lead, pregunta }) {
  const nombre = primerNombre(lead);
  const sobre = pregunta.ref ? `la Ref ${pregunta.ref}` : "lo que me preguntaste";
  return `Hola${nombre ? ` ${nombre}` : ""}, ya tengo la respuesta sobre ${sobre}:\n${pregunta.respuesta}`;
}

async function avisar({ org, pregunta, lead, advisor, reaviso = false, deps }) {
  const d = conDeps(deps);
  if (!advisor) return { ok: false };
  const titulo = `${reaviso ? "Sigue pendiente: pregunta" : "Pregunta"} de ${quienDe(lead)}${pregunta.ref ? ` · Ref ${pregunta.ref}` : ""}`;
  let r = await d.mensaje(org, advisor.phone, textoParaAsesor(pregunta), { permitirRepetido: reaviso }).catch((e) => ({ ok: false, error: e.message }));
  const nombrePlantilla = process.env.SOFI_PREGUNTA_ASESOR_PLANTILLA;
  if (!(r && r.ok) && nombrePlantilla && VENTANA_CERRADA.test((r && r.error) || "")) {
    r = await d
      .plantilla(org, advisor.phone, { name: nombrePlantilla, bodyParams: [pregunta.ref || "sin ref", pregunta.pregunta] })
      .catch((e) => ({ ok: false, error: e.message }));
  }
  if (r && r.wamid) {
    // Se AGREGA: el asesor puede citar cualquiera de los avisos de esta pregunta.
    await d.datos.agregarWamid(pregunta.id, r.wamid).catch(() => {});
    pregunta.wamids_aviso = [...(pregunta.wamids_aviso || []).filter((w) => w !== r.wamid), r.wamid];
  }
  // Campana + push siempre; el WhatsApp generico (aviso_app) solo si la
  // pregunta no llego por WhatsApp, para no mandar dos mensajes.
  await d
    .avisarAsesor({ org, advisor, motivo: "pregunta", lead, titulo, cuerpo: pregunta.pregunta, whatsapp: !(r && r.ok) })
    .catch((e) => console.warn("[preguntas] campana:", e.message));
  return { ok: Boolean(r && r.ok) };
}

async function registrar({ ctx, input, deps }) {
  const d = conDeps(deps);
  const texto = String((input && input.pregunta) || "").trim();
  if (texto.length < 3) return "Falta la pregunta: escríbela corta, ej \"¿Precio final de la ref 10013037?\".";
  const tipo = TIPOS.includes(input.tipo) ? input.tipo : "otro";
  const ciclo = await d.ciclo(ctx.org.id).catch(() => []);
  const asesor = ciclo[0] || null;
  let creada;
  try {
    creada = await d.datos.crear({ orgId: ctx.org.id, leadId: ctx.lead.id, ref: input.ref || null, tipo, pregunta: texto, asesorId: asesor ? asesor.id : null });
  } catch (e) {
    if (d.datos.esTablaAusente && d.datos.esTablaAusente(e)) console.error("[preguntas] tabla preguntas_asesor no existe");
    else console.error("[preguntas] no se pudo registrar:", e.message);
    return "No pude registrar la pregunta. Dile que lo consultas con el equipo y le escribes, sin prometer hora.";
  }
  // Ya respondida pero sin entregar (ventana cerrada): se le manda justo
  // despues del mensaje de Sofi (entregarPendientesDe en whatsapp.js).
  if (!creada.nueva && creada.pregunta.estado === "respondida") {
    return "Ya tengo la respuesta del asesor: el sistema se la manda justo después de tu mensaje. No la repitas ni le digas que todavía falta el dato.";
  }
  if (!creada.nueva) return "Esa pregunta ya está con el asesor. Dile que sigues esperando la respuesta y le escribes apenas llegue. No prometas hora.";
  if (!(ctx.lead.atencion_pendiente)) {
    await d
      .actualizarLead(ctx.lead.id, { atencion_pendiente: "pregunta", atencion_desde: new Date().toISOString() })
      .catch((e) => console.warn("[preguntas] no se pudo marcar el chat:", e.message));
  }
  if (asesor) await avisar({ org: ctx.org, pregunta: creada.pregunta, lead: ctx.lead, advisor: asesor, deps: d });
  else console.warn(`[preguntas] sin asesor en el ciclo — pregunta ${creada.pregunta.id} queda sin asignar`);
  return `Pregunta registrada (${creada.pregunta.id.slice(0, 8)}). Dile que le preguntas al asesor y le escribes apenas responda. No prometas hora. No le des nombres ni números del equipo.`;
}

async function limpiarAtencion({ pregunta, lead, d }) {
  const quedan = await d.datos.abiertasDeLead(pregunta.lead_id).catch(() => 1);
  if (quedan === 0 && lead && lead.atencion_pendiente === "pregunta") {
    await d.actualizarLead(pregunta.lead_id, { atencion_pendiente: null, atencion_desde: null }).catch(() => {});
  }
}

// Lo que se le mando al colega queda en su chat. Un fallo al guardar no deshace el envio.
async function guardarEnChat({ d, org, lead, texto, wamid }) {
  await Promise.resolve()
    .then(() => d.registrar(org, lead, texto, wamid))
    .catch((e) => console.warn("[preguntas] no se pudo guardar en el chat:", e.message));
}

async function entregarRespuesta({ org, pregunta, lead, advisor, deps }) {
  const d = conDeps(deps);
  const avisarFallo = async (titulo) => {
    if (!advisor) return;
    await d.notificar({ orgId: org.id, advisor, tipo: "pregunta_asesor", titulo, cuerpo: `Ref ${pregunta.ref || "sin ref"}: ${pregunta.respuesta}`, leadId: pregunta.lead_id }).catch(() => {});
  };
  if (lead.source === "colega") {
    const solo = await d.soloLlamada(org.id, lead.phone).catch(() => null);
    if (solo !== false) {
      await d.datos.actualizar(pregunta.id, { entrega_error: "solo_llamada" });
      await avisarFallo(`${quienDe(lead)} pidió solo llamada: Llámalo y dale la respuesta`);
      return { ok: false, motivo: "solo_llamada" };
    }
  }
  const textoFinal = textoRespuesta({ lead, pregunta });
  const r = await d.texto(org, lead.phone, textoFinal).catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok) {
    await d.datos.actualizar(pregunta.id, { estado: "entregada", entregada_at: new Date().toISOString(), entrega_error: null });
    await guardarEnChat({ d, org, lead, texto: textoFinal, wamid: r.wamid || null });
    return { ok: true };
  }
  const ventana = VENTANA_CERRADA.test((r && r.error) || "");
  const nombrePlantilla = process.env.SOFI_RESPUESTA_LISTA_PLANTILLA;
  if (ventana && nombrePlantilla) {
    const r2 = await d
      .plantilla(org, lead.phone, { name: nombrePlantilla, bodyParams: [primerNombre(lead) || "hola", pregunta.ref || "tu consulta"] })
      .catch((e) => ({ ok: false, error: e.message }));
    if (r2 && r2.ok) {
      await d.datos.actualizar(pregunta.id, { entrega_error: "esperando_ventana" });
      return { ok: false, motivo: "esperando_ventana" };
    }
  }
  const motivo = ventana ? "ventana_cerrada" : String((r && r.error) || "error").slice(0, 200);
  await d.datos.actualizar(pregunta.id, { entrega_error: motivo });
  await avisarFallo(`No le pude pasar la respuesta a ${quienDe(lead)}: escríbele desde el chat`);
  return { ok: false, motivo };
}

async function responder({ org, preguntaId, respuesta, advisor, via, deps }) {
  const d = conDeps(deps);
  const texto = String(respuesta || "").trim();
  if (texto.length < 2) return { ok: false, codigo: 400, error: "La respuesta está vacía." };
  const p = await d.datos.porId(preguntaId);
  if (!p || p.org_id !== org.id) return { ok: false, codigo: 404, error: "No encontré esa pregunta." };
  if (p.estado !== "pendiente") {
    const quien = p.respondida_por ? ` (la respondió ${p.respondida_por})` : "";
    return { ok: false, codigo: 409, error: `Esa pregunta ya está cerrada${quien}.` };
  }
  const cerrada = await d.datos.marcarRespondida(p.id, { respuesta: texto, por: advisor.name, via });
  if (!cerrada) return { ok: false, codigo: 409, error: "Esa pregunta ya la respondió otra persona." };
  const lead = await d.lead(org.id, p.lead_id);
  if (!lead) return { ok: true, texto: "Quedó guardada, pero no encontré el chat del colega." };
  await limpiarAtencion({ pregunta: cerrada, lead, d });
  const ent = await entregarRespuesta({ org, pregunta: cerrada, lead, advisor, deps: d });
  if (ent.ok) return { ok: true, texto: "Listo: ya le pasé la respuesta." };
  if (ent.motivo === "esperando_ventana") return { ok: true, texto: "Le avisé que ya tengo la respuesta; se la paso apenas conteste." };
  if (ent.motivo === "solo_llamada") return { ok: true, texto: "Quedó guardada. Pidió solo llamada: llámalo y dale la respuesta." };
  return { ok: true, texto: "Quedó guardada, pero no se la pude pasar. Escríbele desde el chat." };
}

async function descartar({ org, preguntaId, por, deps }) {
  const d = conDeps(deps);
  const p = await d.datos.porId(preguntaId);
  if (!p || p.org_id !== org.id) return { ok: false, codigo: 404, error: "No encontré esa pregunta." };
  if (p.estado !== "pendiente") return { ok: false, codigo: 409, error: "Esa pregunta ya está cerrada." };
  await d.datos.actualizar(p.id, { estado: "descartada", descartada_por: por });
  const lead = await d.lead(org.id, p.lead_id).catch(() => null);
  await limpiarAtencion({ pregunta: p, lead, d });
  return { ok: true };
}

// Respondida pero sin entregar (solo llamada, ventana cerrada, error): la
// asesora ya le dio la respuesta por fuera y cierra la tarjeta a mano.
async function marcarEntregadaAMano({ org, preguntaId, por, deps }) {
  const d = conDeps(deps);
  const p = await d.datos.porId(preguntaId);
  if (!p || p.org_id !== org.id) return { ok: false, codigo: 404, error: "No encontré esa pregunta." };
  if (p.estado !== "respondida") return { ok: false, codigo: 409, error: "Esa pregunta no está esperando entrega." };
  await d.datos.actualizar(p.id, { estado: "entregada", entregada_at: new Date().toISOString(), entrega_error: "a_mano" });
  return { ok: true };
}

async function entregarPendientesDe({ org, lead, deps }) {
  const d = conDeps(deps);
  const filas = await d.datos.porEntregarDe(lead.id).catch(() => []);
  let n = 0;
  for (const p of filas) {
    const textoFinal = textoRespuesta({ lead, pregunta: p });
    const r = await d.texto(org, lead.phone, textoFinal).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) {
      await d.datos.actualizar(p.id, { estado: "entregada", entregada_at: new Date().toISOString(), entrega_error: null });
      await guardarEnChat({ d, org, lead, texto: textoFinal, wamid: r.wamid || null });
      n++;
    }
  }
  return n;
}

// citada: la pendiente que el asesor cito. cerrada: el asesor cito el aviso de
// una pregunta que YA no esta pendiente (respondida o descartada); su mensaje
// no sirve para ninguna otra.
async function contextoAsesor({ org, preguntaId = null, preguntaCerrada = null }) {
  const datos = require("../data/preguntas-asesor");
  const pendientes = await datos.pendientesDeOrg(org.id);
  const citada = preguntaId ? pendientes.find((p) => p.id === preguntaId) || null : null;
  return { pendientes, citada, cerrada: citada ? null : preguntaCerrada };
}

async function hayPorEntregar(leadId) {
  const filas = await require("../data/preguntas-asesor").porEntregarDe(leadId);
  return filas.length > 0;
}

// La pregunta cuyo aviso citó el asesor (swipe-to-reply), en CUALQUIER estado:
// { id, estado, respondida_por }, o null si ese wamid no es de una pregunta.
// Quien llama decide: pendiente -> es la respuesta; cerrada -> no se reusa.
async function preguntaCitada(contextId) {
  if (!activo() || !contextId) return null;
  try {
    const p = await require("../data/preguntas-asesor").porWamid(contextId);
    return p ? { id: p.id, estado: p.estado, respondida_por: p.respondida_por || null } : null;
  } catch (_) {
    return null;
  }
}

module.exports = { preguntaCitada, activo, TIPOS, registrar, avisar, responder, descartar, marcarEntregadaAMano, textoRespuesta, entregarRespuesta, entregarPendientesDe, contextoAsesor, hayPorEntregar };

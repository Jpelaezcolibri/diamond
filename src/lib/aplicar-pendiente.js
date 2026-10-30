// Aplica en el CRM el resultado que la asesora puso en el Excel (spec
// 2026-10-30 §5-6). Cada fila es independiente: lo que falle en una no frena
// las demas. Primero se cierra el pendiente (condicional a que siga abierto):
// si ya lo estaba, no se toca nada y vuelve "ya_aplicado".
const cp = require("../data/contactos-pendientes");
const { RESULTADOS } = require("./pendientes-excel");

const MAX_INTENTOS = 3;
const TEXTO = Object.fromEntries(RESULTADOS.map((r) => [r.clave, r.texto]));

function depsPorDefecto() {
  return {
    actualizarLead: (id, patch) => require("../data/leads").update(id, patch),
    nota: (convId, texto) => require("../data/conversations").appendMessage(convId, "system", texto),
    confirmarCita: (args) => require("./confirmar-cita").confirmar(args),
  };
}

function fechaLegible(iso) {
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

async function aplicar({ org, advisor, pendiente, lead, accion, archivoUrl = null, deps = null }) {
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const por = advisor.name;
  const limpiar = ["sin_respuesta", "pide_asesor"].includes(lead.atencion_pendiente) ? { atencion_pendiente: null, atencion_desde: null } : {};
  let resumen;
  let patchLead = { ...limpiar };

  if (accion.tipo === "no_contesta") {
    const intentos = (pendiente.intentos || 0) + 1;
    if (intentos >= MAX_INTENTOS) {
      if (!(await cp.cerrar(pendiente.id, { estado: "cerrado", resultado: "no_contesta", nota: accion.nota, por, intentos, archivoUrl }))) return { ok: true, resumen: "ya_aplicado" };
      patchLead.estado = "cerrado_perdido";
      resumen = "cerrado";
    } else {
      if (!(await cp.volverAPendiente(pendiente.id, { intentos, nota: accion.nota, por }))) return { ok: true, resumen: "ya_aplicado" };
      patchLead = {}; // sigue en "Para atender" hasta el proximo intento
      resumen = "no_contesta";
    }
  } else {
    if (!(await cp.cerrar(pendiente.id, { estado: "resuelto", resultado: accion.tipo, nota: accion.nota, por, archivoUrl }))) return { ok: true, resumen: "ya_aplicado" };
    if (accion.tipo === "no_interesa") { patchLead.estado = "cerrado_perdido"; resumen = "cerrado"; }
    else if (accion.tipo === "numero_equivocado") { patchLead.estado = "descartado"; resumen = "descartado"; }
    else if (accion.tipo === "visita") resumen = "visita";
    else resumen = "nota";
  }

  if (Object.keys(patchLead).length) await d.actualizarLead(lead.id, patchLead);

  if (accion.tipo === "visita") {
    const cita = {
      descripcion: `Visita a la ref ${accion.ref} (Excel de ${por})`, tipo: "visita", fecha_hora: accion.fechaHoraIso,
      ref: accion.ref, estado: "propuesta", origen: "excel", creada_at: new Date().toISOString(), asesor_id: advisor.id,
    };
    await d.confirmarCita({ org, lead: { ...lead, ...patchLead, cita }, advisor });
  }

  const detalle = accion.tipo === "visita" ? ` ${fechaLegible(accion.fechaHoraIso)} · ref ${accion.ref}` : "";
  const intento = accion.tipo === "no_contesta" ? ` (intento ${(pendiente.intentos || 0) + 1} de ${MAX_INTENTOS})` : "";
  const notaTxt = accion.nota ? ` · nota: ${accion.nota}` : "";
  if (pendiente.conversation_id) await d.nota(pendiente.conversation_id, `📋 ${por} (Excel): ${TEXTO[accion.tipo]}${detalle}${intento}${notaTxt}`).catch(() => {});
  return { ok: true, resumen };
}

module.exports = { aplicar, MAX_INTENTOS };

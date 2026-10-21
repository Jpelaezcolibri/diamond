// Lo que pasa DESPUES de que Sofi se despide en una transferencia (Juan,
// 2026-10-21: "corrige: Sofi en pausa al transferir, alerta si no hay asesora").
//
// Lo llama src/channels/whatsapp.js una vez que la despedida ya salio, dentro
// de la cola por usuario (src/lib/user-queue.js): el siguiente mensaje del
// cliente no se procesa hasta que esto termine, asi que no hay carrera con la
// pausa.
//
//   - Con asesora (fila de advisors con id): campana del CRM + aviso_app
//     (avisarAsesor) y la conversacion pasa a modo "humano": Sofi deja de
//     contestar. La asesora la sigue desde el CRM y puede devolverla a Sofi
//     con "Devolver a Sofi", como siempre. Si el cliente queda esperando, el
//     vigilante src/scheduler/lead-esperando.js le avisa a la duena por la
//     campana a los 15 min.
//   - Sin asesora (respaldo de la org sin id, o el aviso fallo): alerta tecnica
//     a Juan (ALERTA_TECNICA_TO) sin el telefono del cliente, el chat queda
//     marcado en "Para atender" y Sofi NO se pausa: si nadie lo va a atender,
//     que por lo menos ella siga contestando.

const { hayAsesoraParaAvisar } = require("./identidad-publica");

function depsPorDefecto() {
  return {
    avisarAsesor: (...a) => require("../notifications/avisar-asesor").avisarAsesor(...a),
    setModo: (...a) => require("../data/conversations").setModo(...a),
    nota: (...a) => require("../data/conversations").appendMessage(...a),
    actualizarLead: (...a) => require("../data/leads").update(...a),
    alertaTecnica: (...a) => require("./alerta-saldo").enviarAlertaTecnica(...a),
  };
}

/**
 * @returns {Promise<{ok: boolean, pausada: boolean, error: string|null}>}
 */
async function cerrarTransferencia({ org, transfer, lead, telefonoCliente = null }, deps = null) {
  const d = deps || depsPorDefecto();
  const advisor = transfer && transfer.advisor;
  const convId = transfer && transfer.conversationId;

  let r;
  if (!hayAsesoraParaAvisar(advisor)) {
    r = { ok: false, error: "no hay asesora en la rotacion (respaldo de la organizacion sin usuario)" };
  } else {
    r = await d
      .avisarAsesor({
        org,
        advisor,
        motivo: "transferido",
        lead,
        titulo: `Sofi te transfirió a ${(lead && lead.nombre) || (telefonoCliente ? `+${telefonoCliente}` : "un cliente")}`,
        // El resumen completo va en la campana: es dentro del CRM.
        cuerpo: transfer.advisorAlert || transfer.motivo || null,
      })
      .catch((e) => ({ ok: false, error: e.message }));
  }

  if (r && r.ok) {
    let pausada = false;
    if (convId) {
      try {
        await d.setModo(convId, "humano");
        pausada = true;
        await d
          .nota(convId, "system", `Sofi quedó en pausa: ${advisor.name || "la asesora"} sigue la conversación desde el CRM. Para que Sofi vuelva a contestar, «Devolver a Sofi».`)
          .catch(() => {});
      } catch (e) {
        console.warn("[transferencia] No se pudo pausar a Sofi:", e.message);
      }
    }
    return { ok: true, pausada, error: null };
  }

  const error = (r && r.error) || "error desconocido";
  console.error(`[transferencia] Transferencia sin asesora (lead ${lead && lead.id}):`, error);
  if (lead && lead.id) {
    await d
      .actualizarLead(lead.id, { atencion_pendiente: "transferido", atencion_desde: new Date().toISOString() })
      .catch((e) => console.warn("[transferencia] No se pudo marcar el chat para atender:", e.message));
  }
  if (convId) {
    await d
      .nota(convId, "system", `⚠️ Esta transferencia no le llegó a ninguna asesora (${error}). Sofi sigue contestando; el chat quedó en "Para atender".`)
      .catch(() => {});
  }
  // Sin telefono ni nombre del cliente: solo lo necesario para encontrarlo en el CRM.
  await Promise.resolve(
    d.alertaTecnica(
      `Transferencia sin asesora: lead ${(lead && lead.id) || "?"} (${(transfer && transfer.especialidad) || "sin especialidad"}).`,
      `${error}. Quedó en "Para atender" del CRM ${(org && org.name) || ""}.`
    )
  ).catch(() => {});
  return { ok: false, pausada: false, error };
}

module.exports = { cerrarTransferencia };

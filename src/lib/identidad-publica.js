// Identidad publica del asesor (Juan, 2026-10-07): hacia colegas y clientes los
// asesores no se identifican por nombre sino como "Asesor 1", "Asesor 2"...
// (advisors.alias_publico), y nadie recibe el celular de una asesora: si
// alguien pide una persona, Sofi le avisa a la asesora y es ella quien escribe
// o llama. Todo texto hacia afuera que nombre a un asesor sale de aca, para
// que la regla viva en un solo lugar. Hacia adentro (avisos a la asesora,
// CRM) se sigue usando el nombre real.
// Spec: docs/superpowers/specs/2026-10-07-sofi-vendedora-y-agenda-design.md §2.

function aliasPublico(advisor, org) {
  const alias = advisor && String(advisor.alias_publico || "").trim();
  if (alias) return alias;
  return `un asesor de ${(org && org.name) || "la inmobiliaria"}`;
}

function textoCitaConfirmada({ cuando, ref, advisor, org }) {
  const refLinea = ref ? ` a la ref ${ref}` : "";
  return `Tu visita ${cuando}${refLinea} quedó CONFIRMADA. Te recibe ${aliasPublico(advisor, org)}.`;
}

// Una asesora de verdad es una fila de advisors (con id): a ella le llega la
// campana del CRM. El respaldo de findForTransfer (org.advisor_phone, sin id)
// o la ausencia total de asesor NO avisan a nadie en el momento (2026-10-21).
function hayAsesoraParaAvisar(advisor) {
  return Boolean(advisor && advisor.id);
}

function instruccionTransferencia({ especialidad, advisor, org }) {
  if (!hayAsesoraParaAvisar(advisor)) {
    // Sin nadie a quien avisar en el momento: Sofi no puede decir "ya fue
    // alertado". El lead queda en "Para atender" y Juan recibe alerta tecnica.
    return (
      `Transferencia registrada, pero en este momento no hay un asesor disponible para avisarle al instante. ` +
      `En tu respuesta despídete brevemente y dile que alguien del equipo lo contacta pronto por este medio. ` +
      `NO digas que ya le avisaste a un asesor ni nombres a nadie, y NO le des ningún link ni número de teléfono.`
    );
  }
  const alias = aliasPublico(advisor, org);
  return (
    `Transferencia registrada al asesor de ${especialidad} (${alias}). Ya fue alertado con el resumen del cliente. ` +
    `En tu respuesta despídete brevemente y dile que ${alias} lo va a contactar por este medio o por llamada. ` +
    `NO le des ningún link ni número de teléfono: el contacto lo inicia el asesor.`
  );
}

module.exports = { aliasPublico, textoCitaConfirmada, instruccionTransferencia, hayAsesoraParaAvisar };

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

function instruccionTransferencia({ especialidad, advisor, org }) {
  const alias = aliasPublico(advisor, org);
  return (
    `Transferencia registrada al asesor de ${especialidad} (${alias}). Ya fue alertado con el resumen del cliente. ` +
    `En tu respuesta despedite brevemente y decile que ${alias} lo va a contactar por este medio o por llamada. ` +
    `NO le des ningún link ni número de teléfono: el contacto lo inicia el asesor.`
  );
}

module.exports = { aliasPublico, textoCitaConfirmada, instruccionTransferencia };

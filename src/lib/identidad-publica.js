// Identidad publica del asesor. Hacia colegas y clientes NO se nombra a ningun
// asesor: ni nombre real, ni celular, ni "Asesor 1/2/3". Siempre "un asesor de
// nuestro equipo", y es el asesor quien inicia el contacto.
//
// Historia: desde 2026-10-07 se usaba el alias ("Asesor 1"). Caso Norha Velez
// (2026-11-07 al 09): la visita rotó entre asesoras y Sofi le dijo "Asesor 1",
// "Asesor 3" y otra vez "Asesor 1"; la colega no supo con quién coordinaba.
// Juan (2026-11-09): "internamente tenemos los asesores 1 2 y 3 pero para el
// cliente debe de ser indiferente... solo decirle que un asesor lo va a
// contactar es más que suficiente".
//
// Todo texto hacia afuera que hable de un asesor sale de aca. Hacia adentro
// (avisos a la asesora, CRM) se usa aliasInterno o el nombre real.

const ASESOR_PUBLICO = "un asesor de nuestro equipo";

function asesorPublico() {
  return ASESOR_PUBLICO;
}

// Rotulo interno (campanas, CRM): el alias si lo tiene, si no el nombre.
function aliasInterno(advisor) {
  if (!advisor) return "una asesora";
  return String(advisor.alias_publico || "").trim() || advisor.name || "una asesora";
}

function textoCitaConfirmada({ cuando, ref }) {
  const refLinea = ref ? ` a la ref ${ref}` : "";
  return `Tu visita ${cuando}${refLinea} quedó CONFIRMADA. Te recibe ${ASESOR_PUBLICO}.`;
}

// Una asesora de verdad es una fila de advisors (con id): a ella le llega la
// campana del CRM. El respaldo de findForTransfer (org.advisor_phone, sin id)
// o la ausencia total de asesor NO avisan a nadie en el momento (2026-10-21).
function hayAsesoraParaAvisar(advisor) {
  return Boolean(advisor && advisor.id);
}

function instruccionTransferencia({ especialidad, advisor }) {
  if (!hayAsesoraParaAvisar(advisor)) {
    // Sin nadie a quien avisar en el momento: Sofi no puede decir "ya fue
    // alertado". El lead queda en "Para atender" y Juan recibe alerta tecnica.
    return (
      `Transferencia registrada, pero en este momento no hay un asesor disponible para avisarle al instante. ` +
      `En tu respuesta despídete brevemente y dile que alguien del equipo lo contacta pronto por este medio. ` +
      `NO digas que ya le avisaste a un asesor ni nombres a nadie, y NO le des ningún link ni número de teléfono.`
    );
  }
  return (
    `Transferencia registrada al asesor de ${especialidad}. Ya fue alertado con el resumen del cliente. ` +
    `En tu respuesta despídete brevemente y dile que ${ASESOR_PUBLICO} lo va a contactar por este medio o por llamada. ` +
    `NO nombres al asesor (ni su nombre ni un número de asesor) y NO prometas una hora. ` +
    `NO le des ningún link ni número de teléfono: el contacto lo inicia el asesor.`
  );
}

module.exports = { asesorPublico, aliasInterno, textoCitaConfirmada, instruccionTransferencia, hayAsesoraParaAvisar, ASESOR_PUBLICO };

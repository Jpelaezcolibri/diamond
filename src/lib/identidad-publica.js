// Identidad publica del asesor. Hacia colegas y clientes nunca va el alias
// interno ("Asesor 1/2/3") ni el celular de nadie del equipo. Va el NOMBRE DE
// PILA de la asesora cuando se sabe que es ella quien lo va a contactar o
// recibir (visita confirmada por ella, aviso de contacto que le llegó a ella,
// transferencia); si no se sabe, "un asesor de nuestro equipo".
//
// Historia:
// - 2026-10-07: alias "Asesor N" hacia afuera.
// - 2026-11-09 (caso Norha): la visita rotó y Sofi dijo "Asesor 1", "Asesor 3"
//   y otra vez "Asesor 1"; se pasó a "un asesor de nuestro equipo" siempre.
// - 2026-11-11, Juan: "internamente ponemos asesor 1, asesor 2, asesor 3, pero
//   para el cliente o el colega son Claudia, Catherine y Daiana; damos el
//   nombre cuando tengamos claro que una de ellas será quien lo llame, de
//   resto decimos que un asesor se contactará". 7 colegas habían pedido un
//   nombre ("no me gusta hablar con máquinas").
//
// Todo texto hacia afuera que hable de un asesor sale de aca. Hacia adentro
// (avisos a la asesora, CRM) se usa aliasInterno o el nombre real.

const ASESOR_PUBLICO = "un asesor de nuestro equipo";

// "Daiana Zea (línea 2)" -> "Daiana". Solo el nombre de pila: nunca apellido.
function nombreDePila(advisor) {
  const n = String((advisor && advisor.name) || "").trim().split(/\s+/)[0] || "";
  if (!n || !/^[A-Za-zÁÉÍÓÚÑáéíóúñ]+$/.test(n)) return null;
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

// Con la asesora que lo va a contactar: su nombre de pila. Sin ella: genérico.
function asesorPublico(advisor = null) {
  return nombreDePila(advisor) || ASESOR_PUBLICO;
}

// Rotulo interno (campanas, CRM): el alias si lo tiene, si no el nombre.
function aliasInterno(advisor) {
  if (!advisor) return "una asesora";
  return String(advisor.alias_publico || "").trim() || advisor.name || "una asesora";
}

function textoCitaConfirmada({ cuando, ref, advisor = null }) {
  const refLinea = ref ? ` a la ref ${ref}` : "";
  return `Tu visita ${cuando}${refLinea} quedó CONFIRMADA. Te recibe ${asesorPublico(advisor)}.`;
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
  const quien = asesorPublico(advisor);
  return (
    `Transferencia registrada al asesor de ${especialidad}. Ya fue alertado con el resumen del cliente. ` +
    `En tu respuesta despídete brevemente y dile que ${quien} lo va a contactar por este medio o por llamada. ` +
    `Usa solo ese nombre: nunca un número de asesor ni un apellido, y NO prometas una hora. ` +
    `NO le des ningún link ni número de teléfono: el contacto lo inicia el asesor.`
  );
}

module.exports = { asesorPublico, nombreDePila, aliasInterno, textoCitaConfirmada, instruccionTransferencia, hayAsesoraParaAvisar, ASESOR_PUBLICO };

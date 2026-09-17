// A la asesora solo le llegan VISITAS (Juan, 2026-09-17): "que los mensajes
// que se envian a los asesores no se haga ninguno de seguimiento ni de
// alerta, solo que envie respuestas al dm y que los contactos a los asesores
// sea solo para programar visitas o para recordar visitas".
//
// El caso que lo disparo: "⚠️ Daiana Zea no respondió en el tiempo configurado
// el aviso de este pedido... ¿Le puedes dar seguimiento?" (radar-silencio),
// que le llegaba a la misma Daiana por su segundo numero.
//
// ASESORA_SOLO_VISITAS=true apaga, en todos los caminos, lo que el radar le
// escribe a la asesora por su cuenta:
//   - el aviso de un pedido (asistir, avisarCercano, pedido directo de un
//     colega por chat, post-DM, bandeja de salida, mandatos)
//   - los seguimientos (escalado por silencio, recordatorio por pedido,
//     cierre del dia, digest de la mañana, cruce visitas -> ventas)
//   - las alertas tecnicas que salen a RADAR_WATCHDOG_TO (vigilante, informe
//     de arranque, envio fallido, Sofi-Comando), porque hoy ese numero es el
//     de Daiana
//
// SIGUE SALIENDO, a proposito:
//   - el DM al colega (la respuesta del radar)
//   - el aviso de una cita, su recordatorio, su cancelacion y el recordatorio
//     de una cita propuesta
//   - lo del cliente directo de Sofi (transferencia, captador, aliado)
//   - el colega que pide hablar con una persona o solo por llamada (decision
//     de Juan el mismo dia)
//   - lo que un humano pide a mano (Sofi-Comando, botones, CRM)
//
// Nada se pierde: la señal queda guardada con su motivo y se ve en /grupos.
// Un solo interruptor, sin excepciones por camino (ver la memoria
// feedback-interruptor-sin-excepciones): quitar la variable, o ponerla en
// false, devuelve todo a como estaba sin tocar codigo.

function activo() {
  return process.env.ASESORA_SOLO_VISITAS === "true";
}

/** true si el camino debe callar. Deja rastro en el log de por que no salio. */
function frena(camino) {
  if (!activo()) return false;
  console.log(`[solo-visitas] ${camino}: no se le escribe a la asesora (ASESORA_SOLO_VISITAS=true).`);
  return true;
}

module.exports = { activo, frena };

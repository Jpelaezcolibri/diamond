// Numero marcable vs identificador interno de WhatsApp (@lid).
//
// WhatsApp dejo de exponer el numero real de los participantes de un grupo:
// en su lugar manda un LID que NO sirve para escribirle a nadie. Un
// colombiano real son <=13 digitos (57 + 10, a veces con algun 0/prefijo
// suelto); un LID trae 14-15. Mostrar un LID como si fuera un telefono es
// peor que no mostrarlo — el asesor lo marca, no existe, y pierde el negocio
// creyendo que el dato estaba (mismo criterio que ya usaba
// crm/components/senales-grupos.tsx#telefonoUsable, ahora compartido con el
// backend para que alerta-asesor.js y radar-trazabilidad.js no diverjan).
function esMarcable(telefono) {
  return Boolean(telefono && String(telefono).replace(/\D/g, "").length <= 13);
}

// El link wa.me listo para pegar, o null si no es marcable. Se devuelve el
// link armado (no el numero suelto) para que quien lo consuma —Sofi
// redactando un mensaje, un componente del CRM— no tenga que saber COMO se
// arma un link de WhatsApp, solo si existe o no.
function linkWhatsapp(telefono) {
  return esMarcable(telefono) ? `https://wa.me/${String(telefono).replace(/\D/g, "")}` : null;
}

// Link a la linea OFICIAL de Sofi (Juan, 2026-08-22): "que todo mensaje que
// salga hacia un colega invite a escribirle a Sofi" -- asi se abre la ventana
// de 24h en la linea oficial (sin el riesgo de baneo de la linea vinculada al
// radar, ver sofi-grupos-whatsapp.md) y la conversacion queda en el CRM.
// Compartido entre alerta-asesor.js y aviso-cercano.js para que los dos
// avisos al colega usen exactamente el mismo criterio.
//
// Se lee la variable en cada llamado, nunca se cachea: los tests la
// prenden/apagan por caso y la ausencia/presencia tiene que reflejarse en el
// momento exacto de construir el aviso.
//
// Reusa linkWhatsapp (y no arma el link a mano) a proposito: si el numero no
// es marcable devuelve null, nunca un link a medias. Precedente real
// (2026-08-18, ver src/lib/validar-mensaje.js): Sofi le mando a un colega
// "https://wa.me/message/YOUR_CONTACT_LINK", un placeholder inventado. El
// link lo arma el codigo, nunca la IA -- sin CONTACT_WHATSAPP_NUMBER
// definida, el aviso sale SIN esta linea, nunca con un link a medias.
function linkContactoOficial() {
  return linkWhatsapp(process.env.CONTACT_WHATSAPP_NUMBER);
}

module.exports = { esMarcable, linkWhatsapp, linkContactoOficial };

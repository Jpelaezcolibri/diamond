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

module.exports = { esMarcable, linkWhatsapp };

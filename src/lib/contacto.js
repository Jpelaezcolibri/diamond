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

// VALIDACION ESTRICTA para el camino que ESCRIBE al colega (revision
// 2026-08-24, code review post-merge). esMarcable de arriba es solo un techo
// de longitud (<=13 digitos) y existia para distinguir un LID (14-17) de un
// telefono real -- pero la medicion que lo motivo fue de 12 de 12 LIDs con
// 14-17 digitos, no una garantia de que nunca haya uno mas corto. Un LID de
// 10-13 digitos pasaria esMarcable como si fuera bueno, y el modo de falla no
// es un numero raro en una tabla: es alertaAsesor.construir armando un link
// wa.me con ese LID y la asesora escribiendole desde SU propio numero a un
// desconocido -- exactamente lo que ya termino en el baneo de una cuenta en
// julio de 2026 (ver src/lib/waha.js). Un celular colombiano real tiene forma
// fija: 3 + 9 digitos (10 en total), con o sin el 57 de pais adelante -- nunca
// un rango de longitud.
//
// Se agrega AL LADO de esMarcable en vez de endurecerla porque esMarcable
// tiene otros usos que no escriben a nadie con datos de un grupo (ver
// linkContactoOficial abajo, que valida un numero de CONFIGURACION fijo, y
// src/data/radar-trazabilidad.js, que solo pinta un flag informativo en el
// CRM) -- exigirles forma de celular colombiano ahi no hacia falta y podia
// romper un numero fijo valido que no calce ese patron.
function esCelularColombiano(telefono) {
  return /^(57)?3\d{9}$/.test(String(telefono || "").replace(/\D/g, ""));
}

// Version estricta de linkWhatsapp: solo arma el link si el numero tiene
// forma de celular colombiano real (ver esCelularColombiano). Para el camino
// que le da a la asesora un link para escribirle a un colega detectado en un
// grupo (src/groups/alerta-asesor.js) o que guarda un telefono resuelto para
// despues escribirle (src/groups/directorio.js) -- nunca para el numero fijo
// de la linea oficial de Sofi, que sigue usando linkWhatsapp/esMarcable.
function linkWhatsappEstricto(telefono) {
  return esCelularColombiano(telefono) ? `https://wa.me/${String(telefono).replace(/\D/g, "")}` : null;
}

// El numero LISTO PARA MOSTRAR, o null: solo digitos, y solo si tiene forma
// de celular colombiano real (esCelularColombiano).
//
// POR QUE DEVUELVE DIGITOS Y NO EL DATO CRUDO (2026-09-05). No alcanza con
// validar y despues imprimir lo que habia guardado. La columna
// ally_properties.contacto_telefono trae de todo —el nombre del colega, el
// string "null", un telefono con el + adelante, y hasta "Carolina Fleisman
// +573002701862" con el nombre pegado— y los avisos de esos dias salieron
// diciendo "Contacto del colega: ++573002701862" y "+Carolina Fleisman
// +573002701862". Validar y luego imprimir el crudo arregla la mitad del
// problema; devolver el numero normalizado lo arregla entero, y deja un solo
// lugar donde se decide como se ve un telefono.
function telefonoNormalizado(telefono) {
  if (!esCelularColombiano(telefono)) return null;
  return String(telefono).replace(/\D/g, "");
}

// Link a la linea OFICIAL de Sofi (Juan, 2026-08-22): "que todo mensaje que
// salga hacia un colega invite a escribirle a Sofi" -- asi se abre la ventana
// de 24h en la linea oficial (sin el riesgo de baneo de la linea vinculada al
// radar, ver sofi-grupos-whatsapp.md) y la conversacion queda en el CRM.
// Compartido entre alerta-asesor.js y aviso-cercano.js para que los dos
// avisos al colega usen exactamente el mismo criterio.
//
// MULTI-TENANT (revision 2026-08-24): este repo es multi-tenant por diseño
// (todo lleva org_id) y `process.env.CONTACT_WHATSAPP_NUMBER` es UNA sola
// variable de Railway para todo el proceso — con una organizacion B, el
// aviso le ofreceria la linea de Diamond. `org` (el registro de
// organizations, ya cargado por el llamador) manda si trae
// `contact_whatsapp_number`; el env queda como default para cuando la org no
// tiene el dato o la columna todavia no existe (migracion
// db/migrations/2026-08-24_contact_whatsapp_number.sql sin correr) — mismo
// patron que organizations.js#modoDeRespuesta usa para
// grupos_respuesta_modo. `org` es opcional a proposito: quien llame a
// linkContactoOficial() sin el (codigo viejo, o un contexto sin org a mano)
// sigue funcionando igual que antes, solo con el env.
//
// Se lee la variable de entorno en cada llamado, nunca se cachea: los tests
// la prenden/apagan por caso y la ausencia/presencia tiene que reflejarse en
// el momento exacto de construir el aviso.
//
// Reusa linkWhatsapp (y no arma el link a mano) a proposito: si el numero no
// es marcable devuelve null, nunca un link a medias. Precedente real
// (2026-08-18, ver src/lib/validar-mensaje.js): Sofi le mando a un colega
// "https://wa.me/message/YOUR_CONTACT_LINK", un placeholder inventado. El
// link lo arma el codigo, nunca la IA -- sin ningun numero definido (ni org
// ni env), el aviso sale SIN esta linea, nunca con un link a medias.
function linkContactoOficial(org = null) {
  const numero = (org && org.contact_whatsapp_number) || process.env.CONTACT_WHATSAPP_NUMBER;
  return linkWhatsapp(numero);
}

// La instruccion real cuando no hay telefono marcable para un colega: tocar
// su nombre DENTRO del grupo abre el chat privado sin necesitar el numero
// guardado (asi funciona WhatsApp). Centralizada aca 2026-08-24 porque vivia
// repetida a mano en tres lugares (alerta-asesor.js#contactoPara y dos veces
// en aviso-cercano.js) y una revision encontro TRES caminos mas que en vez de
// esto decian "respondele en el grupo" — justo lo que la norma del gremio
// (Juan, 2026-08-22) prohibe: no llenar los grupos de informacion, los
// pedidos se responden al privado del colega. El propio codigo ya lo dice en
// alerta-asesor.js: "cada motivo nuevo era un hueco nuevo". Con la frase en
// un solo lugar, el dia que la politica cambie de nuevo hay un solo texto
// que tocar, y test/contacto.test.js#no-reaparece bloquea que un aviso nuevo
// vuelva a escribir la frase vieja a mano.
function tocarNombreEnGrupo(quien) {
  return `tocá el nombre de ${quien} en el grupo para abrirle el chat directo — no hace falta tenerlo guardado`;
}

module.exports = { esMarcable, linkWhatsapp, esCelularColombiano, telefonoNormalizado, linkWhatsappEstricto, linkContactoOficial, tocarNombreEnGrupo };

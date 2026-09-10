// El aviso que recibe la asesora cuando Sofi aprueba una oportunidad.
//
// Lo pidio Juan asi: nombre del grupo, quien lo pidio, que busca, y cual de
// nuestras propiedades le sirve. Se agrega el POR QUE de Sofi, que es lo que
// convierte un listado en algo accionable.
//
// TERMINA PIDIENDO UNA RESPUESTA CORTA, y no es cortesia. Cumple dos funciones:
//
//   1. Es el dato que falta para calibrar. El puntaje y el veredicto de Sofi ya
//      quedan guardados; lo que no se puede deducir es si la oportunidad servia
//      de verdad. Solo lo sabe quien llamo al colega.
//   2. Renueva la ventana de 24h. Meta solo entrega texto libre a alguien que
//      escribio en las ultimas 24 horas, y los mensajes que manda Sofi NO
//      extienden ese plazo — solo los de ella. Cada respuesta suya mantiene
//      vivo el canal por el que llegan los avisos siguientes.
//
// CONTACTO DEL COLEGA (Juan, 2026-08-22): "que se notifique al celular de
// natalia todo para que ella lo responda directamente desde su numero" — el
// gremio pide no llenar los grupos de informacion, asi que este aviso YA NO
// puede decir "respondele en el grupo". `senal.autor_telefono` que llega de
// WhatsApp CASI SIEMPRE es un @lid (14-17 digitos), no un telefono real
// (medido en produccion el 2026-08-22: 12 de 12 eran LID) — por eso
// `construir` recibe aparte el telefono YA RESUELTO por
// src/groups/directorio.js (67% de resolucion medido ese mismo dia), que es
// el camino principal. Con telefono resuelto: link directo al privado.
//
// autor_telefono se usa igual, pero solo como ULTIMO intento (revision
// 2026-08-24): WhatsApp a veces entrega el participante como @c.us —numero
// visible, no LID— y ese numero SI tiene forma de celular real de una.
// Descartarlo de entrada porque "normalmente" es un LID dejaba el aviso
// diciendo "no se pudo resolver el numero" con el numero ahi mismo en la
// señal. linkWhatsappEstricto filtra con esCelularColombiano (revision
// posterior, code review post-merge 2026-08-24: esMarcable solo exigia <=13
// digitos y un LID de 10-13 lo hubiera pasado igual), asi que un LID de
// verdad sigue sin mostrarse.
//
// Sin ninguno de los dos (el 33% esperado, no un error): la salida real es
// tocar el nombre del colega en el grupo, que WhatsApp abre el chat sin pedir
// el numero.

const formato = require("../lib/formato");
const { normalizarTitulo } = require("../lib/formato");
const { linkWhatsappEstricto, linkContactoOficial, tocarNombreEnGrupo, telefonoEnTexto } = require("../lib/contacto");
const redactar = require("./redactar");
// El pedido se describe en un solo lugar (2026-09-10): el DM al colega y este
// aviso tienen que hablar del MISMO pedido. queBusca vivia aca; ahora es
// pedido.js#resumenPedido, sin cambios de comportamiento.
const { resumenPedido: queBusca, numeroPedido } = require("./pedido");
const {
  REFS_BLOQUEADAS,
  explicarMotivosSeguro,
  clasificarMotivos,
  aclaracionParaColega,
} = require("./publicable");

// Una propiedad, corta: la asesora ya conoce el inventario, no necesita la
// ficha entera. Necesita reconocerla y tener el link a mano.
//
// `aclaracion` (2026-09-07) es el reparo con el que la propiedad SIGUE en la
// lista: la compuerta de calidad la freno para salir sola al grupo, pero la
// decision es de la asesora y no se le puede esconder la propiedad ni la
// razon. Mismo criterio que la aclaracion de zona de redactar.js#ficha —
// el dato se muestra CON su salvedad, nunca se borra.
function linea(match, aclaracion = null) {
  const titulo = normalizarTitulo(match.titulo) || "Propiedad";
  const datos = [
    match.zona,
    formato.formatearArea(match.area),
    formato.pluralizar(match.habitaciones, "alcoba"),
    formato.formatearPrecio(match.precio),
  ]
    .filter(Boolean)
    .join(" · ");

  // Si a la propiedad le falta un dato, se dice. Es un aviso interno: ocultarlo
  // la haria llamar al colega sin saber que el precio no esta cargado.
  const faltantes = [];
  if (formato.parsearPrecio(match.precio) === null) faltantes.push("sin precio cargado");
  if (!String(match.zona || "").trim()) faltantes.push("sin zona");
  const nota = faltantes.length ? `\n  ⚠️ ${faltantes.join(", ")}` : "";

  // linkWasi, NUNCA `link` (Juan, 2026-09-02): "la informacion de la propiedad
  // con su link de wasi, no es necesario enviar el de diamond". Dos razones que
  // apuntan al mismo lado — el de la landing no le sirve a la asesora (si se lo
  // pasa al colega, el colega se lo reenvia a su cliente y ese cliente termina
  // viendo a otra inmobiliaria), y mandar los dos duplicaba una URL larga por
  // propiedad, que es lo que empujaba el aviso contra el tope de 4096. Una
  // propiedad de aliado no tiene linkWasi y sale sin link, que es correcto: no
  // es inventario nuestro.
  const reparo = String(aclaracion || "").trim();
  const salvedad = reparo ? `\n  ⚠️ ${reparo}` : "";

  return `▸ Ref ${match.ref} — ${titulo}\n  ${datos}${nota}${salvedad}${match.linkWasi ? `\n  ${match.linkWasi}` : ""}`;
}

// Texto de contacto: con telefono resuelto, el link directo al privado; sin
// el, la instruccion real para ese 33% — nunca "respondele en el grupo"
// (norma de Juan, 2026-08-22), porque el gremio pide no llenar los grupos de
// informacion y esa frase invitaba justo a eso. tocarNombreEnGrupo vive en
// src/lib/contacto.js (2026-08-24): esta misma instruccion se necesito en
// otros avisos, ver la nota ahi.
//
// autorTelefono (revision 2026-08-24): ultimo intento antes de rendirse.
// `telefonoColega` es el numero YA RESUELTO por src/groups/directorio.js
// (67% de resolucion medido el 2026-08-22) y cubre el caso normal. Pero
// cuando WhatsApp entrega el participante como @c.us — numero visible, no
// LID — este aviso decia "no se pudo resolver el numero" TENIENDO el numero
// a mano en senal.autor_telefono. linkWhatsappEstricto exige forma de celular
// colombiano (3 + 9 digitos), asi que si autorTelefono resulta ser un LID
// (14-17 digitos, o incluso uno mas corto de 10-13) esto sigue devolviendo
// null y cae al mismo mensaje de siempre — no hay riesgo de mostrar un LID
// como si fuera un telefono.
//
// linkWhatsappEstricto y NO linkWhatsapp (code review post-merge, 2026-08-24):
// este es exactamente el camino que le entrega a la asesora un numero para
// que le escriba DESDE SU PROPIO WhatsApp — el mismo tipo de paso que ya
// termino en el baneo de una cuenta en julio de 2026 (ver src/lib/waha.js) por
// escribirle a alguien fuera del circuito oficial. linkWhatsapp (esMarcable,
// <=13 digitos) es un techo demasiado ancho para ese riesgo.
// TERCERA FUENTE: el numero que el colega escribio en su propio pedido (Juan,
// 2026-09-05). El caso que lo motivo: Adriana Gutierrez firmo su pedido con
// "📲3172874669" y este bloque decia "no se pudo resolver el número" — con el
// numero a la vista tres renglones mas abajo, en el mismo aviso. Medido ese
// dia: 195 de 760 pedidos traen un celular escrito.
//
// Va DESPUES de las dos fuentes verificadas (el directorio y el identificador
// del autor) porque es la menos confiable: el texto puede traer el numero del
// DUEÑO de la propiedad o el de un tercero, no necesariamente el de quien
// publica. Por eso el aviso dice de donde salio en vez de presentarlo como si
// lo hubieramos resuelto: la asesora tiene que poder decidir si confia.
function contactoPara(telefonoColega, autorTelefono, quien, textoOriginal = null) {
  const link = linkWhatsappEstricto(telefonoColega) || linkWhatsappEstricto(autorTelefono);
  if (link) return link;

  const delTexto = linkWhatsappEstricto(telefonoEnTexto(textoOriginal));
  if (delTexto) return `${delTexto} (lo escribió en su mensaje — confirmá que sea el de ${quien})`;

  return `no se pudo resolver el número — ${tocarNombreEnGrupo(quien)}`;
}

function telefonoResuelto(telefonoColega, autorTelefono, textoOriginal = null) {
  return Boolean(
    linkWhatsappEstricto(telefonoColega) ||
      linkWhatsappEstricto(autorTelefono) ||
      linkWhatsappEstricto(telefonoEnTexto(textoOriginal))
  );
}

// Mensaje ya armado para reenviar (Juan, 2026-09-01): sin telefono resuelto, la
// asesora no tiene forma de que el bot le escriba solo al colega -- alguna
// persona tiene que hacerlo a mano, tocando su nombre en el grupo. Sin este
// bloque, el aviso solo describia las propiedades y la asesora tenia que
// redactar el mensaje ella misma. Reusa el MISMO texto "blanqueado" que ya usa
// el DM automatico (src/groups/vivo.js#textoParaColega) -- el que el colega
// reenvia tal cual a su cliente -- para que copiar y pegar sea lo unico que
// haga falta.
//
// Filtra por linkWasi (Juan, 2026-09-01): ese campo solo lo tienen las
// propiedades DE DIAMOND (ver src/groups/match.js) -- una de un colega
// (fuente "aliado") sale con linkWasi null, y redactar.js#ficha imprimiria un
// link vacio. Sin ninguna propiedad propia entre las utiles, no hay mensaje
// que armar: se omite el bloque entero, nunca a medias.
//
// LOS REPAROS DE LA COMPUERTA VIAJAN ADENTRO (Juan, 2026-09-07): "el borrador
// listo para reenviar lleva esa misma aclaracion adentro". Una propiedad que
// la compuerta freno por un motivo de PUBLICACION sigue en la lista de la
// asesora, asi que tambien puede terminar en el borrador — y ahi no puede
// presentarse como si estuviera limpia. Se inyecta por `leFalta`, el MISMO
// canal por el que ya viaja la aclaracion de zona ({ref, detalle} ->
// redactar.js#ficha -> "Aclaración: ..."), en vez de inventar un segundo
// mecanismo: asi la ficha sale con UNA sola linea de Aclaración con todo
// junto, que es como la lee el colega.
function mensajeListoParaReenviar(senal, veredicto, utiles, org, aclaracionesColega = new Map()) {
  const propias = utiles.filter((m) => m.linkWasi);
  if (propias.length === 0) return null;

  // Copia: `veredicto.le_falta` es el objeto guardado en la señal y no se
  // muta — el mismo veredicto lo leen el feed del admin y el CRM.
  const leFalta = (Array.isArray(veredicto.le_falta) ? veredicto.le_falta : []).map((f) => ({ ...f }));
  for (const m of propias) {
    const extra = aclaracionesColega.get(String(m.ref));
    if (!extra) continue;
    const yaEsta = leFalta.find((f) => f && String(f.ref) === String(m.ref) && String(f.detalle || "").trim());
    if (yaEsta) yaEsta.detalle = `${yaEsta.detalle} · ${extra}`;
    else leFalta.push({ ref: m.ref, detalle: extra });
  }

  return redactar.mensajeGrupo(senal, propias, {
    org,
    sinConfirmar: veredicto.sin_confirmar || [],
    leFalta,
    // El borrador que la asesora reenvia lleva las MISMAS aclaraciones que el
    // DM automatico: si el desvio de zona solo saliera por el camino del bot,
    // el colega recibiria una version mas honesta cuando le escribe la maquina
    // que cuando le escribe una persona.
    pedido: {
      zonas: Array.isArray(senal.zonas) && senal.zonas.length ? senal.zonas : null,
      zona: senal.zona || null,
      habitaciones: senal.habitaciones || null,
      areaMin: senal.area_min || null,
    },
  });
}

// POR QUE ESTE PEDIDO NO SALIO SOLO (Juan, 2026-09-02): "que la asesora
// entienda por que no se envio de manera automatica". Hasta hoy el aviso le
// caia sin explicacion, y la pregunta obvia —"¿y por que no lo mandó el
// bot?"— no tenia respuesta en el mensaje. El motivo ya existia: lo decide
// src/groups/politica.js#decidirDm y queda guardado en la señal. Solo faltaba
// decirlo en palabras.
const PORQUE = {
  sin_telefono: "No teníamos ni número ni @lid del colega, así que el bot no tenía por dónde escribirle. Te toca a vos.",
  pedido_vencido: "El pedido ya tiene más de media hora. Que el bot escriba tan tarde se lee como spam; de parte tuya no.",
  // limite_colega_alcanzado / limite_colega_no_verificable se quitaron el
  // 2026-09-05: decidirDm no emite esos motivos desde que el tope por colega
  // se elimino (2026-09-04). Una traduccion de un motivo que ya no existe
  // solo confunde a quien lea esta tabla.
  limite_linea_alcanzado: "La línea llegó a su tope de mensajes por hoy.",
  limite_linea_no_verificable: "No pudimos contar los mensajes que mandó la línea hoy, y ante la duda el bot no escribe.",
  cuota_whatsapp_alta: "La línea está cerca de la cuota mensual de mensajes de WhatsApp, y el bot se frena para dejar colchón.",
  sin_fecha_mensaje: "El pedido llegó sin fecha, así que no podemos saber si todavía está vigente.",
  dm_fallido: "El bot intentó escribirle y WhatsApp rechazó el envío.",
  // carril_umbral (Important 3 del review de 400c0c8): el carril de arriendo
  // exige, ademas de todo lo anterior, que el match califique por encima de
  // su propio umbral (RADAR_AMOBLADO_UMBRAL_DM) y que la propiedad este
  // confirmada como amoblada -- src/groups/carril-arriendo.js#puedeSalirSolo.
  carril_umbral: "El match no llegó al puntaje que exige el carril de amoblados para salir solo (o no confirmamos que la propiedad sea amoblada). Vos decidís si igual le sirve al colega.",
  // carril_apagado (Important del review de 6104561): distinto de
  // carril_umbral a proposito -- src/groups/carril-arriendo.js#puedeSalirSolo
  // devuelve false por el interruptor ANTES de mirar el puntaje, asi que un
  // match de 98 con el interruptor apagado no puede contarse como "no llego
  // al puntaje". Nunca reusar el texto de carril_umbral aca.
  carril_apagado: "El carril de amoblados está apagado en este momento, así que ningún match sale solo por ese carril, sin importar el puntaje. Vos decidís si escribirle al colega.",
};

// Cuando Sofi APROBO y aun asi el bot no pudo escribirle al colega, el aviso
// tiene que gritar (Juan, 2026-09-02): "envialo con urgencia que es una gran
// oportunidad, con emojis de alerta o algo asi, para que yo pueda saber que
// es lo que se queda y por que". Una oportunidad aprobada que se queda en la
// bandeja es la unica perdida real de todo el radar.
const URGENCIA = "Es una oportunidad YA APROBADA por Sofi: escribile vos con urgencia.";

function porqueNoSalioSolo(motivo, hayUtiles) {
  if (!hayUtiles) {
    return "Sofi no aprobó ninguna del todo, así que no le escribió nada al colega. Estas quedan para que decidas vos.";
  }
  if (PORQUE[motivo]) return `🚨 ${PORQUE[motivo]} ${URGENCIA}`;
  // LA COMPUERTA DE CALIDAD TIENE SUS PROPIOS MOTIVOS (fix critico, revision
  // post-merge 2026-09-07). `motivo` viene de politica.js#decidirDm casi
  // siempre, pero vivo.js tambien puede guardar aca uno de los motivos de
  // publicable.js/verificar-link.js (periodo_no_soportado, sin_precio,
  // link_no_abre...) cuando esa compuerta fue la que de verdad vacio
  // `utiles` -- ver la correccion en vivo.js#asistir. Esos motivos no viven en
  // la tabla PORQUE de arriba, y sin este fallback llegaban aca como `null`:
  // el aviso quedaba MUDO justo cuando mas urgente era explicar por que
  // ("Busco amoblado 15 dias" -> Sofi aprobo, la compuerta lo freno, y la
  // asesora no se enteraba de ninguna de las dos cosas). Se reusa la
  // traduccion de publicable.js en vez de copiarla aca -- ya existe y cubre
  // TODOS sus motivos, no solo el que motivo este fix. Si explicarMotivos no
  // conoce el motivo, devuelve el identificador crudo sin traducir; eso NUNCA
  // puede llegarle a una persona (es exactamente el bug que el commit
  // b0f62ea ya cerro por otra puerta), asi que se calla en vez de mostrarlo.
  //
  // EL PUNTO FINAL LO PONE ESTA FUNCION (Minor, 2026-09-07). Los textos de
  // PORQUE terminan en punto; los de MOTIVOS_LEGIBLES no (son fragmentos que
  // completan otras frases, "Ref X calza, pero <motivo> — ..."). Sin esto la
  // linea salia pegada: "...cotizado por mes Es una oportunidad YA APROBADA".
  const traducido = motivo ? explicarMotivosSeguro([motivo]) : null;
  if (!traducido) return null;
  const conPunto = /[.!?…]$/.test(traducido) ? traducido : `${traducido}.`;
  return `🚨 ${conPunto} ${URGENCIA}`;
}

/**
 * @param senal           { grupo_nombre, autor_nombre, autor_telefono, texto_original,
 *                          y los campos del clasificado: operacion, tipo, zona(s),
 *                          precio_max, habitaciones, area_min, banos, garajes, estrato }
 * @param veredicto       lo que devolvio src/groups/revalidar.js
 * @param matches         las candidatas; se muestran solo las que Sofi marco utiles
 * @param telefonoColega  telefono YA RESUELTO del colega (src/groups/directorio.js#telefonoDe),
 *                        o null/undefined si no se pudo resolver. Parametro nuevo y opcional:
 *                        quien llame a `construir` sin el sigue funcionando, solo que sin link
 *                        directo al privado.
 * @param org             el registro de organizations (para el numero de contacto oficial
 *                        multi-tenant, ver src/lib/contacto.js#linkContactoOficial). Opcional:
 *                        sin el, cae al env CONTACT_WHATSAPP_NUMBER, igual que antes.
 * @param motivoDm        por que el bot NO le escribio solo al colega
 *                        (src/groups/politica.js#decidirDm). Opcional: sin el, el
 *                        aviso sale como antes, sin la linea de explicacion.
 * @param opciones.descartadosCalidad  refs que Sofi SI aprobo (refs_utiles) pero
 *                        que publicable.filtrar + verificar-link.js (la misma
 *                        compuerta de calidad del DM automatico, ver vivo.js)
 *                        frenaron para salir solas -- [{ ref, motivos }].
 *                        NO son todas lo mismo: publicable.js#clasificarMotivos
 *                        las parte en "no se puede publicar sin supervision"
 *                        (sigue ofrecible, con su reparo al lado y adentro del
 *                        borrador) y "nunca se ofrece" (va al bloque ⛔).
 *                        Opcional y default vacio: sin el, el aviso sale
 *                        exactamente como antes.
 * @returns el texto del aviso, o null si no hay nada que decir
 */
function construir(
  senal,
  veredicto,
  matches,
  telefonoColega = null,
  org = null,
  motivoDm = null,
  { link = null, carrilAmoblados = false, descartadosCalidad = [] } = {}
) {
  const refsUtiles = veredicto && Array.isArray(veredicto.refs_utiles) ? veredicto.refs_utiles : [];
  const refsDudosas = veredicto && Array.isArray(veredicto.refs_dudosas) ? veredicto.refs_dudosas : [];
  if (!veredicto || (refsUtiles.length === 0 && refsDudosas.length === 0)) return null;

  // REFS BLOQUEADAS (2026-09-05). Una ref en GRUPOS_REFS_BLOQUEADAS no sale a
  // ningun colega porque tiene un dato mal cargado en Wasi —la 9921388 lleva
  // semanas ahi por el precio. Pero refsDelAviso arma el aviso con las refs
  // CRUDAS del veredicto, sin pasar por publicable.filtrar, asi que la asesora
  // las veia listadas como ofrecibles: el 2026-09-05 el aviso de GUSTAVO
  // ARANGO le mostro "Ref 9921388 · $1.550.000.000". Si ella la ofrece, el
  // bloqueo no sirvio de nada — el precio equivocado sale igual, por su mano.
  //
  // Se APARTAN, no se ocultan: si la asesora ve un pedido sin propiedades no
  // entiende por que le llego, y si la bloqueada era la unica tiene derecho a
  // saber que existe y por que todavia no se puede ofrecer.
  const bloqueada = (ref) => REFS_BLOQUEADAS.has(String(ref).trim().toUpperCase());

  // COMPUERTA DE CALIDAD, Y SUS DOS CLASES DE "NO" (Juan, 2026-09-07). Sofi
  // aprueba con su propio criterio (refs_utiles), pero eso NO es la misma
  // compuerta que ya corrio en vivo.js antes de intentar el DM directo:
  // publicable.filtrar + verificar-link.js pueden frenar una ref que Sofi
  // aprobo. Lo que NO se puede hacer es tratar todos esos frenos igual —
  // publicable.js#clasificarMotivos los parte en dos y aca se usan distinto:
  //
  //   · SOLO PUBLICACION (zona, puntaje, sync viejo, plazo, amoblado sin
  //     confirmar, campos faltantes): la propiedad SIGUE en la lista de la
  //     asesora, con su reparo al lado. Ella es exactamente quien resuelve
  //     eso. Es el invariante de src/groups/ubicacion.js:134-137 — un match
  //     `otra_zona` entra al aviso A PROPOSITO, con su aclaracion ("queda en
  //     Belén, no en Laureles"). Esconderselo le borraba la lista entera en
  //     dos casos muy comunes: un pedido sin barrio (todo grada `ciudad`) y
  //     una caida del sync de Wasi (todo `sync_viejo`), justo el dia en que
  //     el respaldo humano mas importa.
  //   · NUNCA OFRECER (precio corrupto o ausente, inventario ajeno, ref
  //     bloqueada a mano, link que no abre): eso no se ofrece ni por mano de
  //     la asesora. Va al bloque ⛔ de apartadas, con su razon.
  //
  // `utilesSofi` (aprobado por Sofi, solo sin lo bloqueado a mano) sigue
  // siendo distinto de `utiles` (lo ofrecible) a proposito: el primero dice
  // si HUBO aprobacion, el segundo dice si hay algo que mandar.
  const clasePorRef = new Map(
    (descartadosCalidad || []).map((d) => [String(d.ref).trim().toUpperCase(), clasificarMotivos(d.motivos || [])])
  );
  const claseDe = (ref) => clasePorRef.get(String(ref).trim().toUpperCase()) || null;
  const nuncaOfrecer = (ref) => {
    const c = claseDe(ref);
    return Boolean(c && c.nuncaOfrecer.length);
  };
  // El reparo para la asesora: la traduccion de publicable.js, la misma que ya
  // existe. `explicarMotivosSeguro` y no `explicarMotivos` para que un motivo
  // sin traducir se calle en vez de llegarle crudo a una persona.
  const reparoDe = (ref) => {
    const c = claseDe(ref);
    return c && c.soloPublicacion.length ? explicarMotivosSeguro(c.soloPublicacion) : null;
  };

  const refsBloqueadasDelAviso = [...refsUtiles, ...refsDudosas].map(String).filter(bloqueada);
  const utilesSofi = refsUtiles.filter((ref) => !bloqueada(ref));
  const refsCalidadDescartada = utilesSofi.map(String).filter(nuncaOfrecer);
  const refsApartadas = [...refsBloqueadasDelAviso, ...refsCalidadDescartada];

  const utiles = utilesSofi
    .filter((ref) => !nuncaOfrecer(ref))
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);

  // Lo que el colega tiene que leer DENTRO del borrador, por ref. Se calcula
  // aca (no en el bloque de reenvio) porque es el mismo dato que alimenta la
  // salvedad de la ficha: una sola fuente, dos redacciones.
  const aclaracionesColega = new Map();
  for (const m of utiles) {
    const c = claseDe(m.ref);
    const texto = c && c.soloPublicacion.length ? aclaracionParaColega(c.soloPublicacion) : null;
    if (texto) aclaracionesColega.set(String(m.ref), texto);
  }
  // Para revisar (Juan, 2026-09-01): refs_dudosas de revalidar.js -- Sofi no
  // las aprueba para el envio normal, pero tampoco las descarta del todo.
  // Van SOLO al asesor, nunca al colega.
  const dudosas = refsDudosas
    .filter((ref) => !bloqueada(ref))
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  // `refsApartadas.length` en la condicion: si TODO lo que habia estaba
  // bloqueado o descartado por calidad, el aviso tiene que salir igual — es
  // justo el caso en que la asesora necesita saber que teniamos algo y por
  // que no se puede ofrecer.
  if (utiles.length === 0 && dudosas.length === 0 && refsApartadas.length === 0) return null;

  const quien = senal.autor_nombre || "un colega";
  const contactoTexto = contactoPara(telefonoColega, senal.autor_telefono, quien, senal.texto_original);

  const busca = queBusca(senal);
  // `utilesSofi.length > 0`, NO `utiles.length > 0` (fix critico): "hay algo
  // aprobado por Sofi" no es lo mismo que "hay algo ofrecible". Si se usara
  // `utiles` aca, el caso de arriba (todo aprobado, todo descartado por
  // calidad) caeria en la rama de "Sofi no aprobó ninguna del todo" -- falso,
  // Sofi SI aprobo, la compuerta fue la que freno.
  const porque = porqueNoSalioSolo(motivoDm, utilesSofi.length > 0);

  // Aprobada y sin salir es otra categoria de mensaje, y se tiene que ver
  // desde la primera linea sin leer el resto. AQUI SE MIDE LO OFRECIBLE, NO
  // LA APROBACION DE SOFI (Minor, 2026-09-07): el encabezado le ORDENA
  // escribirle al colega YA, y esa orden no puede encabezar un cuerpo que no
  // tiene nada confirmable que mandarle. Si Sofi aprobo pero todo quedo
  // apartado por dato corrupto, el aviso sale como oportunidad normal y el
  // bloque ⛔ explica que paso — el "Por qué no salió solo" sigue midiendose
  // contra `utilesSofi` unas lineas mas arriba, porque ahi la pregunta es
  // otra: si Sofi aprobo o no.
  const aprobadaSinSalir = utiles.length > 0 && Boolean(porque);
  const cabecera = [
    aprobadaSinSalir ? `🚨🚨 OPORTUNIDAD APROBADA — el bot NO pudo escribirle al colega` : `🎯 Oportunidad en un grupo`,
    ``,
    `Grupo: ${senal.grupo_nombre || "sin nombre"}`,
    `Colega: ${quien}`,
    `Contacto: ${contactoTexto}`,
    // El link (Juan, 2026-09-02, opcion D): arriba, antes del pedido, para
    // que sea lo primero que toca. Lo esencial sigue inline: si un dia no le
    // abre, no pierde el negocio por una metrica.
    ...(link ? [``, `👉 Ver la oportunidad: ${link}`] : []),
    ...(porque ? [``, `Por qué no salió solo: ${porque}`] : []),
    ...(busca ? [``, `Busca: ${busca}`] : []),
    ``,
    busca ? `Lo escribió así:` : `Pidió:`,
    `"${(senal.texto_original || "").trim()}"`,
  ];

  // Tope de longitud (Juan, 2026-09-01): con `compacto=true` se reemplaza el
  // listado completo por una linea de conteo -- las mismas propiedades ya
  // van completas mas abajo, en el mensaje para reenviar. Nunca se pierde
  // informacion, solo se deja de repetirla dos veces.
  function bloqueUtiles(compacto) {
    if (!utiles.length) return [];
    if (compacto) {
      const plural = utiles.length === 1 ? "" : "es";
      const verbo = utiles.length === 1 ? "puede" : "pueden";
      return [``, `Le ${verbo} servir ${utiles.length} propiedad${plural} — el detalle completo va más abajo, en el mensaje listo para reenviar.`];
    }
    return [
      ``,
      utiles.length === 1 ? `Le puede servir:` : `Le pueden servir:`,
      utiles.map((m) => linea(m, reparoDe(m.ref))).join("\n"),
    ];
  }

  const bloqueDudosas = dudosas.length
    ? [
        ``,
        utiles.length
          ? `🔎 Para revisar (no confirmadas — decidí vos si vale la pena llamar al colega):`
          : `🔎 Para revisar (nada confirmado del todo — decidí vos si vale la pena llamar al colega):`,
        dudosas.map((m) => linea(m)).join("\n"),
      ]
    : [];

  // Lo apartado, con su razon. Va DESPUES de lo ofrecible y antes del veredicto
  // de Sofi: la asesora primero ve con que puede trabajar, y despues por que
  // una quedo afuera.
  const bloqueApartadas = [];
  if (refsBloqueadasDelAviso.length) {
    bloqueApartadas.push(
      ``,
      `⛔ ${refsBloqueadasDelAviso.map((r) => `Ref ${r}`).join(", ")} también calza, pero tiene un dato mal cargado en Wasi — no la ofrezcas hasta que se corrija.`
    );
  }
  // Cada ref de la compuerta de calidad lleva SU PROPIA razon (fix critico):
  // publicable.js puede frenar refs distintas por motivos distintos (una por
  // precio corrupto, otra por link caido), asi que agruparlas bajo un solo
  // texto generico -- como arriba, para REFS_BLOQUEADAS -- inventaria una
  // razon que no aplica a todas. `explicarMotivosSeguro` es la MISMA
  // traduccion que ya usa publicable.js: no se copia el texto aca.
  //
  // SOLO LOS MOTIVOS DE "NUNCA OFRECER" llegan a este bloque; los de
  // publicacion se muestran junto a la propiedad, que sigue ofrecible.
  //
  // Y CON EL MISMO CANDADO QUE `porqueNoSalioSolo` (Minor, 2026-09-07): un
  // motivo sin traduccion no puede salir crudo hacia una persona. Antes esta
  // linea llamaba a explicarMotivos sin guardia y un identificador nuevo
  // habria terminado escrito en el WhatsApp de Natalia. Sin traduccion, la
  // ref se aparta igual -- eso nunca se calla -- solo que sin razon inventada.
  for (const ref of refsCalidadDescartada) {
    const clase = claseDe(ref);
    const razon = explicarMotivosSeguro((clase && clase.nuncaOfrecer) || []);
    bloqueApartadas.push(
      ``,
      razon
        ? `⛔ Ref ${ref} también calza, pero ${razon} — no la ofrezcas hasta confirmar con el colega.`
        : `⛔ Ref ${ref} también calza, pero la compuerta de calidad la apartó — no la ofrezcas hasta confirmar con el colega.`
    );
  }

  const sofiDice = [``, `Sofi dice: ${veredicto.por_que}`];

  // Mensaje listo para reenviar (Juan, 2026-09-01): sin telefono resuelto,
  // nadie mas que un humano puede escribirle al colega -- se le entrega el
  // texto YA armado. Con telefono resuelto no hace falta: la asesora ya
  // tiene el link directo al privado arriba, en `Contacto:`.
  const mensajeListo = utiles.length > 0 && !telefonoResuelto(telefonoColega, senal.autor_telefono)
    ? mensajeListoParaReenviar(senal, veredicto, utiles, org, aclaracionesColega)
    : null;
  const bloqueReenviar = mensajeListo
    ? [
        ``,
        `⚡ No se pudo resolver su número — mandale ESTO YA por su privado (tocá su nombre arriba para abrirle el chat):`,
        ``,
        mensajeListo,
      ]
    : [];

  // Sin invitacion duplicada (Juan, 2026-09-01): el mensaje para reenviar YA
  // trae su propia invitacion a escribirle a Sofi (viene de
  // redactar.js#mensajeGrupo). Agregarla aparte fue justo lo que hizo que un
  // aviso de 6 propiedades pasara el limite de 4096 caracteres de Meta.
  const linkSofi = mensajeListo ? null : linkContactoOficial(org);
  const bloqueSofi = linkSofi
    ? [
        ``,
        `Para que la conversación quede en nuestro sistema, cerrale invitándolo a escribirle a Sofi (nuestra línea oficial):`,
        linkSofi,
      ]
    : [];

  const cierre = [``, `Contame en qué quedó (la llamaste, no servía, ya se vendió). Con eso el radar aprende.`];

  // ENCABEZADO DEL CARRIL (Juan, 2026-09-07): "un mensaje diferenciado que
  // sepa que es de amoblados". Natalia recibe avisos de venta todo el dia; sin
  // esto, uno de arriendo se lee igual que los demas y se trata igual.
  //
  // Va DENTRO de armar y no pegado al return para que lo cuente el clamp de
  // 4096 caracteres de Meta, y para que salga igual en la version compacta.
  const encabezado = carrilAmoblados ? ["🛋️ *AMOBLADOS* — pedido que no salió solo", ``] : [];

  const armar = (compacto) =>
    [...encabezado, ...cabecera, ...bloqueUtiles(compacto), ...bloqueDudosas, ...bloqueApartadas, ...sofiDice, ...bloqueReenviar, ...bloqueSofi, ...cierre].join("\n");

  const completo = armar(false);
  // Margen de seguridad bajo el limite real de Meta (4096). Solo tiene
  // sentido comprimir si el mensaje para reenviar esta presente -- es la
  // unica fuente de la duplicacion de datos que este tope existe para evitar.
  if (completo.length > 4000 && mensajeListo) return clamp(armar(true));
  return clamp(completo);
}

// Ultimo cinturon de seguridad (Juan, 2026-09-01, revision post-review): la
// compresion de arriba (`armar(true)`) solo reduce el listado repetido de
// propiedades -- no toca `texto_original` (lo que escribio el colega, texto
// libre sin tope) ni `veredicto.por_que` (salida de la IA, tampoco acotada).
// En el peor caso ambos son largos y el mensaje YA comprimido sigue pasando
// los 4096 caracteres que exige Meta. Mismo patron que el tope de 1024 del
// mensaje interactivo en src/groups/vivo.js (avisoCercano): un recorte
// silencioso es preferible a que Meta rechace el envio entero.
function clamp(texto) {
  if (texto.length <= 4096) return texto;
  const sufijo = `\n\n(recortado — ver el pedido completo en el CRM)`;
  return `${texto.slice(0, 4096 - sufijo.length)}${sufijo}`;
}

// Aviso liviano post-DM (Juan, 2026-09-01): el DM directo al colega SI salio,
// pero el mismo pedido tenia propiedades dudosas que no se mandaron -- antes
// esto se perdia en silencio ("no tiene nada que hacer" solo es cierto si no
// queda nada pendiente). Deliberadamente separada de construir(): la forma es
// distinta, no hace falta el texto completo del pedido.
//
// CON CONTACTO (Juan, 2026-09-01): si la asesora decide que SI vale la pena
// mandar una dudosa, tiene que poder hacerlo sin volver al grupo a buscar
// quien la pidio -- mismo contactoPara() que usa construir(), con el mismo
// fallback (tocar el nombre en el grupo) cuando no hay telefono resuelto:
// nunca se pierde el lead por falta de un link.
//
// QUE PIDIO Y POR QUE NO SE MANDARON (Juan, 2026-09-05, sobre un aviso real
// a Natalia por el pedido de Projency Inmobiliaria): "en este mensaje no le
// estas diciendo que pedido esta haciendo el colega ni la explicacion de por
// que no se le enviaron los otros". La asesora tenia que decidir si llamar
// por una dudosa sin saber que buscaba el colega ni que le vio Sofi de raro.
// Los dos datos ya existian: el pedido lo trae la señal (mismos campos que
// construir() recibe, y el mismo queBusca() los resume) y la razon esta en
// veredicto.por_que. Solo faltaba ponerlos en este mensaje.
//
// @param senal          autor_nombre, grupo_nombre, autor_telefono, texto_original
//                       y los campos del clasificado (los mismos que construir()).
//                       Todos opcionales menos autor_nombre: sin ellos el aviso
//                       sale sin la linea correspondiente, nunca con un hueco.
// @param veredicto      lo que devolvio revalidar.js
// @param matches        las candidatas (para resolver las refs a fichas completas)
// @param refsEnviadas   array de refs que SI se mandaron por DM (utiles.map(m => m.ref))
// @param telefonoColega telefono ya resuelto por el directorio (mismo que recibio el DM), o null
// @returns el texto del aviso, o null si no hay refs_dudosas
function construirAvisoPostDm(senal, veredicto, matches, refsEnviadas, telefonoColega = null) {
  const dudosas = (veredicto && Array.isArray(veredicto.refs_dudosas) ? veredicto.refs_dudosas : [])
    .map((ref) => (matches || []).find((m) => String(m.ref) === String(ref)))
    .filter(Boolean);
  if (dudosas.length === 0) return null;

  const s = senal || {};
  const quien = s.autor_nombre || "un colega";
  const grupo = s.grupo_nombre || "sin nombre";
  const contactoTexto = contactoPara(telefonoColega, s.autor_telefono, quien, s.texto_original);
  const enviadas = (refsEnviadas || []).filter(Boolean);
  const detalleEnviadas = enviadas.length ? `: ${enviadas.map((r) => `Ref ${r}`).join(", ")}` : ".";

  // El pedido, igual que en construir(): resumen del clasificador y, debajo,
  // lo que escribio el colega tal cual. Cada linea solo si hay con que.
  const busca = queBusca(s);
  const textoOriginal = String(s.texto_original || "").trim();
  const bloquePedido = [
    ...(busca ? [``, `Busca: ${busca}`] : []),
    ...(textoOriginal ? [``, busca ? `Lo escribió así:` : `Pidió:`, `"${textoOriginal}"`] : []),
  ];

  // Por que estas no salieron solas: es el veredicto de Sofi sobre el lote
  // entero, la misma linea "Sofi dice" del aviso normal. Si algun dia el
  // veredicto trae un motivo por ref, va aca; hoy por_que es lo que hay.
  const porQue = String((veredicto && veredicto.por_que) || "").trim();
  const bloquePorQue = porQue ? [``, `Por qué no se las mandé: ${porQue}`] : [];

  const lineas = [
    `✅ Ya le mandé por privado a ${quien}${detalleEnviadas}`,
    ``,
    `Grupo: ${grupo}`,
    `Contacto: ${contactoTexto}`,
    ...bloquePedido,
    ``,
    `🔎 Esto otro quedó sin mandar (no confirmado) — decidí vos si vale la pena:`,
    dudosas.map((m) => linea(m)).join("\n"),
    ...bloquePorQue,
  ];
  return clamp(lineas.join("\n"));
}

module.exports = { construir, construirAvisoPostDm, linea, porqueNoSalioSolo };

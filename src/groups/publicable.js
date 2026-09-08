// Compuerta de calidad: decide si una propiedad puede salir en un mensaje
// publico dentro de un grupo gremial.
//
// Por que existe: un mensaje en un grupo de 80 inmobiliarias competidoras se ve
// una vez y no se borra. La auditoria del 2026-08-16 encontro TRES caminos
// abiertos para publicar un dato falso, todos sin fallar ruidosamente:
//
//   1. La ref 9921388 tiene precio errado en Wasi (pendiente hace semanas) y
//      su titulo dice "Urbanizacion Santa Ana" mientras el link apunta a
//      "loma-de-los-balsos". Un colega de El Poblado lo ve en dos segundos.
//   2. Los precios en "$0" (label vacio en Wasi) se parseaban a 0, que es
//      falsy: burlaban el filtro de presupuesto y se ofrecian sin precio.
//   3. Una propiedad vendida cuyo `link` no sea de Wasi NUNCA se marca como no
//      disponible (dmap/src/sync/wasi-api.source.ts:271-279 exige que el link
//      matchee /info\.wasi\.co|\.inmo\.co/). Queda disponible para siempre.
//
// El criterio es deliberadamente severo: ante la duda, NO se publica. Perder un
// match es gratis; publicar un disparate cuesta la reputacion, y la reputacion
// no la protege ninguna linea desechable.

const formato = require("../lib/formato");

// Score minimo para publicar. Ojo con leer este numero como un porcentaje: la
// escala de match.js NO va de 0 a 100, va de 55 a 100. Un match ya pasó TODAS
// las compuertas duras (operacion, tipo, token exacto de zona, banda de precio)
// solo para existir con 55. Los puntos de arriba premian cuanto del pedido se
// pudo VERIFICAR, no cuanto mejor es la propiedad.
//
// Medido contra el inventario real el 2026-08-16 (108 propiedades disponibles):
//   · Techo observado sin pedir alcobas: 73  (55 + 10 presupuesto + 8 area)
//   · Techo observado pidiendo alcobas:  83  (+10)
//   · garaje sincronizado en 29/108, estrato en 33/108 → esos puntos casi nunca
//     se pueden ganar, y el pedido del ejemplo ("con parqueadero") depende de
//     garaje.
// Con el umbral en 80 el bot quedaba mudo ante la demanda que motivo el modulo.
// 70 deja pasar los matches que cumplieron todo lo verificable; la calidad del
// DATO la garantizan las demas reglas de este archivo, no el puntaje.
// Se sube o baja con GRUPOS_RESPUESTA_UMBRAL sin tocar codigo ni redesplegar.
const UMBRAL_DEFAULT = Number(process.env.GRUPOS_RESPUESTA_UMBRAL || 70);

// Rangos sanos por operacion, en COP. No son limites de negocio sino detectores
// de dato corrupto: fuera de aqui, el numero casi seguro es un typo o el bug de
// digitos concatenados. Un garaje suelto ronda los 40M; el arriendo mas barato
// que publica una inmobiliaria formal no baja de ~300k.
const RANGOS = {
  venta: { min: 30_000_000, max: 100_000_000_000 },
  arriendo: { min: 300_000, max: 100_000_000 },
};

// Refs que no se publican aunque pasen todo lo demas. Se corrigen en Wasi y se
// sacan de aqui; mientras tanto, no salen.
const REFS_BLOQUEADAS = new Set(
  (process.env.GRUPOS_REFS_BLOQUEADAS || "9921388")
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean)
);

// El link SIEMPRE debe ser el de la landing propia. Mandar al colega a Wasi es
// regalarle la marca, y ademas delata de donde sale el inventario.
const DOMINIO_AJENO = /info\.wasi\.co|\.inmo\.co/i;

function rangoDe(operacion) {
  return String(operacion || "").toLowerCase().includes("arriendo") ? RANGOS.arriendo : RANGOS.venta;
}

// Devuelve { ok, motivos } — `motivos` lista TODO lo que falla, no solo lo
// primero, para poder auditar la calidad del inventario con una sola pasada.
function esPublicable(match, { umbral = UMBRAL_DEFAULT, syncFresco = true, refsBloqueadas = REFS_BLOQUEADAS } = {}) {
  const motivos = [];
  if (!match) return { ok: false, motivos: ["sin_match"] };

  // Nunca se publica inventario de un aliado: el aliado puede estar leyendo ese
  // mismo grupo, y Diamond quedaria de intermediaria en un negocio ajeno.
  if (match.fuente !== "diamond") motivos.push("no_es_inventario_propio");

  // AQUI SE CONSERVA LA LECCION DE JULIO. Desde el 2026-08-18 la zona dejo de
  // ser compuerta en match.js: una propiedad de otro barrio entra marcada como
  // `otra_zona` para que Sofi pueda razonar si le sirve al cliente.
  //
  // Eso vale para el AVISO a la asesora, que pasa por Sofi y por una persona.
  // Para PUBLICAR en un grupo gremial NO: ahi no hay nadie revisando, y ofrecer
  // Robledo a quien pidio Laureles delante de 80 competidores es exactamente el
  // falso positivo que costo 656 de 731 matches en julio.
  //
  // Se aceptan `exacta` y `vecina` —contigüidad real, declarada en
  // src/lib/zonas.js— y nada mas. `ciudad` tampoco: un pedido sin barrio no
  // habilita a publicar media Medellin.
  if (match.ubicacion && !["exacta", "vecina"].includes(match.ubicacion)) {
    motivos.push("zona_no_publicable");
  }

  // AMOBLADO SIN CONFIRMAR (2026-09-07). Wasi solo dice "Amoblado" en el
  // titulo, asi que hay propiedades de las que no lo sabemos. Cuando el colega
  // lo pidio explicitamente, eso NO puede salir solo: ofrecerle un vacio a
  // quien pidio amoblado es el mismo tipo de dato no verificable que frena
  // `edificio_especifico` en politica.js.
  //
  // No se pierde el pedido: la senal llega igual al aviso de la asesora, con
  // este motivo traducido. Es la talla explicita a la regla D7 (lo no
  // registrado se ofrece con sin_confirmar) y vive ACA, en codigo, y no como
  // una frase opuesta dentro del prompt de revalidar.js -- que es como se
  // construyo la contradiccion que encontro la auditoria del 2026-09-05.
  if (match.amoblado_sin_confirmar) motivos.push("amoblado_sin_confirmar");

  // PLAZO NO SOPORTADO (2026-09-07). Nuestro inventario esta cotizado por mes.
  // "$4.500.000 por 15 dias" calza perfecto contra un amoblado mensual del
  // mismo precio, y le ofreceriamos un mes por el precio de quince dias.
  if (match.periodo_no_soportado) motivos.push("periodo_no_soportado");

  if (!(Number(match.puntaje) >= umbral)) motivos.push("puntaje_bajo");

  const ref = String(match.ref || "").trim();
  if (!ref) motivos.push("sin_ref");
  else if (refsBloqueadas.has(ref.toUpperCase())) motivos.push("ref_bloqueada");

  if (!formato.normalizarTitulo(match.titulo)) motivos.push("sin_titulo");

  const precio = formato.parsearPrecio(match.precio);
  if (precio === null) {
    motivos.push("sin_precio");
  } else {
    const rango = rangoDe(match.operacion);
    if (precio < rango.min || precio > rango.max) motivos.push("precio_fuera_de_rango");
  }

  if (!String(match.zona || "").trim()) motivos.push("sin_zona");
  if (formato.parsearArea(match.area) === null) motivos.push("sin_area");

  const link = String(match.link || "").trim();
  if (!link) motivos.push("sin_link");
  else if (DOMINIO_AJENO.test(link)) motivos.push("link_ajeno");

  // El mensaje que de verdad se publica usa linkWasi, no `link` (Juan,
  // 2026-08-18 — ver la nota de diseño en redactar.js). `withLandingLink`
  // siempre arma un `link` propio aunque Wasi no haya traido ninguno, asi
  // que validar solo `link` no alcanza: sin esto, una propiedad sin link de
  // Wasi pasaria la compuerta y saldria al grupo con un renglon vacio.
  if (!String(match.linkWasi || "").trim()) motivos.push("sin_link_wasi");

  // Si el sync de Wasi esta detenido, todo el inventario es sospechoso: no se
  // sabe que se vendio desde entonces. DMAP ya se detuvo 16 dias sin que nadie
  // se enterara (auditoria del 2026-08-01).
  if (!syncFresco) motivos.push("sync_viejo");

  return { ok: motivos.length === 0, motivos };
}

// Filtra una lista de matches y devuelve los publicables (ya ordenados por
// puntaje) mas el detalle de los descartes, que sirve para auditar por que un
// pedido no se respondio.
//
// SIN TOPE por defecto (Juan, 2026-08-20): antes se cortaba en 3 aca mismo,
// antes de que redactar.js pudiera decidir nada. Ahora se manda TODO lo que
// paso la compuerta de calidad — es ella la que decide "esto es bueno", no
// un limite fijo de cantidad. `matches` ya viene acotado a 6 candidatas desde
// match.js#cruzarDemanda, asi que el techo real sigue existiendo, solo que
// no es un numero arbitrario despues de filtrar por calidad.
function filtrar(matches, opciones = {}) {
  const limite = opciones.limite || Infinity;
  const publicables = [];
  const descartados = [];

  for (const m of matches || []) {
    const veredicto = esPublicable(m, opciones);
    if (veredicto.ok) publicables.push(m);
    else descartados.push({ ref: m && m.ref, motivos: veredicto.motivos });
  }

  publicables.sort((a, b) => Number(b.puntaje) - Number(a.puntaje));
  return { publicables: publicables.slice(0, limite), descartados };
}

// QUE SIGNIFICA CADA MOTIVO, EN CASTELLANO (Juan, 2026-09-06).
//
// BUG REAL. Juan le pidio a Sofi que le mandara al colega la 9921388, la de
// Loma de los Balsos, que era la que mejor calzaba. No salio, y Sofi le
// contesto que el colega "no tiene telefono registrado en el sistema". Eso era
// falso por partida doble: el DM a ese colega YA habia salido esa mañana por
// lid (politica_traza: destino:lid), y la razon real de que esa ref no fuera
// era otra — esta en esta lista: ref_bloqueada.
//
// Los motivos son identificadores para el codigo. Cuando salen hacia una
// persona tienen que decir algo que esa persona pueda ACCIONAR, y sobre todo
// tienen que salir: un motivo que no se traduce es un motivo que quien lo lea
// va a reemplazar por una explicacion inventada.
//
// CON TILDES (2026-09-07). Estos textos dejaron de ser solo de auditoria: se
// imprimen al lado de la propiedad en el aviso que lee Natalia. El codigo de
// este repo se comenta sin tildes; lo que sale hacia una persona, no.
const MOTIVOS_LEGIBLES = {
  ref_bloqueada: "está apartada a propósito porque tiene un dato mal cargado en Wasi (GRUPOS_REFS_BLOQUEADAS). Se corrige en Wasi y se saca de la lista; mientras tanto no sale a ningún colega",
  no_es_inventario_propio: "es de la red de aliados, no es nuestra: no se ofrece en el gremio",
  zona_no_publicable: "la zona no calza con lo que pidió el colega — mirá si igual le sirve",
  amoblado_sin_confirmar: "el colega pidió amoblado y no tenemos confirmado que ésta lo esté: Wasi sólo lo dice en el título y esta ficha no lo trae",
  periodo_no_soportado: "el pedido es por días o semanas y nuestro inventario está cotizado por mes",
  puntaje_bajo: "el puntaje quedó por debajo del umbral para salir sola",
  sin_ref: "no tiene referencia",
  sin_titulo: "no tiene título cargado",
  sin_precio: "no tiene precio cargado",
  precio_fuera_de_rango: "el precio está fuera de rango sano: casi seguro es un dato corrupto en Wasi",
  sin_zona: "no tiene zona cargada",
  sin_area: "no tiene área cargada",
  sin_link: "no tiene link propio",
  link_ajeno: "el link apunta a un dominio que no es el nuestro",
  sin_link_wasi: "no tiene link de Wasi para verificar",
  link_no_abre: "el link no abre",
  sync_viejo: "el sync de Wasi está viejo, así que el dato puede no ser el actual",
};

// Traduce una lista de motivos. Un motivo que no este en el mapa se devuelve
// crudo: es preferible un identificador feo a que quien lo lea no reciba nada.
function explicarMotivos(motivos) {
  return (motivos || []).map((m) => MOTIVOS_LEGIBLES[m] || m).join("; ");
}

// Igual que explicarMotivos pero NUNCA devuelve un identificador crudo: si
// ninguno de los motivos tiene traduccion, devuelve null y quien llama decide
// que decir. Se usa en todo lo que sale HACIA UNA PERSONA.
//
// Por que hacen falta las dos (Juan, 2026-09-06): explicarMotivos existe para
// auditar (un identificador feo es mejor que un hueco en un log). Un aviso a
// la asesora es otra cosa: "amoblado_sin_confirmar" en medio de una frase en
// castellano no se lee como un motivo, se lee como un error del sistema, y
// quien lo lea va a reemplazarlo por una explicacion inventada — que es
// exactamente el bug que cerro el commit b0f62ea.
function explicarMotivosSeguro(motivos) {
  const conocidos = (motivos || []).filter((m) => MOTIVOS_LEGIBLES[m]);
  return conocidos.length ? explicarMotivos(conocidos) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// LAS DOS CLASES DE "NO" (Juan, 2026-09-07). No son la misma cosa y tratarlas
// igual costo una regresion en el carril de venta, que es el que esta vivo.
//
// Este archivo responde UNA pregunta: "¿esto puede salir SOLO, a un grupo de
// 80 competidores, sin que nadie lo revise?". La respuesta "no" tiene dos
// causas muy distintas:
//
//   1. NO SE PUEDE PUBLICAR SIN SUPERVISION. La propiedad es real y el dato es
//      nuestro; lo que falta es criterio humano — la zona no es la pedida, el
//      puntaje no alcanza para salir sola, el sync viene atrasado, el plazo
//      del pedido es por dias, no sabemos si esta amoblada, falta un campo de
//      la ficha. UNA PERSONA ES EXACTAMENTE QUIEN RESUELVE ESO. Esconderselo
//      es quitarle el negocio que el modulo existe para encontrar.
//   2. NUNCA SE OFRECE, NI SIQUIERA A UNA PERSONA. El dato esta corrupto
//      (precio fuera de rango, sin precio), la propiedad es ajena
//      (no_es_inventario_propio, link_ajeno), esta apartada a mano
//      (ref_bloqueada) o el link no abre. Ahi no hay juicio que aplicar: es
//      basura, y ofrecerla es el mismo error se lo mande el bot o la asesora.
//
// EL INVARIANTE QUE ESTO PROTEGE vive en src/groups/ubicacion.js:134-137 y en
// la nota de `zona_no_publicable` de este mismo archivo: desde el 2026-08-18
// la zona dejo de ser compuerta en match.js, y un match `otra_zona` ENTRA AL
// AVISO DE LA ASESORA A PROPOSITO, con su aclaracion al lado ("queda en Belén,
// no en Laureles"). El aviso pasa por Sofi y por una persona; el grupo no.
// Tratar `zona_no_publicable` como "nunca se ofrece" borraba de la lista de
// Natalia justo esas propiedades — y con dos multiplicadores: un pedido sin
// barrio grada TODO como `ciudad`, asi que perdia la lista entera detras de
// una razon falsa; y con el sync de Wasi caido `sync_viejo` descartaba todo,
// convirtiendo cada aviso en un muro de ⛔ el dia en que el respaldo humano
// mas importa.
//
// La clasificacion vive ACA, al lado de los motivos que describe, y no en
// cada llamador: si mañana se agrega un motivo, se decide su clase en el mismo
// lugar donde se decide que exista (lo fija test/motivos-legibles.test.js).
const MOTIVOS_SOLO_PUBLICACION = new Set([
  "zona_no_publicable",
  "puntaje_bajo",
  "sync_viejo",
  "periodo_no_soportado",
  "amoblado_sin_confirmar",
  "sin_area",
  "sin_zona",
  "sin_titulo",
  "sin_link",
  "sin_link_wasi",
]);

const MOTIVOS_NUNCA_OFRECER = new Set([
  "ref_bloqueada",
  "precio_fuera_de_rango",
  "no_es_inventario_propio",
  "link_ajeno",
  "link_no_abre",
  "sin_precio",
  // sin_ref / sin_match: no hay ficha que ofrecer ni con que identificarla.
  "sin_ref",
  "sin_match",
]);

// Parte los motivos de un descarte en las dos clases de arriba.
//
// Un motivo DESCONOCIDO cae en `nuncaOfrecer`, no en `soloPublicacion`: la
// regla de este archivo sigue siendo "ante la duda, no". Un motivo nuevo sin
// clasificar se comporta como el caso severo hasta que alguien lo decida, y
// el test de motivos-legibles lo hace notar antes de que llegue a produccion.
function clasificarMotivos(motivos) {
  const lista = (motivos || []).filter(Boolean);
  const soloPublicacion = lista.filter((m) => MOTIVOS_SOLO_PUBLICACION.has(m));
  const nuncaOfrecer = lista.filter((m) => !MOTIVOS_SOLO_PUBLICACION.has(m));
  return { soloPublicacion, nuncaOfrecer, ofrecible: nuncaOfrecer.length === 0 };
}

// LA MISMA SALVEDAD, PERO DICHA AL COLEGA (Juan, 2026-09-07): "el borrador
// listo para reenviar lleva esa misma aclaracion adentro". MOTIVOS_LEGIBLES
// esta redactado para la asesora y habla DEL colega en tercera persona ("el
// colega pidió amoblado"); pegarlo tal cual en el mensaje que ella le reenvia
// a el se leeria como una nota interna filtrada. Estos textos son los mismos
// hechos, dichos de frente y en positivo, y entran por el MISMO canal que ya
// usa la aclaracion de zona: `le_falta` -> redactar.js#ficha -> "Aclaración:".
//
// `null` significa "no hay nada honesto que aclararle al colega por este
// motivo", no "se omite":
//   · zona_no_publicable — la aclaracion de zona ya la CALCULA
//     redactar.js#desvios contra el pedido real ("queda en Belén, no en
//     Laureles"); repetirla aca imprimiria lo mismo dos veces en la misma
//     linea. Y cuando el pedido no nombro barrio (grado `ciudad`) no hay
//     desvio que aclarar: no se le puede decir "no queda donde pediste" a
//     quien no pidio ninguna zona.
//   · sin_link_wasi — esa ref nunca llega al borrador: mensajeListoParaReenviar
//     filtra por linkWasi antes de armar nada.
const ACLARACIONES_COLEGA = {
  zona_no_publicable: null,
  puntaje_bajo: "no pude verificar todo lo que pediste — confirmame lo que te falte",
  sync_viejo: "confirmame disponibilidad antes de mostrarla",
  periodo_no_soportado: "está cotizada por mes, no por días ni semanas",
  amoblado_sin_confirmar: "no tengo confirmado que esté amoblada",
  sin_area: "no tengo el área registrada",
  sin_zona: "no tengo la zona registrada",
  sin_titulo: "el nombre puede estar incompleto en mi sistema",
  sin_link: "no tengo ficha propia cargada todavía",
  sin_link_wasi: null,
};

// La aclaracion que va DENTRO del borrador que la asesora le reenvia al
// colega, o null si no hay ninguna. Solo mira los motivos de publicacion: uno
// de la otra clase nunca llega hasta aca porque esa ref no se ofrece.
function aclaracionParaColega(motivos) {
  const textos = (motivos || []).map((m) => ACLARACIONES_COLEGA[m]).filter(Boolean);
  return textos.length ? [...new Set(textos)].join(" · ") : null;
}

module.exports = {
  esPublicable,
  filtrar,
  UMBRAL_DEFAULT,
  RANGOS,
  REFS_BLOQUEADAS,
  MOTIVOS_LEGIBLES,
  explicarMotivos,
  explicarMotivosSeguro,
  MOTIVOS_SOLO_PUBLICACION,
  MOTIVOS_NUNCA_OFRECER,
  clasificarMotivos,
  ACLARACIONES_COLEGA,
  aclaracionParaColega,
};

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
  // Se aceptan `exacta` y `zona_general`, y nada mas. `ciudad` tampoco: un
  // pedido sin barrio no habilita a publicar media Medellin.
  // "zona_general" (2026-09-14): la propiedad esta en la zona general del
  // barrio pedido (Envigado para "Barrio Mesa") y el barrio exacto no esta
  // registrado. Se ofrece, y el mensaje al colega lo dice.
  //
  // LA VECINA TAMPOCO (Juan, 2026-09-18). Hasta hoy `vecina` publicaba: la
  // contigüidad esta declarada en src/lib/zonas.js y se consideraba
  // informacion geografica real. El 18-sep a las 11:00 a. m. un colega que
  // pidio "apartamento Envigado $400.000.000" recibio la ref 10012722, que
  // esta en ITAGUI, con la salvedad impresa en la propia ficha ("Aclaracion:
  // queda en Itagui, vecina de Envigado") — el sistema sabia que no era lo
  // pedido y lo mando igual. Su respuesta: "Me dice Itagui y solo quiere
  // Envigado". Medido sobre el mes anterior, 213 de las 717 fichas enviadas
  // (30%) salieron por esta regla, y esa misma propiedad le llego a pedidos de
  // Envigado el 16, el 17 y el 18.
  //
  // Motivo PROPIO y no `zona_no_publicable`: son dos hechos distintos —"queda
  // al lado" y "queda en cualquier otra parte"— y la asesora decide distinto
  // con cada uno. VECINDAD en src/lib/zonas.js no se toca: es lo que hace que
  // el prefiltro SQL traiga las subzonas al motor.
  //
  // Y ZONA_GENERAL TAMPOCO (Juan, 2026-09-21). Un colega pidio "Envigado ·
  // Sector: Camino de las Aguas" y recibio la 10077063, de Barrio Mesa: su
  // respuesta fue "ajusta el Bot, para que el Match tenga un % mayor de
  // acertividad". `zona_general` es justo eso: la propiedad esta en el
  // municipio, pero no sabemos si en el sector que el colega pidio. Decision
  // de Juan: "literal, no sale sola". Motivo propio por la misma razon que la
  // vecina: "no se si es el sector" y "es otra zona" se deciden distinto.
  if (match.ubicacion === "vecina") {
    motivos.push("zona_vecina");
  } else if (match.ubicacion === "zona_general") {
    motivos.push("sector_sin_confirmar");
  } else if (match.ubicacion && match.ubicacion !== "exacta") {
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

  // PARQUEADERO SIN DATO (Juan, 2026-09-18). Mismo caso que el de arriba: el
  // colega lo pidio y la ficha de Wasi no trae el campo. La propiedad puede
  // tenerlo perfectamente -- 51 fichas del inventario estan asi -- pero eso lo
  // confirma una persona, no lo adivina el bot delante de 80 competidores.
  // El incumplimiento CONOCIDO (tiene 1, pidieron 2) ni siquiera llega hasta
  // aca: lo descarta match.js.
  if (match.garajes_sin_dato) motivos.push("garajes_sin_dato");

  // PISO SIN CONFIRMAR (Juan, 2026-09-18: "quiero que seas muy estricto con
  // los pedidos que exigen piso"). 255 de cada 1.000 pedidos lo exigen y 46 de
  // los 90 apartamentos del inventario no lo dicen en ninguna parte de su
  // ficha. Mandarle un piso desconocido a quien pidio "maximo segundo, sin
  // ascensor" es exactamente el mismo error que la zona vecina: no es una
  // preferencia, es un requisito que el cliente no puede negociar.
  if (match.piso_sin_confirmar) motivos.push("piso_sin_confirmar");
  // Pidio una unidad con nombre y la ficha no la nombra (2026-09-21). Mismo
  // hueco no verificable que el piso: no descarta, pero no sale sola.
  if (match.edificio_sin_confirmar) motivos.push("edificio_sin_confirmar");
  // RENTA SIN CONFIRMAR (Juan, 2026-09-22): "cuando no se tenga claridad si
  // esta alquilado o no, callar para no incomodar a los colegas". El pedido
  // "que este rentando entre 6 a 7 millones" recibio tres apartamentos cuyas
  // fichas no dicen nada de arriendo. Ver src/groups/rentada.js.
  if (match.rentada_sin_confirmar) motivos.push("rentada_sin_confirmar");

  // PLAZO NO SOPORTADO (2026-09-07). Nuestro inventario esta cotizado por mes.
  // "$4.500.000 por 15 dias" calza perfecto contra un amoblado mensual del
  // mismo precio, y le ofreceriamos un mes por el precio de quince dias.
  if (match.periodo_no_soportado) motivos.push("periodo_no_soportado");

  // AFINADO 2026-10-17. El mensaje traia varios pedidos numerados y el cruce
  // se hizo contra una mezcla de ellos; o el precio escrito en la ficha no
  // cuadra con el de Wasi. Los dos los decide una persona.
  if (match.varios_pedidos) motivos.push("varios_pedidos");
  if (match.precio_sin_confirmar) motivos.push("precio_sin_confirmar");

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

// LO QUE FALTA NO ES LO QUE NO CUMPLE (Juan, 2026-10-20). De los motivos de
// arriba, cuatro dicen "no tengo el dato" y no "el dato no calza": el barrio
// exacto dentro del municipio pedido, el piso, el parqueadero y el precio que
// no cuadra entre Wasi y la descripcion. Con RADAR_DM_CON_ACLARACION=true una
// ficha cuyos motivos son TODOS de esta lista sale al DM del colega con la
// aclaracion en la ficha ("no tengo registrado en qué piso está..."). Ningun
// otro motivo entra: la zona vecina no sale por aca (solo por la excepcion de
// zona cercana, ver dmZonaCercanaActivo, y sin exactas), y lo que se SABE y no cumple
// (piso 9 para quien pidio maximo 2, un parqueadero de menos) ni siquiera
// llega hasta aca -- lo descarta match.js.
//
// La decision vive en filtrar() y no en cada llamador: el DM automatico, los
// caminos manuales del CRM y el script de rescate tienen que dejar salir
// exactamente lo mismo.
const MOTIVOS_ACLARABLES = new Set([
  "sector_sin_confirmar",
  "piso_sin_confirmar",
  "garajes_sin_dato",
  "precio_sin_confirmar",
  // Area NO registrada (2026-10-21). Solo el dato ausente: un area conocida que
  // no llega al minimo (o pasa el techo) la descarta match.js antes de aqui.
  "sin_area",
]);

// Apagado por defecto: solo "true" lo enciende.
function dmConAclaracionActivo(env = process.env) {
  return String((env && env.RADAR_DM_CON_ACLARACION) || "").trim().toLowerCase() === "true";
}

// El precio por confirmar es aclarable si el precio de WASI cabe en el
// presupuesto del pedido (Juan, 2026-10-26: antes se exigia que cupieran LOS
// DOS, Wasi y descripcion, y 3 pedidos en 30 dias se quedaron sin DM por eso).
// La ficha sale con "te confirmo el precio final". Nunca si el de Wasi no
// cabe (`precio_wasi_en_margen === false`). Un match guardado antes de esa
// marca decide con la regla vieja (`precio_texto_en_margen`).
function precioAclarable(match) {
  if (!match) return false;
  if (match.precio_wasi_en_margen === false) return false;
  return match.precio_wasi_en_margen === true || match.precio_texto_en_margen === true;
}

function soloAclarables(motivos, match) {
  if (!Array.isArray(motivos) || motivos.length === 0) return false;
  if (!motivos.every((m) => MOTIVOS_ACLARABLES.has(m))) return false;
  if (motivos.includes("precio_sin_confirmar") && !precioAclarable(match)) return false;
  // El barrio solo es aclarable si de verdad no se sabe: si la ficha nombra
  // otro barrio conocido del municipio (match.js#barrio_en_ficha), decirle al
  // colega "el barrio exacto no lo tengo registrado" seria falso. Revision
  // final del rescate (2026-10-20): 10031500 "Via las Antillas" para un pedido
  // de Dorado/La Paz, 8989725 "Poblado Palmas" para San Lucas/Zuniga.
  if (motivos.includes("sector_sin_confirmar") && match && Array.isArray(match.barrio_en_ficha) && match.barrio_en_ficha.length) return false;
  return true;
}

// ZONA CERCANA (Juan, 2026-10-26: "necesito que hagamos todas las respuestas
// automaticas"). EXCEPCION a la regla literal del 2026-09-18 (ver la nota de
// `zona_vecina` en esPublicable), SOLO para el DM y SOLO cuando no quedo
// ninguna ficha exacta: si hay al menos una que encaja, la vecina no sale. Con
// RADAR_DM_ZONA_CERCANA=true una ficha cuyos motivos son `zona_vecina` (y, con
// RADAR_DM_CON_ACLARACION, ademas solo datos aclarables) sale DESPUES de todo
// lo demas, con "No es en {pedido}: queda en {zona}, cerca" por delante en la
// ficha (redactar.js#desvios). El caso del 18-sep ("Me dice Itagui y solo
// quiere Envigado") fue una vecina que salia AUNQUE habia exactas y con un
// texto que la vendia como si fuera lo pedido; esto la deja como ultima
// opcion, dicha de frente.
//
// Mismo trato para el barrio que la ficha nombra (sector_sin_confirmar con
// match.js#barrio_en_ficha): no se le puede decir "el barrio exacto no lo
// tengo registrado" (seria falso), asi que sale como zona cercana con el
// barrio nombrado: "queda en Antillas, Envigado".
//
// La zona lejana (`zona_no_publicable`) nunca entra aca.
function dmZonaCercanaActivo(env = process.env) {
  return String((env && env.RADAR_DM_ZONA_CERCANA) || "").trim().toLowerCase() === "true";
}

// Devuelve la marca que viaja en la copia del match ({ tipo: "vecina" } o
// { tipo: "barrio", barrio }) o null si la ficha no es una zona cercana.
function zonaCercanaDe(motivos, match, { conAclaracion = false } = {}) {
  if (!match || !Array.isArray(motivos)) return null;
  let motivoZona;
  let marca;
  if (motivos.includes("zona_vecina")) {
    motivoZona = "zona_vecina";
    marca = { tipo: "vecina" };
  } else if (motivos.includes("sector_sin_confirmar") && Array.isArray(match.barrio_en_ficha) && match.barrio_en_ficha.length) {
    motivoZona = "sector_sin_confirmar";
    marca = { tipo: "barrio", barrio: nombreDeBarrio(match.barrio_en_ficha[0], match) };
  } else {
    return null;
  }
  const resto = motivos.filter((m) => m !== motivoZona);
  if (resto.length === 0) return marca;
  return conAclaracion && soloAclarables(resto, match) ? marca : null;
}

// El barrio llega normalizado ("antillas"); se busca como lo escribe la ficha
// para no imprimir "antillas" ni perder la tilde ("Trianón").
function nombreDeBarrio(token, match) {
  const clave = normalizarTexto(token);
  const palabras = `${(match && match.titulo) || ""} ${(match && match.caracteristicas) || ""}`.split(/[^\p{L}]+/u);
  const tal = palabras.find((p) => p && normalizarTexto(p) === clave);
  if (tal) return tal.charAt(0).toUpperCase() + tal.slice(1).toLowerCase();
  return clave.charAt(0).toUpperCase() + clave.slice(1);
}

// FICHAS DUDOSAS (Juan, 2026-10-26; RADAR_DM_DUDOSAS). Cuando Sofi no aprobo
// ninguna pero marco dudosas, esas pasan por la MISMA filtrar() que las utiles
// (link, precio, sync, ref bloqueada... siguen duras) y salen al DM con la
// razon de Sofi como aclaracion de la ficha. 25 pedidos en 30 dias se quedaban
// sin DM por `solo_dudosas`.
//
// La razon se arma con lo que es POR REF y se puede decir al colega:
//   · lo que Sofi escribio en `le_falta` para esa ref (si escribio algo);
//   · los cortos del motor ("2 alcobas y pediste 3"), que es lo que hace a una
//     ref dudosa por cuenta (revalidar.js#cortosDe);
//   · el motivo tipado de `dudosas_motivo`, en tuteo.
// NUNCA `por_que`: lo escribe Sofi para la asesora, es del lote entero y puede
// traer voseo o nombres del equipo.
function dmDudosasActivo(env = process.env) {
  return String((env && env.RADAR_DM_DUDOSAS) || "").trim().toLowerCase() === "true";
}

// `zona_vecina_y_colega_tajante` NO sale: el colega escribio "solo" o
// "unicamente" esa zona, y es un requisito conocido que la ficha no cumple
// (el caso del 18-sep: "Me dice Itagui y solo quiere Envigado"). Medido el
// 2026-10-26: 1 de las 25 dudosas de 30 dias era de este tipo.
const DUDOSAS_QUE_NO_SALEN = new Set(["zona_vecina_y_colega_tajante", "aliado"]);

const TEXTO_DUDOSA = {
  de_fondo_dudoso: "no estoy seguro de que calce con todo lo que pediste: revísala antes de pasarla",
};
const DUDOSA_GENERICA = "no calza en todo lo que pediste: revísala antes de pasarla";

// Los cortos CONOCIDOS de una candidata, tal como los escribe el motor
// (match.js): cada razon con "(pediste N)" o "dentro del margen" es un dato
// real que no alcanza. revalidar.js la usa para la cuenta de las dudosas.
function cortosDe(m) {
  return (m && Array.isArray(m.razones) ? m.razones : []).filter((r) => /\(pediste |dentro del margen/.test(String(r)));
}

function dudosasParaDm(veredicto, matches) {
  const refs = veredicto && Array.isArray(veredicto.refs_dudosas) ? veredicto.refs_dudosas.map(String) : [];
  if (!refs.length) return { matches: [], leFalta: [] };
  const motivoDe = new Map(
    (Array.isArray(veredicto.dudosas_motivo) ? veredicto.dudosas_motivo : [])
      .filter((x) => x && x.ref)
      .map((x) => [String(x.ref), x.motivo])
  );
  const deSofi = Array.isArray(veredicto.le_falta) ? veredicto.le_falta : [];
  const salida = [];
  const leFalta = [];
  for (const ref of [...new Set(refs)]) {
    const m = (matches || []).find((x) => x && String(x.ref) === ref);
    if (!m || DUDOSAS_QUE_NO_SALEN.has(motivoDe.get(ref))) continue;
    salida.push(m);
    const escrito = deSofi.filter((f) => f && String(f.ref) === ref && f.detalle).map((f) => String(f.detalle));
    const cortos = cortosDe(m).map((r) => String(r).replace(/\s*\(pediste (\d+)\)/, " y pediste $1").replace(/ — /, ": "));
    const tipado = TEXTO_DUDOSA[motivoDe.get(ref)] || null;
    const partes = [...new Set([...escrito, ...cortos, tipado].filter(Boolean))];
    leFalta.push({ ref, detalle: (partes.length ? partes : [DUDOSA_GENERICA]).join(" · ") });
  }
  return { matches: salida, leFalta };
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
//
// `conAclaracion` (2026-10-20, ver MOTIVOS_ACLARABLES): las fichas a las que
// solo les falta un dato aclarable pasan DESPUES de las que encajan del todo
// (cada grupo por puntaje), y `aclaraciones` dice cuales son, con sus motivos
// y el texto para el colega. Sin la opcion, el resultado es el de siempre y
// `aclaraciones` sale vacio.
//
// `zonaCercana` (2026-10-26, ver dmZonaCercanaActivo): las fichas de zona
// cercana pasan AL FINAL y solo si no quedo ninguna exacta (las de dato por
// confirmar no cuentan como exactas). Salen como COPIA del match con
// `zona_cercana` (la marca que lee redactar.js#desvios) y su aclaracion lleva
// `zonaCercana: true`. Si hay exactas, van a `descartados` como siempre.
function filtrar(matches, opciones = {}) {
  const limite = opciones.limite || Infinity;
  const conAclaracion = opciones.conAclaracion === true;
  const zonaCercana = opciones.zonaCercana === true;
  const publicables = [];
  const conDatoPorConfirmar = [];
  const cercanas = [];
  const descartados = [];

  for (const m of matches || []) {
    const veredicto = esPublicable(m, opciones);
    let marca = null;
    if (veredicto.ok) publicables.push(m);
    else if (conAclaracion && soloAclarables(veredicto.motivos, m)) conDatoPorConfirmar.push({ m, motivos: veredicto.motivos });
    else if (zonaCercana && (marca = zonaCercanaDe(veredicto.motivos, m, { conAclaracion }))) {
      cercanas.push({ m: { ...m, zona_cercana: marca }, original: m, motivos: veredicto.motivos });
    } else descartados.push({ ref: m && m.ref, motivos: veredicto.motivos });
  }

  // Con al menos una exacta, la zona cercana no sale.
  if (publicables.length > 0) {
    for (const x of cercanas) descartados.push({ ref: x.original && x.original.ref, motivos: x.motivos });
    cercanas.length = 0;
  }

  const porPuntaje = (a, b) => Number(b.puntaje) - Number(a.puntaje);
  publicables.sort(porPuntaje);
  conDatoPorConfirmar.sort((a, b) => porPuntaje(a.m, b.m));
  cercanas.sort((a, b) => porPuntaje(a.m, b.m));
  const todas = [...publicables, ...conDatoPorConfirmar.map((x) => x.m), ...cercanas.map((x) => x.m)].slice(0, limite);
  const aclaraciones = [
    ...conDatoPorConfirmar
      .filter((x) => todas.includes(x.m))
      .map((x) => ({ ref: String(x.m.ref), motivos: x.motivos, detalle: aclaracionParaColega(x.motivos) })),
    ...cercanas
      .filter((x) => todas.includes(x.m))
      .map((x) => ({ ref: String(x.m.ref), motivos: x.motivos, detalle: aclaracionParaColega(x.motivos), zonaCercana: true })),
  ];
  return { publicables: todas, descartados, aclaraciones };
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
  zona_vecina: "queda en la zona de al lado, no en la que pidió el colega: no sale sola, decidí vos si se la mostrás",
  sector_sin_confirmar: "está en el municipio que pidió el colega, pero no tenemos confirmado que esté en el sector o barrio que nombró: no sale sola, decidí vos si se la mostrás",
  amoblado_sin_confirmar: "el colega pidió amoblado y no tenemos confirmado que ésta lo esté: Wasi sólo lo dice en el título y esta ficha no lo trae",
  garajes_sin_dato: "el colega pidió parqueadero y esta ficha no tiene el dato cargado en Wasi: confirmalo vos antes de ofrecerla",
  piso_sin_confirmar: "el colega pidió un piso concreto y esta ficha no dice en cuál está: si lo sabés, se lo podés ofrecer vos",
  edificio_sin_confirmar: "el colega pidió una unidad o edificio con nombre y esta ficha no lo nombra: si sabés que queda ahí, se la podés ofrecer vos",
  rentada_sin_confirmar: "el colega pidió que ya esté arrendada y esta ficha no dice si está rentando: si lo sabés, se la podés ofrecer vos",
  periodo_no_soportado: "el pedido es por días o semanas y nuestro inventario está cotizado por mes",
  varios_pedidos: "el mensaje traía varios pedidos y el sistema los pudo haber mezclado: revisá a cuál le sirve antes de mandarla",
  precio_sin_confirmar: "el precio de Wasi y el que dice la descripción de la ficha no coinciden: confirmalo y corregilo en Wasi antes de ofrecerla",
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
  "zona_vecina",
  "sector_sin_confirmar",
  "puntaje_bajo",
  "sync_viejo",
  "periodo_no_soportado",
  "varios_pedidos",
  "precio_sin_confirmar",
  "amoblado_sin_confirmar",
  "garajes_sin_dato",
  "piso_sin_confirmar",
  "edificio_sin_confirmar",
  "rentada_sin_confirmar",
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
  // Misma razon que zona_no_publicable: redactar.js#desvios ya calcula la
  // aclaracion contra el pedido real ("queda en Itagüí, no en Envigado").
  zona_vecina: null,
  // Misma razon: redactar.js#desvios ya dice "queda en Envigado; el barrio
  // exacto no lo tengo registrado" para el grado zona_general.
  sector_sin_confirmar: null,
  puntaje_bajo: "no pude verificar todo lo que pediste — confírmame lo que te falte",
  sync_viejo: "confírmame disponibilidad antes de mostrarla",
  periodo_no_soportado: "está cotizada por mes, no por días ni semanas",
  varios_pedidos: "dime a cuál de tus pedidos le apunta y te confirmo",
  precio_sin_confirmar: "te confirmo el precio final",
  amoblado_sin_confirmar: "no tengo confirmado que esté amoblada",
  garajes_sin_dato: "no tengo registrado el parqueadero: te lo confirmo si lo necesitas",
  piso_sin_confirmar: "no tengo registrado en qué piso está: te lo confirmo si te sirve",
  edificio_sin_confirmar: "no tengo confirmado que esté en la unidad que pediste",
  rentada_sin_confirmar: "no tengo confirmado que esté arrendada: te lo confirmo si te sirve",
  sin_area: "no tengo registrada el área: te la confirmo si la necesitas",
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

// LA ACLARACION DENTRO DE LA FICHA DEL DM (2026-10-20). Junta lo que
// filtrar() dejo pasar con un dato por confirmar con las notas de Sofi, para
// que el colega lea cada cosa UNA vez:
//   · leFalta: la ficha que sale con aclaracion lleva su texto
//     (aclaracionParaColega) y despues lo que Sofi haya escrito para esa ref.
//     Si Sofi ya hablo del mismo tema ("no tiene piso registrado"), se queda
//     el de Sofi, redactado para esa propiedad. El barrio no lleva texto aca:
//     lo dice redactar.js#desvios ("queda en Envigado; el barrio exacto no lo
//     tengo registrado").
//   · sinConfirmar: la salvedad del primer mensaje deja de nombrar lo que ya
//     va aclarado en la ficha (piso, parqueadero, precio, barrio).
// `props` son las fichas que de verdad van en el mensaje: una aclaracion de
// una ref que no sale no puede tocar la salvedad. Sin aclaraciones las notas
// de Sofi no se combinan con nada; con `props`, la salvedad igual se recorta a
// las fichas que van (salvedadDeLasFichas), tambien con el interruptor apagado.
const TEMA_DEL_MOTIVO = {
  sector_sin_confirmar: /barrio|sector/i,
  // Zona cercana (2026-10-26): la ficha ya dice donde queda; la salvedad del
  // primer mensaje no puede hablar de barrio o zona sin contradecirla.
  zona_vecina: /barrio|sector|\bzonas?\b|ubicaci/i,
  piso_sin_confirmar: /\bpisos?\b/i,
  garajes_sin_dato: /parqueader|garaje|parqueo/i,
  precio_sin_confirmar: /\bprecio/i,
  sin_area: /\báreas?\b|metros|m2|m²/i,
};

function notasParaDm({ sinConfirmar = [], leFalta = [] } = {}, aclaraciones = [], props = null, { revisadas = null } = {}) {
  const refsQueSalen = props ? new Set(props.map((m) => String(m && m.ref))) : null;
  const vigentes = (aclaraciones || []).filter((a) => a && (!refsQueSalen || refsQueSalen.has(String(a.ref))));
  if (!vigentes.length) return { sinConfirmar: props ? salvedadDeLasFichas(sinConfirmar, props, revisadas) : sinConfirmar, leFalta };

  const notas = Array.isArray(leFalta) ? leFalta : [];
  const refsAclaradas = new Set(vigentes.map((a) => String(a.ref)));
  const otras = notas.filter((f) => !(f && f.ref && refsAclaradas.has(String(f.ref))));
  const combinadas = [];
  for (const a of vigentes) {
    const deSofi = notas.filter((f) => f && f.ref && String(f.ref) === String(a.ref) && f.detalle).map((f) => String(f.detalle));
    const motivosSinTexto = a.motivos.filter((m) => !deSofi.some((d) => TEMA_DEL_MOTIVO[m] && TEMA_DEL_MOTIVO[m].test(d)));
    const propia = aclaracionParaColega(motivosSinTexto);
    const detalle = [...new Set([propia, ...deSofi].filter(Boolean))].join(" · ");
    if (detalle) combinadas.push({ ref: String(a.ref), detalle });
  }

  const temas = [...new Set(vigentes.flatMap((a) => a.motivos))].map((m) => TEMA_DEL_MOTIVO[m]).filter(Boolean);
  const salvedad = (Array.isArray(sinConfirmar) ? sinConfirmar : []).filter((item) => !temas.some((re) => re.test(String(item || ""))));
  return { sinConfirmar: props ? salvedadDeLasFichas(salvedad, props, revisadas) : salvedad, leFalta: [...otras, ...combinadas] };
}

// LA SALVEDAD HABLA SOLO DE LAS FICHAS QUE VAN (revision final del rescate,
// 2026-10-20). Dos casos reales de la prueba en seco:
//   · 3ee69b01: salia UNA ficha (9944723) y el primer mensaje decia "No tengo
//     confirmado si tiene cuarto útil (en 9944723 y 10129664)". La 10129664 no
//     se le mandaba.
//   · 2e6fea9a: "No tengo confirmado si tienen ... administración", con 2 de
//     las 3 fichas mostrando la administración.
// Por cada nota: las refs que nombra se recortan a las del DM (si no queda
// ninguna, la nota se va); lo que se puede leer del dato (administración,
// cuarto útil) se mira ficha por ficha y solo se nombran las que de verdad no
// lo tienen. `revisadas` (opcional): las refs que Sofi vio cuando escribio la
// nota; una nota sin refs habla solo de esas (el script de rescate cruza de
// nuevo y puede traer fichas que Sofi nunca vio).
const TEMAS_DE_DATO = [
  { re: /administraci/i, tiene: (m) => Boolean(String((m && m.administracion) || "").trim()) },
  {
    re: /cuarto\s+[uú]til/i,
    tiene: (m) => /cuarto\s+util/.test(normalizarTexto(`${(m && m.caracteristicas) || ""} ${(m && m.titulo) || ""}`)),
  },
];

function normalizarTexto(t) {
  return String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function unirConY(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function escaparRe(t) {
  return String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function salvedadDeLasFichas(items, props, revisadas = null) {
  const porRef = new Map((props || []).map((m) => [String(m && m.ref), m]));
  const refsDm = [...porRef.keys()];
  const vistas = revisadas ? new Set([...revisadas].map(String)) : null;
  const salida = [];
  for (const item0 of Array.isArray(items) ? items : []) {
    const texto = String(item0 || "").trim();
    if (!texto) continue;
    const nombradas = new Set(texto.match(/\b\d{5,}\b/g) || []);
    for (const r of refsDm) if (new RegExp(`(^|[^A-Za-z0-9])${escaparRe(r)}([^A-Za-z0-9]|$)`).test(texto)) nombradas.add(r);
    let base = texto;
    if (nombradas.size) {
      const patron = [...nombradas].map(escaparRe).join("|");
      const nombraRef = new RegExp(patron);
      base = texto
        .replace(/\s*\([^)]*\)/g, (par) => (nombraRef.test(par) ? "" : par))
        .replace(new RegExp(patron, "g"), "")
        .replace(/\s{2,}/g, " ")
        .trim();
      for (let previo = null; previo !== base; ) {
        previo = base;
        base = base.replace(/(?:\s+(?:en|de|la|las|el|los|y|e)|\s*[,;:(])\s*$/i, "").trim();
      }
      if (!base) continue;
    }
    const tema = TEMAS_DE_DATO.find((t) => t.re.test(base));
    let alcance;
    if (nombradas.size) alcance = refsDm.filter((r) => nombradas.has(r));
    else if (vistas && !tema) alcance = refsDm.filter((r) => vistas.has(r));
    else alcance = refsDm;
    if (tema) alcance = alcance.filter((r) => !tema.tiene(porRef.get(r)));
    if (!alcance.length) continue;
    if (alcance.length === refsDm.length) salida.push(nombradas.size ? base : texto);
    else salida.push(`${base} (en ${unirConY(alcance)})`);
  }
  return salida;
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
  MOTIVOS_ACLARABLES,
  dmConAclaracionActivo,
  dmZonaCercanaActivo,
  dmDudosasActivo,
  dudosasParaDm,
  cortosDe,
  notasParaDm,
  salvedadDeLasFichas,
};

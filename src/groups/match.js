// Etapa 2 del embudo: cruce contra el inventario real. Codigo puro, cero
// tokens.
//
// - Una DEMANDA se cruza contra el inventario de Diamond y contra la red de
//   aliados ya registrada. Es la metrica de negocio de la Fase 0: detectar
//   pedidos que no podemos atender no sirve de nada.
// - Una OFERTA se normaliza al shape de ally_properties y se marca si tiene
//   datos suficientes para recomendarsela a un cliente. En Fase 0 NO se
//   escribe nada en la base: solo se reporta.

const organizations = require("../data/organizations");
const properties = require("../data/properties");
const allyProperties = require("../data/ally-properties");

// Los dos modulos usan claves distintas para lo mismo: properties espera
// precio_max / habitaciones_min y ally-properties espera precioMax. Sin
// traducir, el filtro de precio se ignora en silencio y TODO parece matchear
// — que es exactamente el resultado que haria pasar la compuerta de negocio
// por la razon equivocada.
function filtrosInventario(c) {
  const f = {};
  if (c.tipo) f.tipo = c.tipo;
  // El prefiltro de la base busca el termino en zona O ciudad — es permisivo a
  // proposito. La graduacion (exacta / vecina / otra_zona) esta en
  // ubicacionCoincide; aca solo se acota cuantas filas viajan.
  //
  // Se incluyen las zonas pedidas Y SUS VECINAS. Sin esto la graduacion no
  // sirve de nada: si la consulta solo trae El Poblado, las de Envigado nunca
  // llegan al motor y no hay nada que evaluar como vecino.
  const zonas = zonasPedidas(c);
  if (zonas.length) {
    const tokens = zonas.flatMap((z) => properties.distinctiveTokens(properties.zonaTokens(z)));
    f.zona = [...new Set([...tokens, ...properties.vecinosDe(tokens)])].join(" ");
  } else if (c.ciudad) {
    f.zona = c.ciudad;
  }
  if (c.precio_max > 0) f.precio_max = c.precio_max;
  if (c.habitaciones > 0) f.habitaciones_min = c.habitaciones;
  return f;
}

function filtrosAliados(c) {
  // SOLO las que registro a mano un asesor de Diamond. Las que Sofi leyo en un
  // grupo (origen 'grupo') quedan afuera a proposito: esta funcion alimenta la
  // respuesta que se le da a un COLEGA, y contestarle con la propiedad de otro
  // colega —vista al pasar, sin que nadie confirmara que sigue disponible ni
  // que el precio sea ese— pone a Diamond de intermediaria en un negocio ajeno
  // con informacion que no verificamos. Esas se usan solo hacia adentro, para
  // un cliente propio, en src/agent/tools.js.
  const f = { origen: "asesor" };
  if (c.tipo) f.tipo = c.tipo;
  const zonasAliado = zonasPedidas(c);
  if (zonasAliado.length) f.zona = zonasAliado.join(" ");
  else if (c.ciudad) f.zona = c.ciudad;
  if (c.precio_max > 0) f.precioMax = c.precio_max;
  // operacion NO se pasa a proposito: ally-properties.matchesFilters la compara
  // con !== estricto, y la tabla guarda lo que extrajo Claude en su momento
  // ("Venta", "venta", "VENTA"). Se filtra abajo, sin distinguir mayusculas,
  // con el mismo criterio para las dos fuentes.
  return f;
}

const normOperacion = (v) => String(v || "").trim().toLowerCase();

// properties.search() NO filtra por operacion (ver src/data/properties.js:73),
// asi que una demanda de arriendo matchearia propiedades en venta e inflaria
// la metrica que decide si el proyecto sigue. Se filtra aca.
function mismaOperacion(propiedad, c) {
  const pedida = normOperacion(c.operacion);
  if (!pedida || pedida === "permuta") return true; // sin dato: no descartamos
  const tiene = normOperacion(propiedad.operacion);
  return !tiene || tiene === pedida;
}

// ══ Que cuenta como match ════════════════════════════════════════════════
//
// Los filtros de arriba son un PREFILTRO barato que corre en la base: acotan
// cuantas filas viajan. Las compuertas de verdad estan aca, en codigo, porque
// la consulta SQL no puede expresarlas sin volverse ilegible.
//
// Cuatro defectos medidos en produccion el 2026-07-29, que hacian que "4
// matches" no significara nada:
//
//   1. Una demanda SIN zona no filtraba por zona: devolvia cualquier cosa bajo
//      el precio. Un solo pedido saco 10 propiedades de Robledo a Sabaneta.
//   2. El precio era solo techo: a un cliente de $700M se le ofrecia uno de
//      $195M. Cabe en el presupuesto y no sirve.
//   3. La zona se comparaba tambien contra `ciudad`: pedir un barrio de
//      Envigado devolvia el municipio entero.
//   4. `habitaciones_min` es >=: pedir 3 alcobas traia una de 6.
//
// Principio para los datos que faltan: **lo desconocido no descalifica**. Si el
// inventario no tiene el area cargada no podemos culpar a la propiedad por una
// falla de nuestro sync — no suma confianza, pero tampoco la mata.

// Piso del presupuesto, como fraccion del techo. Una propiedad muy por debajo
// de lo que el cliente puede pagar casi nunca es lo que busca.
const BANDA_INFERIOR = Number(process.env.GRUPOS_BANDA_PRECIO || 0.6);
const PUNTAJE_BASE = 55;

// MARGEN DE CAPTURA (Juan, 2026-08-20): el techo de precio y el piso de area
// eran compuertas duras — un apartamento de $720M para un presupuesto de
// $700M (2.9% arriba) se descartaba de plano, aunque para el cliente esos
// $20M casi seguro sean negociables. El pedido explicito fue "capturar la
// mayor cantidad de ofertas posible" dandole margen al bot en las variables
// que NO son criticas para el cliente (precio, metros) sin tocar las que si
// lo son (alcobas, banos, garajes, estrato: estas siguen exactas).
//
// El margen relaja la compuerta, no la borra: mas alla de el, se sigue
// rechazando igual que antes. Configurable sin redesplegar, mismo patron que
// BANDA_INFERIOR.
const MARGEN_PRECIO = Number(process.env.GRUPOS_MARGEN_PRECIO || 0.10);
const MARGEN_AREA = Number(process.env.GRUPOS_MARGEN_AREA || 0.10);

// El parseo de precio y area vive en src/lib/formato.js. Antes habia aca un
// `aNumero` que hacia `replace(/\D/g, "")`, y ese "quitar todo lo que no sea
// digito" tenia un bug que no fallaba ruidosamente: sobre el formato REAL de
// Wasi ("92m2") pegaba el 2 de la unidad y devolvia 922. Toda area quedaba
// inflada ~10x, asi que la compuerta de area no rechazaba nunca y ademas
// regalaba sus 8 puntos. No se veia en los tests porque los fixtures usaban
// "95 m²" con superindice, que no es un digito.
const formato = require("../lib/formato");

const millones = (n) => formato.formatearPrecioCorto(n);

// La zona pedida se compara SOLO contra la zona de la propiedad. Mezclar la
// ciudad convertia "Loma del Chocho" en "todo Envigado": ese cruce cruzado
// explica 656 de los ~731 falsos positivos medidos el 2026-07-29.
//
// BUG real (2026-07-29, caso Patricia): la comparacion era por SUBSTRING sobre
// el string entero de la propiedad — "laureles".includes("laurel") da true.
// "Laurel" y "Bulevar Alcazar" son unidades de SABANETA, no el barrio
// Laureles, y ese substring le ofrecia a la asesora 6 apartamentos del barrio
// equivocado para un cliente de otro municipio. La comparacion ahora es por
// TOKEN EXACTO: se tokeniza tambien la zona de la propiedad (mismo criterio
// que la del pedido) y se exige que un token completo aparezca en el otro
// conjunto — "laurel" ya no cae dentro de "laureles" porque son tokens
// distintos, pero "bernal" sigue matcheando "Loma de los Bernal" porque ahi
// SI es un token propio.
// Un pedido puede nombrar VARIAS zonas ("POBLADO/ENVIGADO" es como se pide de
// verdad). El clasificador devuelve `zonas` como lista; `zona` se conserva por
// compatibilidad con lo ya guardado y con el export.
function zonasPedidas(c) {
  const lista = Array.isArray(c.zonas) && c.zonas.length ? c.zonas : [c.zona];
  return lista.map((z) => String(z || "").trim()).filter(Boolean);
}

function zonaCoincide(p, c) {
  const tokensPropiedadArr = properties.zonaTokens(p.zona || "");
  const tokensPropiedad = new Set(tokensPropiedadArr);
  for (const z of zonasPedidas(c)) {
    const tokensPedido = properties.distinctiveTokens(properties.zonaTokens(z));
    if (tokensPedido.length && tokensPedido.some((t) => tokensPropiedad.has(t))) return true;
    // Sub-zona conocida ("San Joaquin" pedido "Laureles"): es tan exacta como
    // el token literal, no una vecina. Ver la nota en src/lib/zonas.js.
    if (tokensPedido.length && properties.subzonaCoincide(tokensPedido, tokensPropiedadArr)) return true;
  }
  return false;
}

// Zona distinta pero contigua: quien pide El Poblado compra en Envigado. Ver
// VECINDAD en src/lib/zonas.js — es geografia declarada, no laxitud.
// Zonas que el pedido EXCLUYE explicitamente ("No Loma del Indio").
function zonasExcluidas(c) {
  return (Array.isArray(c.zonas_excluidas) ? c.zonas_excluidas : []).map((z) => String(z || "").trim()).filter(Boolean);
}

// BUG real (Juan, 2026-08-20): "❌No Loma del Indio" en un pedido no se
// guardaba en ningun lado — el motor podia ofrecer justo lo que el cliente
// rechazo (no paso esta vez de pura suerte de puntaje, pero era cuestion de
// tiempo). Mismo criterio de token exacto que zonaCoincide/zonaVecina, y
// veta ANTES que cualquier otra cosa: una zona excluida no se ofrece ni como
// "otra_zona" marcada para que alguien la revise.
function zonaExcluida(p, c) {
  const excluidas = zonasExcluidas(c);
  if (!excluidas.length) return false;
  const tokensPropiedad = new Set(properties.zonaTokens(p.zona || ""));
  return excluidas.some((z) => {
    const tokensExcluida = properties.distinctiveTokens(properties.zonaTokens(z));
    return tokensExcluida.length && tokensExcluida.some((t) => tokensPropiedad.has(t));
  });
}

function zonaVecina(p, c) {
  const tokensPropiedad = properties.zonaTokens(p.zona || "");
  if (!tokensPropiedad.length) return false;
  for (const z of zonasPedidas(c)) {
    const tokensPedido = properties.distinctiveTokens(properties.zonaTokens(z));
    if (properties.sonVecinas(tokensPedido, tokensPropiedad)) return true;
  }
  return false;
}

// Pero un pedido puede ser legitimamente de municipio ("busco casa en
// Envigado") y ese negocio es real. Se acepta, contra la CIUDAD de la
// propiedad y no contra su barrio, y vale menos puntaje: un match de municipio
// es mas debil que uno de barrio, y la pantalla tiene que poder decirlo.
// Mismo fix de token exacto que zonaCoincide, y por el mismo motivo.
function ciudadCoincide(p, c) {
  const tokensPedido = properties.distinctiveTokens(properties.zonaTokens(c.ciudad || ""));
  if (tokensPedido.length === 0) return false;
  const tokensCiudad = new Set(properties.zonaTokens(p.ciudad || ""));
  return tokensPedido.some((t) => tokensCiudad.has(t));
}

// Devuelve como calza la ubicacion, o null si no calza.
// LA UBICACION YA NO ES UNA COMPUERTA BINARIA, ES UN GRADO (2026-08-18).
//
// Antes: si el pedido nombraba un barrio y la propiedad no estaba ahi, se
// descartaba. Eso perdia negocio real — quien pide El Poblado compra en
// Envigado, son contiguos y el mismo cliente se mueve entre los dos.
//
// Ahora se devuelve el grado y cada match lo lleva encima, para que Sofi pueda
// razonar sobre el ("¿le sirve Envigado a este cliente en particular?"). El
// castigo de puntaje refleja la distancia.
//
// LO QUE NO SE TOCA, porque fue lo que causo 656 de 731 falsos positivos: la
// comparacion por token exacto (nunca substring) y el fallback a la ciudad
// entera, que sigue siendo el ultimo grado y el mas castigado.
//
// Y una separacion que importa: este grado alimenta el AVISO a la asesora, que
// pasa por el juicio de Sofi y de una persona. Para PUBLICAR en el grupo,
// src/groups/publicable.js sigue exigiendo zona exacta o vecina — ahi no hay
// nadie revisando y el error se ve delante de 80 competidores.
// Pesos recalibrados (Juan, 2026-08-19): con datos reales del radar en vivo,
// una zona EXACTA sin mas dato que el precio quedaba en 65 (55 base + 10 de
// precio) y una VECINA bien especificada rara vez pasaba de 67 — los dos por
// debajo del umbral de publicacion (70), asi que un match geograficamente
// correcto solo pasaba si ademas calzaban dos o tres exigencias incidentales
// (alcobas, area, banos...) que muchos pedidos ni mencionan. El sintoma en
// produccion: el radar callaba casi todo, no solo lo que de verdad no servia.
//
// La correccion mueve peso HACIA la ubicacion —que es el dato que mas importa
// para decidir si algo "sirve"— y LEJOS de otra_zona, para que ningun combo de
// exigencias incidentales pueda compensar estar en el barrio equivocado (el
// techo teorico de otra_zona con TODO lo demas a favor queda en 65, todavia
// bajo el umbral). zonaCoincide/zonaVecina — la comparacion por token exacto
// que evito los 656 falsos positivos de julio — no se toca: esto solo cambia
// cuanto vale cada grado, no como se calcula.
function ubicacionCoincide(p, c) {
  // Veto absoluto: una zona que el cliente rechazo explicitamente no se
  // ofrece bajo ningun grado, ni siquiera "otra_zona" marcada para revisar.
  if (zonaExcluida(p, c)) return null;

  const pide = zonasPedidas(c).length > 0;

  if (pide && zonaCoincide(p, c)) return { razon: `Zona: ${p.zona}`, puntos: 20, grado: "exacta" };
  if (pide && zonaVecina(p, c)) {
    return { razon: `${p.zona} (vecina de lo pedido)`, puntos: -5, grado: "vecina" };
  }
  if (pide) {
    // Zona distinta y no contigua. Entra, pero muy castigada y marcada: solo
    // llega a la asesora si TODO lo demas calza y Sofi lo aprueba.
    if (!ciudadCoincide(p, c)) return null;
    return { razon: `${p.zona || p.ciudad} (fuera de la zona pedida)`, puntos: -35, grado: "otra_zona" };
  }
  if (ciudadCoincide(p, c)) {
    return { razon: `Ciudad: ${p.ciudad} (sin barrio en el pedido)`, puntos: -15, grado: "ciudad" };
  }
  return null;
}

// Devuelve null si la propiedad no pasa las compuertas; si pasa, el match ya
// armado con su puntaje y las razones legibles de por que calza.
function evaluarCandidata(p, c, fuente) {
  if (!mismaOperacion(p, c)) return null;
  if (c.tipo && !String(p.tipo || "").toLowerCase().includes(String(c.tipo).toLowerCase())) return null;

  const ubicacion = ubicacionCoincide(p, c);
  if (!ubicacion) return null;

  const razones = [ubicacion.razon];
  let puntaje = PUNTAJE_BASE + ubicacion.puntos;

  // Descuento por fuente no verificable (Juan, 2026-08-20 — auditoria del
  // veredicto de Sofi en modo asistido): distinto de "lo desconocido no
  // descalifica" (mas abajo). Ahi el hueco es incidental — nuestro propio
  // sync de Wasi no trajo el dato todavia. Una propiedad de un aliado NUNCA
  // puede tener alcobas/area/banos/garajes/estrato: ally_properties no tiene
  // esas columnas, la captura es un texto de WhatsApp. Sin este descuento,
  // una propiedad de la que solo se sabe zona y precio quedaba con el MISMO
  // puntaje que una nuestra que verifico cuatro o cinco cosas — Sofi lo
  // marco cuatro veces distintas: "sin esa info verificable, no deberia
  // pasar de 55", "no tiene datos de area ni alcobas verificables, deberia
  // estar mas abajo".
  if (fuente === "aliado") puntaje -= 8;

  // ── Precio: banda, no techo — con margen de captura sobre el techo ──
  const precio = formato.parsearPrecio(p.precio);
  const techo = c.precio_max > 0 ? c.precio_max : null;
  const techoConMargen = techo ? Math.round(techo * (1 + MARGEN_PRECIO)) : null;
  const piso = c.precio_min > 0 ? c.precio_min : techo ? Math.round(techo * BANDA_INFERIOR) : null;
  if (precio && techo) {
    if (precio > techoConMargen) return null;
    if (piso && precio < piso) return null;
    if (precio > techo) {
      // Dentro del margen, no del presupuesto: se declara tal cual, sin la
      // bonificacion de "aprovecha el presupuesto" (esa premia quedarse
      // adentro, no pasarse) y sin fingir que cupo.
      razones.push(`${millones(precio)} — ${Math.round((precio / techo - 1) * 100)}% sobre ${millones(techo)}, dentro del margen`);
    } else {
      razones.push(`${millones(precio)} dentro de ${millones(techo)}`);
      if (precio >= techo * 0.75) puntaje += 10; // aprovecha el presupuesto
    }
  } else if (precio) {
    razones.push(millones(precio));
  }

  // ── Compuertas que sólo aplican si el pedido las menciona ──
  // Cada una: si la propiedad tiene el dato, tiene que cumplir; si no lo tiene,
  // no descalifica (es un hueco de nuestro sync, no un defecto del inmueble).
  //
  // FLEXIBILIDAD POR INTENCION (Juan, 2026-08-20): un pedido que dice
  // "estudio" (ej. "3 alcobas o 2 con estudio") o "para inversion" acepta una
  // alcoba/bano/parqueadero MENOS de lo pedido si el resto calza — a
  // diferencia de precio/area, que llevan margen SIEMPRE, esto es condicional:
  // solo se activa si el colega lo dijo explicitamente (classify.js lo extrae
  // como `flexible_habitaciones`). Sin la señal, siguen exigiendo el minimo
  // exacto — de ahi que baños/garajes NO llevaran margen antes de hoy.
  const flexible = Boolean(c.flexible_habitaciones);
  const exigencias = [
    // Puntaje distinto para el exacto (t===q) y el "uno de mas/menos" que
    // igual pasa la compuerta: antes valian lo mismo. Caso real (Juan,
    // 2026-08-20 — auditoria del veredicto de Sofi): "la de 4 alcobas tiene
    // puntaje mas alto pero sirve menos [que la de 3, cuando pidieron 3]...
    // deberia tener el puntaje mayor [la que calza exacto]". Sigue sirviendo
    // -por eso la compuerta la deja pasar- pero no tan bien como la exacta.
    {
      pide: c.habitaciones, tiene: p.habitaciones,
      ok: (t, q) => t >= q - (flexible ? 1 : 0) && t <= q + 1,
      texto: (t) => `${t} alcobas`, puntos: (t, q) => (t === q ? 10 : 6),
    },
    // Area SI lleva margen de captura SIEMPRE (Juan, 2026-08-20): unos metros
    // menos de lo pedido casi nunca descarta un negocio real.
    { pide: c.area_min, tiene: formato.parsearArea(p.area), ok: (t, q) => t >= q * (1 - MARGEN_AREA), texto: (t) => `${t} m²`, puntos: 8 },
    {
      pide: c.banos, tiene: p.banos,
      ok: (t, q) => t >= q - (flexible ? 1 : 0),
      texto: (t) => `${t} baños`, puntos: (t, q) => (t >= q ? 6 : 4),
    },
    {
      pide: c.garajes, tiene: p.garaje,
      ok: (t, q) => t >= q - (flexible ? 1 : 0),
      texto: (t) => `${t} garaje${t > 1 ? "s" : ""}`, puntos: (t, q) => (t >= q ? 6 : 4),
    },
    // Estrato NO entra en la flexibilidad: no es una preferencia de espacio
    // negociable como una alcoba de menos, es la clasificacion socioeconomica
    // del sector y no cambia porque el cliente compre "para inversion".
    { pide: c.estrato, tiene: p.estrato, ok: (t, q) => t >= q, texto: (t) => `estrato ${t}`, puntos: 5 },
  ];

  for (const e of exigencias) {
    if (!(e.pide > 0)) continue;
    if (e.tiene == null || !(e.tiene > 0)) continue; // sin dato: ni suma ni resta
    if (!e.ok(e.tiene, e.pide)) return null;
    razones.push(e.texto(e.tiene));
    puntaje += typeof e.puntos === "function" ? e.puntos(e.tiene, e.pide) : e.puntos;
  }

  return {
    fuente,
    ref: p.ref || null,
    titulo: p.titulo || null,
    zona: p.zona || null,
    precio: p.precio || null,
    operacion: p.operacion || null,
    // El link SIEMPRE es el de la landing propia, nunca Wasi (ver
    // withLandingLink en src/data/properties.js). Los aliados no son nuestros
    // y no tienen ficha en la landing.
    link: fuente === "diamond" ? p.link || null : null,
    // linkWasi viaja aparte, solo para el mensaje "blanqueado" del modo auto
    // (redactar.js) — nada mas lo lee. `link` de arriba no cambia para nadie.
    linkWasi: fuente === "diamond" ? p.linkWasi || null : null,
    habitaciones: p.habitaciones ?? null,
    area: p.area || null,
    // Ficha completa (Juan, 2026-08-20): antes no viajaban porque el mensaje
    // no los mostraba — ahora si, asi que tienen que salir de aca.
    banos: p.banos ?? null,
    garajes: p.garaje ?? null,
    estrato: p.estrato ?? null,
    puntaje: Math.min(100, puntaje),
    // Como calzo la ubicacion: exacta | vecina | otra_zona | ciudad. Sofi lo
    // usa para razonar y publicable.js para decidir si puede salir al grupo.
    ubicacion: ubicacion.grado,
    razones,
    ...(fuente === "aliado" ? { inmobiliaria: p.inmobiliaria_origen || null } : {}),
  };
}

// Un colega republica la MISMA propiedad varias veces —en el mismo grupo o en
// varios— y ally_properties no dedupea al guardar (src/groups/ofertas.js):
// cada repost es una fila nueva. Caso real medido (Juan, 2026-08-20 —
// auditoria del veredicto de Sofi): un pedido trajo 6 candidatas, 5 de ellas
// la MISMA casa de "Alto de Las Palmas" con el titulo apenas distinto cada
// vez ("Casa de diseño exclusivo...", "Casa de diseño exclusivo en...", "Casa
// en el alto de Las Palmas..."). Con el tope de 6 candidatas, esas repeticiones
// tapaban CUALQUIER otra propiedad real que hubiera calzado. Se dedupe por
// fuente + precio + zona normalizada: mismo precio y misma zona, casi seguro
// la misma propiedad — nunca dos negocios distintos por casualidad.
function claveDuplicado(m) {
  const tokens = properties.distinctiveTokens(properties.zonaTokens(m.zona || "")).sort().join(",");
  return `${m.fuente}|${formato.parsearPrecio(m.precio) ?? m.precio}|${tokens}`;
}

function sinDuplicados(matches) {
  const vistos = new Set();
  const out = [];
  for (const m of matches) {
    const clave = claveDuplicado(m);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(m);
  }
  return out;
}

async function cruzarDemanda(org, c) {
  // Sin zona NI ciudad no hay match posible. Antes esto devolvia media ciudad,
  // que es peor que no devolver nada: quema la credibilidad de la pantalla y
  // le hace perder el tiempo al asesor.
  if (!c.zona && !c.ciudad) return { ...c, matches: [], sinZona: true };

  const [propios, aliados] = await Promise.all([
    properties.search(org, filtrosInventario(c), 30).catch(() => []),
    allyProperties.search(org.id, filtrosAliados(c), 30).catch(() => []),
  ]);

  const matches = sinDuplicados(
    [
      ...propios.map((p) => evaluarCandidata(p, c, "diamond")),
      ...aliados.map((p) => evaluarCandidata(p, c, "aliado")),
    ]
      .filter(Boolean)
      // El inventario propio primero: la comisión completa vale más que la
      // compartida. Dentro de cada fuente, el que mejor calza arriba — y el
      // dedup de arriba se queda con el primero que ve, asi que este orden
      // es tambien el que decide CUAL copia del duplicado sobrevive.
      .sort((a, b) => (a.fuente === b.fuente ? b.puntaje - a.puntaje : a.fuente === "diamond" ? -1 : 1))
  ).slice(0, 6);

  return { ...c, matches };
}

// Una oferta sin precio, sin zona o sin tipo es una fila muerta en
// ally_properties: Sofi nunca podria recomendarsela a un cliente. `faltantes`
// deja ver en el reporte QUE falta, no solo cuantas sirven.
//
// El contacto se da por cubierto si el mensaje lo trae O si conocemos al autor:
// en vivo (Fase 2) el remitente de WhatsApp siempre aporta el telefono, asi que
// exigirlo del texto subestimaria el rendimiento real del sistema.
function evaluarOferta(c) {
  const contacto = c.contacto || c.mensaje?.autor || "";
  const faltantes = [];
  if (!c.tipo) faltantes.push("tipo");
  if (!c.zona) faltantes.push("zona");
  if (!(c.precio_max > 0 || c.precio_min > 0)) faltantes.push("precio");
  if (!contacto) faltantes.push("contacto");

  return {
    ...c,
    utilizable: faltantes.length === 0,
    faltantes,
    // Shape de ally-properties.create(). En Fase 0 no se escribe.
    propuesta: {
      titulo: c.notas || null,
      tipo: c.tipo || null,
      operacion: c.operacion || null,
      precio: c.precio_max || c.precio_min || null,
      zona: c.zona || null,
      ciudad: c.ciudad || null,
      descripcion: c.notas || null,
      contacto_nombre: c.mensaje?.autor || null,
      contacto_telefono: c.contacto || null,
      mensaje_original: c.mensaje?.texto || null,
    },
  };
}

// clasificados: salida de classify(). Devuelve demandas cruzadas y ofertas
// evaluadas. Solo hace lecturas contra Supabase.
async function cruzar(clasificados, { org = null } = {}) {
  const organizacion = org || (await organizations.getDefault());

  const demandas = [];
  for (const c of clasificados.filter((x) => x.clase === "demanda")) {
    demandas.push(await cruzarDemanda(organizacion, c));
  }

  const ofertas = clasificados.filter((x) => x.clase === "oferta").map(evaluarOferta);
  const ruido = clasificados.filter((x) => x.clase === "ruido");

  return { demandas, ofertas, ruido };
}

module.exports = {
  cruzar, filtrosInventario, filtrosAliados, mismaOperacion, evaluarOferta,
  evaluarCandidata, zonaCoincide, ciudadCoincide, ubicacionCoincide, zonaExcluida, BANDA_INFERIOR,
  MARGEN_PRECIO, MARGEN_AREA, sinDuplicados,
};

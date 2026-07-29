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
  // proposito. La compuerta estricta (barrio contra barrio) esta en
  // ubicacionCoincide; aca solo se acota cuantas filas viajan.
  if (c.zona || c.ciudad) f.zona = c.zona || c.ciudad;
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
  if (c.zona || c.ciudad) f.zona = c.zona || c.ciudad;
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

function aNumero(v) {
  const n = parseInt(String(v ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const millones = (n) => (n >= 1000000 ? `$${Math.round(n / 1000000)}M` : `$${n.toLocaleString("es-CO")}`);

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
function zonaCoincide(p, c) {
  const tokensPedido = properties.distinctiveTokens(properties.zonaTokens(c.zona || ""));
  if (tokensPedido.length === 0) return false;
  const tokensPropiedad = new Set(properties.zonaTokens(p.zona || ""));
  return tokensPedido.some((t) => tokensPropiedad.has(t));
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
function ubicacionCoincide(p, c) {
  if (c.zona && zonaCoincide(p, c)) return { razon: `Zona: ${p.zona}`, puntos: 0 };
  // Si el pedido nombra un barrio y la propiedad no esta ahi, no se salva por
  // estar en la misma ciudad — eso era exactamente el bug.
  if (c.zona) return null;
  if (ciudadCoincide(p, c)) return { razon: `Ciudad: ${p.ciudad} (sin barrio en el pedido)`, puntos: -15 };
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

  // ── Precio: banda, no techo ──
  const precio = aNumero(p.precio);
  const techo = c.precio_max > 0 ? c.precio_max : null;
  const piso = c.precio_min > 0 ? c.precio_min : techo ? Math.round(techo * BANDA_INFERIOR) : null;
  if (precio && techo) {
    if (precio > techo) return null;
    if (piso && precio < piso) return null;
    razones.push(`${millones(precio)} dentro de ${millones(techo)}`);
    if (precio >= techo * 0.75) puntaje += 10; // aprovecha el presupuesto
  } else if (precio) {
    razones.push(millones(precio));
  }

  // ── Compuertas que sólo aplican si el pedido las menciona ──
  // Cada una: si la propiedad tiene el dato, tiene que cumplir; si no lo tiene,
  // no descalifica (es un hueco de nuestro sync, no un defecto del inmueble).
  const exigencias = [
    { pide: c.habitaciones, tiene: p.habitaciones, ok: (t, q) => t >= q && t <= q + 1, texto: (t) => `${t} alcobas`, puntos: 10 },
    { pide: c.area_min, tiene: aNumero(p.area), ok: (t, q) => t >= q, texto: (t) => `${t} m²`, puntos: 8 },
    { pide: c.banos, tiene: p.banos, ok: (t, q) => t >= q, texto: (t) => `${t} baños`, puntos: 6 },
    { pide: c.garajes, tiene: p.garaje, ok: (t, q) => t >= q, texto: (t) => `${t} garaje${t > 1 ? "s" : ""}`, puntos: 6 },
    { pide: c.estrato, tiene: p.estrato, ok: (t, q) => t >= q, texto: (t) => `estrato ${t}`, puntos: 5 },
  ];

  for (const e of exigencias) {
    if (!(e.pide > 0)) continue;
    if (e.tiene == null || !(e.tiene > 0)) continue; // sin dato: ni suma ni resta
    if (!e.ok(e.tiene, e.pide)) return null;
    razones.push(e.texto(e.tiene));
    puntaje += e.puntos;
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
    habitaciones: p.habitaciones ?? null,
    area: p.area || null,
    puntaje: Math.min(100, puntaje),
    razones,
    ...(fuente === "aliado" ? { inmobiliaria: p.inmobiliaria_origen || null } : {}),
  };
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

  const matches = [
    ...propios.map((p) => evaluarCandidata(p, c, "diamond")),
    ...aliados.map((p) => evaluarCandidata(p, c, "aliado")),
  ]
    .filter(Boolean)
    // El inventario propio primero: la comisión completa vale más que la
    // compartida. Dentro de cada fuente, el que mejor calza arriba.
    .sort((a, b) => (a.fuente === b.fuente ? b.puntaje - a.puntaje : a.fuente === "diamond" ? -1 : 1))
    .slice(0, 6);

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
  evaluarCandidata, zonaCoincide, ciudadCoincide, ubicacionCoincide, BANDA_INFERIOR,
};

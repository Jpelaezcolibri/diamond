// Etapa 2 del embudo: cruce contra el inventario real. Codigo puro, cero
// tokens.
//
// - Una DEMANDA se cruza contra el inventario de Diamond y contra la red de
//   aliados ya registrada. Es la metrica de negocio de la Fase 0: detectar
//   pedidos que no podemos atender no sirve de nada.
// - Una OFERTA se normaliza al shape de ally_properties y se marca si tiene
//   datos suficientes para recomendarsela a un cliente. En Fase 0 NO se
//   escribe nada en la base: solo se reporta.

const organizations = require("../../src/data/organizations");
const properties = require("../../src/data/properties");
const allyProperties = require("../../src/data/ally-properties");

// Los dos modulos usan claves distintas para lo mismo: properties espera
// precio_max / habitaciones_min y ally-properties espera precioMax. Sin
// traducir, el filtro de precio se ignora en silencio y TODO parece matchear
// — que es exactamente el resultado que haria pasar la compuerta de negocio
// por la razon equivocada.
function filtrosInventario(c) {
  const f = {};
  if (c.tipo) f.tipo = c.tipo;
  if (c.zona) f.zona = c.zona;
  if (c.precio_max > 0) f.precio_max = c.precio_max;
  if (c.habitaciones > 0) f.habitaciones_min = c.habitaciones;
  return f;
}

function filtrosAliados(c) {
  const f = {};
  if (c.tipo) f.tipo = c.tipo;
  if (c.zona) f.zona = c.zona;
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

async function cruzarDemanda(org, c) {
  const [propios, aliados] = await Promise.all([
    properties.search(org, filtrosInventario(c), 10).catch(() => []),
    allyProperties.search(org.id, filtrosAliados(c), 10).catch(() => []),
  ]);

  const matches = [
    ...propios.filter((p) => mismaOperacion(p, c)).map((p) => ({ fuente: "diamond", ref: p.ref, titulo: p.titulo, zona: p.zona, precio: p.precio, operacion: p.operacion })),
    ...aliados.filter((p) => mismaOperacion(p, c)).map((p) => ({ fuente: "aliado", ref: p.ref, titulo: p.titulo, zona: p.zona, precio: p.precio, operacion: p.operacion, inmobiliaria: p.inmobiliaria_origen })),
  ];

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

module.exports = { cruzar, filtrosInventario, filtrosAliados, mismaOperacion, evaluarOferta };

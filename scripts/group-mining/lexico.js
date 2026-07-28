// Lexico inmobiliario del prefiltro (Etapa 0).
//
// Vive aparte de prefilter.js a proposito: cuando las metricas de la Fase 0 no
// den, esto es lo primero que se ajusta, y hay que poder tocarlo sin leer la
// logica de filtrado.
//
// Criterio para agregar un termino: ante la duda, agregalo. El prefiltro es
// deliberadamente permisivo — dejar pasar basura cuesta centavos de IA, matar
// una oportunidad cuesta un negocio. Los falsos negativos ni siquiera se ven.
//
// Todos los terminos van SIN acentos y en minusculas: se comparan contra texto
// pasado por plano() de parse-export.js.

// Que se transa.
const TIPOS = [
  "apto", "aptos", "apartamento", "apartamentos", "apartaestudio", "aparta estudio",
  "casa", "casas", "casalote", "finca", "fincas", "cabana",
  "local", "locales", "oficina", "oficinas", "consultorio",
  "bodega", "bodegas", "lote", "lotes", "terreno",
  "parqueadero", "garaje", "deposito", "cuarto util",
  "edificio", "proyecto", "unidad", "penthouse", "duplex", "loft",
];

// Que operacion.
const OPERACIONES = [
  "arriendo", "arrendar", "arrienda", "arrendamiento",
  "venta", "vender", "vende", "venden", "compra", "comprar", "compro",
  "permuta", "permutar", "traspaso", "cesion",
];

// Alguien busca algo — direccion 2 (demanda).
const DEMANDA = [
  "busco", "buscamos", "buscando", "necesito", "necesitamos", "requiero",
  "requerimiento", "tengo cliente", "tengo un cliente", "cliente para",
  "me piden", "solicito", "solicitan", "quien tiene", "alguien tiene",
  "quien maneja", "alguien maneja", "quien tenga", "me sirve",
  "estoy buscando", "urge", "urgente",
];

// Alguien ofrece algo — direccion 1 (oferta).
const OFERTA = [
  "tengo", "manejo", "disponible", "disponibles", "se vende", "se arrienda",
  "en venta", "en arriendo", "comparto", "les comparto", "oportunidad",
  "sigue disponible", "aun disponible", "recien", "estrenar",
  "comision compartida", "comparto comision", "codigo", "ref", "referencia",
];

// Caracteristicas que suelen acompanar a una ficha real.
const ATRIBUTOS = [
  "alcoba", "alcobas", "habitacion", "habitaciones", "cuarto", "cuartos",
  "bano", "banos", "metros", "mts", "m2", "estrato", "piso", "balcon",
  "ascensor", "porteria", "unidad cerrada", "administracion", "amoblado",
  "sin amoblar", "vista", "remodelado",
];

// Zonas del Valle de Aburra que un mensaje puede nombrar sin decir la ciudad.
// No reemplaza a zonaTokens() del inventario: esto es la red de seguridad para
// mensajes que solo dicen el barrio.
const ZONAS = [
  "laureles", "poblado", "envigado", "sabaneta", "itagui", "bello", "belen",
  "estadio", "conquistadores", "floresta", "calasanz", "robledo", "castilla",
  "aranjuez", "manrique", "buenos aires", "boston", "prado", "candelaria",
  "guayabal", "cristo rey", "rosales", "mayorca", "caldas", "la estrella",
  "copacabana", "girardota", "barbosa", "rionegro", "llanogrande", "retiro",
  "santa fe de antioquia", "santafe de antioquia",
  "milla de oro", "provenza", "manila", "astorga", "patio bonito", "castropol",
  "loma del indio", "loma de los balsos", "loma del escobero", "loma del chocho",
  "san lucas", "las palmas", "otraparte", "zuniga", "la doctora", "san jose",
  "suramerica", "simon bolivar", "san javier", "la america", "velodromo",
];

// Un numero que puede ser un precio en pesos colombianos, en cualquiera de las
// formas en que la gente los escribe en un grupo:
//   400 millones · 400M · 400 palos · $400.000.000 · 1.200.000 · 3'500.000
const PRECIO = /(\$\s*[\d.,']{4,})|(\d[\d.,']{2,}\s*(millones|millon|mm|m\b|palos|palo|lucas|k\b))|(\d{1,3}[.,']\d{3}[.,']\d{3})|(\d{1,4}\s*(millones|millon|palos))/i;

const TODAS = [...TIPOS, ...OPERACIONES, ...DEMANDA, ...OFERTA, ...ATRIBUTOS, ...ZONAS];

module.exports = { TIPOS, OPERACIONES, DEMANDA, OFERTA, ATRIBUTOS, ZONAS, PRECIO, TODAS };

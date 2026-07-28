// Etapa 0 del embudo: descarte gratis, sin gastar un token.
//
// Es la pieza que define el costo de todo el sistema. Con 1.000 mensajes
// diarios y un descarte del 85%, la IA ve 150 y el mes cuesta menos de 1 USD.
// Sin esta etapa, cuesta mas que todos los servicios de Railway juntos.
//
// REGLA DE DISENO: permisivo antes que preciso. Un falso positivo cuesta
// centavos y lo mata la Etapa 1. Un falso negativo es un negocio perdido que
// ademas nunca se ve — por eso el reporte dedica una seccion entera a revisar
// a mano lo que esta etapa descarto.

const { plano } = require("./parse-export");
const lexico = require("./lexico");
const { zonaTokens, distinctiveTokens } = require("../../src/data/properties");

// Cada zona conocida, reducida a sus tokens distintivos con el MISMO
// tokenizador que la busqueda de inventario: asi "loma del chocho" en un grupo
// se reconoce igual que en una consulta del bot, y "loma" a secas no basta
// (ver el bug de "loma del indio" vs "Loma del Chocho" en zona-search.test.js).
//
// Se guarda la zona ENTERA, no un Set plano de tokens sueltos: con tokens
// sueltos, el barrio "Buenos Aires" aporta "buenos" y entonces cada "buenos
// dias" del grupo —que es el 5-10% del trafico— cuenta como senal inmobiliaria
// y la tasa de descarte se desploma.
const ZONAS_TOKENIZADAS = lexico.ZONAS.map((z) => distinctiveTokens(zonaTokens(z))).filter((t) => t.length > 0);

function escapar(t) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Una sola alternacion con limites de palabra, para no matchear "casa" dentro
// de "casaca". Se construye una vez al cargar el modulo.
const TERMINOS = new RegExp(`\\b(${lexico.TODAS.map(escapar).join("|")})\\b`, "i");

// Una zona de varias palabras exige TODOS sus tokens ("buenos aires" no lo
// dispara "buenos" solo). Una de una palabra ("laureles") basta con ella.
function mencionaZona(texto) {
  const tokens = new Set(zonaTokens(texto));
  return ZONAS_TOKENIZADAS.some((zona) => zona.every((t) => tokens.has(t)));
}

// Senal inmobiliaria: basta UNA de las tres.
function tieneSenal(texto) {
  const t = plano(texto);
  return TERMINOS.test(t) || lexico.PRECIO.test(t) || mencionaZona(t);
}

// Texto util de un mensaje multimedia: WhatsApp a veces conserva el pie de
// foto junto al marcador de adjunto, y ese pie puede ser la ficha entera.
function textoSinMarcadorMultimedia(texto) {
  return texto
    .replace(/<[^>]*>/g, " ")
    .replace(/\b\w+\s+omitid[oa]\b/gi, " ")
    .trim();
}

function contarPalabras(texto) {
  return texto.split(/\s+/).filter(Boolean).length;
}

// Devuelve el motivo de descarte, o null si el mensaje pasa.
//
// El orden importa: la senal se evalua ANTES que la longitud, porque
// "3 alcobas Envigado" son tres palabras y es una oportunidad real. Filtrar
// por largo primero es el falso negativo mas caro y mas facil de cometer.
function motivoDescarte(mensaje) {
  if (mensaje.esSistema) return "sistema";

  const texto = mensaje.esMultimedia ? textoSinMarcadorMultimedia(mensaje.texto) : mensaje.texto;
  if (!texto) return "multimedia";

  if (tieneSenal(texto)) return null;

  return contarPalabras(texto) < 4 ? "muy_corto" : "sin_senal";
}

// mensajes: salida de parseExport. Devuelve los que siguen a la Etapa 1, los
// descartados (con su motivo, para poder auditarlos) y las metricas del embudo.
function prefilter(mensajes) {
  const pasan = [];
  const descartados = [];

  for (const m of mensajes) {
    const motivo = motivoDescarte(m);
    if (motivo) descartados.push({ ...m, motivoDescarte: motivo });
    else pasan.push(m);
  }

  const porMotivo = {};
  for (const d of descartados) porMotivo[d.motivoDescarte] = (porMotivo[d.motivoDescarte] || 0) + 1;

  const total = mensajes.length;
  return {
    pasan,
    descartados,
    stats: {
      total,
      pasan: pasan.length,
      descartados: descartados.length,
      tasaDescarte: total === 0 ? 0 : descartados.length / total,
      porMotivo,
    },
  };
}

module.exports = { prefilter, motivoDescarte, tieneSenal, mencionaZona };

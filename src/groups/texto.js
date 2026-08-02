// Utilidades de texto compartidas por el embudo de grupos.
//
// Vive aparte para que el prefiltro no tenga que depender del parser de
// exports `.txt`: en vivo los mensajes llegan como objetos por webhook y ese
// parser no pinta nada en produccion.

// Diacriticos sueltos tras normalizar en NFD.
//
// El rango va como escapes y NO como los caracteres combinantes literales:
// escritos literales son invisibles en el editor y se pierden en cualquier
// conversion de encoding o en un bundler. Si eso pasa, plano() deja de quitar
// acentos EN SILENCIO — el prefiltro sigue corriendo, solo deja de reconocer
// "Belen". Lo custodia test/texto.test.js.
const DIACRITICOS = /[\u0300-\u036f]/g;

// Sin acentos y en minusculas. Todo el lexico y los marcadores se comparan
// contra esta forma, asi que un mensaje acentuado y otro sin acentos dan el
// mismo resultado.
function plano(texto) {
  return String(texto ?? "").toLowerCase().normalize("NFD").replace(DIACRITICOS, "");
}

module.exports = { plano, DIACRITICOS };

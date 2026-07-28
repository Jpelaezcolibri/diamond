// Utilidades de texto compartidas por el embudo de grupos.
//
// Vive aparte para que el prefiltro no tenga que depender del parser de
// exports `.txt`: en vivo los mensajes llegan como objetos por webhook y ese
// parser no pinta nada en produccion.

// Diacriticos sueltos tras normalizar en NFD.
const DIACRITICOS = /[̀-ͯ]/g;

// Sin acentos y en minusculas. Todo el lexico y los marcadores se comparan
// contra esta forma, asi que un mensaje acentuado y otro sin acentos dan el
// mismo resultado.
function plano(texto) {
  return String(texto ?? "").toLowerCase().normalize("NFD").replace(DIACRITICOS, "");
}

module.exports = { plano, DIACRITICOS };

// El carril de arriendo/amoblados: su interruptor y su umbral.
//
// POR QUE UN MODULO Y NO UN IF EN CADA PUERTA (Juan, 2026-09-05, despues de
// los 1.906 avisos a una sola asesora): la guardia va DENTRO del modulo del
// carril, no en quien lo llama, porque casi siempre hay mas de una puerta.
// Aca son cuatro: la escucha en vivo (asistir), la aprobacion manual, el DM
// manual y el camino que publica en el grupo. Si cada una implementara la
// regla por su cuenta, apagar el carril dejaria alguna hablando — que es
// exactamente lo que paso con `mandatos_activos`.
//
// Y no admite excepciones razonadas adentro. Una excepcion bien argumentada
// dentro de un kill switch es un kill switch roto, por bien escrita que este
// en el comentario.

// El default de 85 es lo que Juan llamo "muy cerca de lo que pide" (2026-09-07)
// -- por encima del umbral general de 70 de publicable.js, porque el
// inventario de arriendo es de dos propiedades y una respuesta floja se paga
// con la reputacion de la linea, no con una comision.
const UMBRAL_DEFAULT = 85;

// Se leen en cada llamada y no al cargar el modulo: el interruptor tiene que
// poder apagarse desde Railway sin redesplegar, y un `const` arriba obligaria
// a reiniciar el proceso para que tome efecto.
function carrilActivo() {
  return process.env.RADAR_AMOBLADO_ACTIVO !== "false";
}

function umbralDm() {
  return Number(process.env.RADAR_AMOBLADO_UMBRAL_DM || UMBRAL_DEFAULT);
}

// TODA demanda de arriendo, no solo la que dice la palabra amoblado: nuestro
// inventario de arriendo es 100% amoblado, asi que un pedido que no menciona
// muebles igual cruza contra un amoblado. Las demandas de venta no se tocan.
function esDelCarril(clasificado) {
  return String(clasificado?.operacion || "").trim().toLowerCase() === "arriendo";
}

/**
 * Si alguna de las candidatas calza lo bastante fino como para que el DM salga
 * sin que lo mire una persona.
 *
 * `matches` son las que YA pasaron publicable.filtrar. Se exige puntaje y
 * ademas que no quede la duda del amoblado: un 95 sobre una propiedad de la
 * que no sabemos si tiene muebles no es un 95 para este carril.
 */
function puedeSalirSolo(matches) {
  if (!carrilActivo()) return false;
  const umbral = umbralDm();
  return (matches || []).some((m) => Number(m.puntaje) >= umbral && !m.amoblado_sin_confirmar);
}

module.exports = { esDelCarril, carrilActivo, umbralDm, puedeSalirSolo, UMBRAL_DEFAULT };

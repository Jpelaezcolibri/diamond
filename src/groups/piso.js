// En que piso esta una propiedad, derivado del texto de su ficha.
//
// POR QUE DERIVADO Y NO UNA COLUMNA (2026-09-18): Wasi TIENE el campo, pero
// esta vacio o al reves de la realidad. Medido contra la web publica ese dia:
// en 8 de 8 apartamentos la ficha no trae el campo Piso; en el unico que lo
// trae —la ref 10012722— dice "Piso: 1" y el apartamento esta en el 19, como
// dicen su titulo ("PISO ALTO CON VISTA") y su descripcion ("Piso 19 con
// vista"). Sincronizar ese campo hoy pondria la compuerta sobre un dato vacio
// y, donde esta lleno, mentiroso. El texto lo dice en 40 de los 90
// apartamentos del inventario.
//
// El dia que Wasi lo tenga cargado de verdad, esta funcion lee el campo
// primero y nadie mas se entera.
//
// Modulo hoja a proposito, igual que ./amoblado.js: lo llama match.js por cada
// candidata de cada pedido, asi que no puede tener I/O ni dependencias.

// LOS FALSOS POSITIVOS SON EL RIESGO REAL de este modulo, y no fallan
// ruidosamente: leer mal un piso manda un apartamento del 19 a quien pidio
// maximo segundo. Hay cuatro familias, y las cuatro estan en el inventario
// (la cuarta esta declarada mas abajo, con su caso):
//
//   · EL MATERIAL. "Pisos en madera", "piso de ceramica", "pisos laminados".
//     Es la palabra mas comun de una descripcion inmobiliaria.
//   · LA ALTURA DE LA CASA. "Casa de dos pisos", "casa de 3 pisos": eso cuenta
//     plantas, no dice en que nivel del edificio esta.
//   · LA FRASE SUELTA. "Se sube al piso por escalas".
//
// Por eso NO se busca "piso" cerca de un numero: se exige una de las formas
// que de verdad nombran una ubicacion.
const MATERIAL = /pisos?\s+(en|de)\s+(madera|ceramica|cerámica|porcelanato|marmol|mármol|laminad|baldosa|tabl|granito|vinilo|alfombr)/i;
const PLANTAS = /\b(de|con)\s+(un|dos|tres|cuatro|\d)\s+pisos\b/i;

// LA CUARTA FAMILIA, encontrada corriendo el modulo contra las 90 fichas del
// inventario (2026-09-18): el piso de OTRA COSA del edificio. La ref 9777884
// devolvia 1 por "Restaurante en el primer piso (proximamente)" — el piso del
// restaurante, no el del apartamento, que esa ficha no dice en ninguna parte.
// Se borra la frase entera (el sujeto y su piso), no solo la palabra: lo que
// queda despues se sigue leyendo, asi que una ficha que nombra el local Y el
// piso del apartamento conserva el segundo.
const OTRO_SUJETO = /\b(restaurante|coworking|local(?:es)?|recepci[oó]n|porter[ií]a|gimnasio|sal[oó]n|lobby|comercio|caf[eé]|tienda|oficinas?|parqueaderos?|dep[oó]sito)\b[^.,;]{0,40}?\b(?:en\s+el\s+|del\s+)?(?:[uú]ltimo|primer(?:o|a)?|segundo|tercer(?:o|a)?|\d{1,2}[^\s]*)\s+pisos?\b/gi;

// "Piso 19", "piso No 3", "piso #4", "3er piso", "3 piso".
const NUMERO = [
  /\bpisos?\s*(?:n[ou]\.?|n[uú]mero|#)?\s*(\d{1,2})\b/i,
  /\b(\d{1,2})\s*(?:er|do|to|mo|vo|no|°|º)?\s+piso\b/i,
];
const ORDINALES = [
  [/\bprimer(?:o|a)?\s+piso\b|\bpiso\s+primer(?:o|a)?\b/i, 1],
  [/\bsegundo\s+piso\b|\bpiso\s+segundo\b/i, 2],
  [/\btercer(?:o|a)?\s+piso\b|\bpiso\s+tercer(?:o|a)?\b/i, 3],
  [/\bcuarto\s+piso\b|\bpiso\s+cuarto\b/i, 4],
];
const ALTO = /\bpisos?\s+alt[oa]s?\b|\balt[oa]\s+piso\b/i;
const BAJO = /\bpisos?\s+baj[oa]s?\b|\bbaj[oa]\s+piso\b/i;

// Nada por encima de esto se cree: el edificio mas alto del inventario ronda
// los 30 pisos, y un numero mayor casi siempre es otra cosa que quedo pegada
// a la palabra ("piso 80 m2").
const PISO_MAXIMO_CREIBLE = 40;

/**
 * @returns un numero (el piso), "alto", "bajo", o null si el texto no lo dice.
 *
 * `null` NO significa "planta baja": significa que no se sabe. Ante un pedido
 * que exige piso, match.js lo marca `piso_sin_confirmar` y publicable.js
 * impide que salga sola — el mismo trato que amoblado.
 */
function pisoDe(propiedad) {
  if (!propiedad) return null;
  const texto = [propiedad.titulo, propiedad.descripcion].filter(Boolean).join(" ");
  if (!texto.trim()) return null;

  // Se limpian PRIMERO las frases que usan la palabra para otra cosa. Si se
  // buscara el numero antes, "casa de 3 pisos" daria 3.
  const limpio = texto.replace(MATERIAL, " ").replace(PLANTAS, " ").replace(OTRO_SUJETO, " ");

  for (const rx of NUMERO) {
    const m = limpio.match(rx);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= PISO_MAXIMO_CREIBLE) return n;
    }
  }
  for (const [rx, n] of ORDINALES) {
    if (rx.test(limpio)) return n;
  }
  if (ALTO.test(limpio)) return "alto";
  if (BAJO.test(limpio)) return "bajo";
  return null;
}

module.exports = { pisoDe, PISO_MAXIMO_CREIBLE };

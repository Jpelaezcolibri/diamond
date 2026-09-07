// Si una propiedad esta amoblada, derivado del texto que SI tenemos.
//
// POR QUE DERIVADO Y NO UNA COLUMNA (2026-09-07): Wasi no expone el dato.
// Verificado contra las dos propiedades de arriendo de produccion: sus
// `caracteristicas` traen 24 y 43 items ("Admite mascotas", "Ascensor",
// "Sauna"...) y NINGUNA dice amoblado. La palabra vive solo en el titulo:
// "Apartamento Amoblado en Arriendo en Don Quijote, Medellin".
//
// Una columna seria igual de inferida, pero ademas obligaria a tocar DMAP,
// correr una migracion y hacer backfill: tres pasos para el mismo grado de
// certeza. El dia que Wasi lo exponga de verdad, esta funcion lee el campo y
// nadie mas se entera.
//
// Modulo hoja a proposito: lo llama match.js por cada candidata de cada
// pedido, asi que no puede tener I/O ni dependencias.

// "amoblad" cubre amoblado/amoblada/amoblados; "amueblad", la variante que
// usan algunos colegas. No se incluye "amoblar" (infinitivo): aparece casi
// siempre dentro de "sin amoblar", que es lo contrario.
//
// Las palabras de negacion ("sin", "no") van ancladas con \b (frontera de
// palabra). Sin esto, "no" en palabras como "moderno" dispara el patron:
// "Apartamento moderno amoblado" falla como false cuando deberia ser true.
const PATRON_SI = /amoblad|amueblad/i;
const PATRON_NO = /\bsin\s+amoblar|\bsin\s+amueblar|\bsin\s+muebles|\bno\s+amoblad|\bno\s+amueblad/i;

/**
 * @returns true  si el texto dice que esta amoblada
 *          false si dice explicitamente que NO
 *          null  si no se puede saber
 *
 * `null` NO es `false`: ante un pedido de amoblado, `false` descarta la
 * candidata y `null` la deja pasar marcada `amoblado_sin_confirmar`, que es
 * lo que hace que el pedido llegue igual a la asesora. Colapsarlos pierde
 * pedidos sin que nada falle ruidosamente.
 */
function esAmoblada(propiedad) {
  if (!propiedad) return null;
  const texto = [propiedad.titulo, propiedad.caracteristicas].filter(Boolean).join(" ");
  if (!texto.trim()) return null;
  // El negativo se evalua PRIMERO: "no amoblado" contiene "amoblad" y el
  // patron positivo lo daria por bueno.
  if (PATRON_NO.test(texto)) return false;
  if (PATRON_SI.test(texto)) return true;
  return null;
}

module.exports = { esAmoblada, PATRON_SI, PATRON_NO };

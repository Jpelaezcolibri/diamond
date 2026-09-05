// Formato de valores que se muestran a un humano: precio, area, plurales y
// titulos. Fuente unica de verdad.
//
// Por que existe: antes de este modulo habia NUEVE formateadores de precio
// distintos repartidos por el repo (match.js, ofertas.js, advisor.js, tools.js,
// senales-grupos.tsx, report.js, sofi-comando-tools.js, web/lib/price.ts...), y
// el unico render que se publica en un grupo gremial no usaba ninguno: imprimia
// la columna `precio` en crudo. La columna es TEXT y trae lo que un asesor
// tecleo en Wasi, asi que "en crudo" incluye "$0" y typos.
//
// Es JS plano CommonJS a proposito: lo consume el bot. La version TypeScript de
// la landing (web/lib/price.ts) queda como esta; si algun dia se unifican, esta
// es la implementacion correcta porque arregla el bug de digitos concatenados.

// Precio: se toma el PRIMER grupo numerico del texto, no todos los digitos.
//
// El bug que esto arregla: `raw.replace(/\D/g, "")` sobre
// "$450.000.000 negociable 2024" concatena TODO y devuelve 4500000002024 — un
// entero perfectamente valido, 10.000 veces mas caro que la propiedad. Nadie lo
// detecta porque no falla: solo publica un disparate.
const PRIMER_NUMERO = /\d[\d.,\s]*/;

// "1.200 millones" aparece en como escribe la gente, no en los labels de Wasi,
// pero cuesta poco soportarlo y evita interpretar 1.200 como mil doscientos pesos.
const MENCIONA_MILLONES = /mill?[oó]n(?:es)?\b|\bmm\b/i;

function parsearPrecio(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw > 0 ? raw : null;

  const texto = String(raw);
  const encontrado = texto.match(PRIMER_NUMERO);
  if (!encontrado) return null;

  // Separadores de miles fuera; no se soportan decimales en precios COP.
  const digitos = encontrado[0].replace(/[^\d]/g, "");
  if (!digitos) return null;

  let valor = Number(digitos);
  if (!Number.isSafeInteger(valor) || valor <= 0) return null;

  // "1.200 millones" -> 1.200.000.000. Solo si el numero es chico: un label ya
  // expandido ("$1.200.000.000 millones", que existe) no se multiplica de nuevo.
  if (MENCIONA_MILLONES.test(texto) && valor < 1_000_000) valor = valor * 1_000_000;

  return valor;
}

function formatearPrecio(valor) {
  const n = parsearPrecio(valor);
  return n === null ? null : `$${n.toLocaleString("es-CO")}`;
}

// Version corta para lugares donde el espacio manda (chips, una linea de resumen).
function formatearPrecioCorto(valor) {
  const n = parsearPrecio(valor);
  if (n === null) return null;
  if (n >= 1_000_000_000) {
    const mm = n / 1_000_000_000;
    return `$${Number.isInteger(mm) ? mm : mm.toFixed(1)}MM`;
  }
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  return `$${n.toLocaleString("es-CO")}`;
}

// Area: Wasi entrega "186m2" (sin espacio, unidad en minuscula y pegada). Se
// acepta decimal con coma o punto — "10,5 m2" es un area real, no un typo.
function parsearArea(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw > 0 ? raw : null;
  const encontrado = String(raw).replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!encontrado) return null;
  const valor = Number(encontrado[0]);
  return valor > 0 ? valor : null;
}

function formatearArea(raw) {
  const n = parsearArea(raw);
  if (n === null) return null;
  const numero = Number.isInteger(n) ? n : Number(n.toFixed(1));
  return `${numero.toLocaleString("es-CO")} m²`;
}

// "0 = SIN DATO", EN UN SOLO LUGAR (auditoria 2026-09-05, H6). Wasi manda 0
// cuando el campo no se cargo (medido: garaje = 0 en 39 de 114 disponibles,
// null en cero), asi que para baños, garajes, estrato y las exigencias del
// pedido un 0 significa "no lo sabemos", nunca "no tiene". Esa regla vivia
// repetida en match.js, revalidar.js, redactar.js, alerta-asesor.js y
// cruce-mandatos.js con cinco expresiones distintas (`> 0`, `== null ||
// !(x > 0)`, `Number(v) > 0`...). Un solo predicado para los cinco: si algun
// dia Wasi distingue el 0 real, se cambia aca y no en cinco archivos.
function datoCargado(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0;
}

// "1 alcobas" era el bug: `${n} alcobas` sin singular, en senales-grupos.tsx y
// en advisor.js. Se ve en el primer mensaje que lea un colega.
function pluralizar(cantidad, singular, plural = null) {
  if (!datoCargado(cantidad)) return null;
  const n = Number(cantidad);
  const palabra = n === 1 ? singular : plural || `${singular}s`;
  return `${n} ${palabra}`;
}

// Palabras que en un titulo van en minuscula salvo que abran la frase.
const MENORES = new Set(["de", "del", "la", "las", "el", "los", "en", "y", "con", "a", "al", "para", "por", "sin"]);

// Los titulos vienen tal como se teclearon en Wasi: MAYUSCULAS SOSTENIDAS,
// dobles espacios, a veces ambas. En un grupo de 80 competidores, gritar es la
// firma de un copiar-pegar descuidado.
function normalizarTitulo(raw) {
  if (!raw) return null;
  const limpio = String(raw).replace(/\s+/g, " ").trim();
  if (!limpio) return null;

  const letras = limpio.replace(/[^a-záéíóúñü]/gi, "");
  if (!letras) return limpio;
  const mayusculas = limpio.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, "").length;
  // Menos de 70% en mayuscula: el autor escribio normal, no se toca. Asi se
  // respetan siglas y nombres propios en titulos bien escritos.
  if (mayusculas / letras.length < 0.7) return limpio;

  return limpio
    .toLocaleLowerCase("es-CO")
    .split(" ")
    .map((palabra, i) => {
      if (i > 0 && MENORES.has(palabra)) return palabra;
      return palabra.charAt(0).toLocaleUpperCase("es-CO") + palabra.slice(1);
    })
    .join(" ");
}

module.exports = {
  parsearPrecio,
  formatearPrecio,
  formatearPrecioCorto,
  parsearArea,
  formatearArea,
  datoCargado,
  pluralizar,
  normalizarTitulo,
};

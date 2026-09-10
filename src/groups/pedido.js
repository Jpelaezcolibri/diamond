// Como se describe un pedido de colega, en un solo lugar (Juan, 2026-09-10).
//
// Dos lectores con la misma necesidad: el DM al colega (redactar.js, "te
// respondo tu PEDIDO 645") y el aviso a la asesora (alerta-asesor.js, la linea
// "Busca:" y "Pedido: N° 645"). Si cada uno describiera el pedido a su manera,
// el colega y la asesora terminarian hablando de dos pedidos distintos por
// telefono.
//
// El caso que lo motivo: Angela Moscoso, 2026-09-09 — "de la empresa me estan
// enviando opciones pero no me describen para que pedido es". Medido el
// 2026-09-10 sobre 1.240 demandas: solo 47 (3,8 %) traen numero de pedido, asi
// que el numero solo no alcanza; al resto hay que describirle el pedido.

const formato = require("../lib/formato");

// Los formatos reales medidos en produccion (2026-09-10): "PEDIDO 👉 645",
// "_*PEDIDO 👉 645*_", "Pedido #201", "Pedido 12026", "Pedido 02👈" y el codigo
// "C_647". Entre la palabra y el numero se aceptan hasta 8 caracteres que no
// sean letras ni digitos (emojis, asteriscos, "#", ":"); una letra corta
// ("pedidos", "pedido de") y ahi no hay numero.
//
// Un "#123" SUELTO no se acepta: puede ser una direccion ("Calle 10 #43") o un
// apartamento, y un numero de pedido equivocado confunde mas que no ponerlo.
// Minimo 2 digitos por lo mismo: en "Pedido: 3 alcobas" el 3 no es el pedido.
const PATRONES_NUMERO = [
  /pedido[^\p{L}\p{N}]{0,8}(\d{2,6})(?!\d)/iu,
  /(?<![\p{L}\p{N}])C_(\d{2,6})(?!\d)/u,
];

function numeroPedido(texto) {
  const t = String(texto || "");
  for (const patron of PATRONES_NUMERO) {
    const m = t.match(patron);
    if (m) return m[1];
  }
  return null;
}

// Lo que busca el colega, en una linea (Juan, 2026-09-02): "que entienda que
// busca el colega". Movida tal cual desde alerta-asesor.js#queBusca
// (2026-09-10) para que el DM pueda describir el pedido con los mismos datos.
// Se muestran SOLO los campos que el pedido menciono: una linea con huecos
// ("hasta $0", "0 alcobas") seria peor que no ponerla.
function resumenPedido(senal) {
  const s = senal || {};
  const zonas = Array.isArray(s.zonas) && s.zonas.length ? s.zonas.join(", ") : s.zona;
  const partes = [
    s.operacion,
    s.tipo,
    zonas,
    formato.datoCargado(s.precio_max) ? `hasta ${formato.formatearPrecio(s.precio_max)}` : null,
    formato.datoCargado(s.habitaciones)
      ? `${formato.pluralizar(s.habitaciones, "alcoba")}${s.flexible_habitaciones ? " (o una menos con estudio)" : ""}`
      : null,
    formato.datoCargado(s.area_min) ? `desde ${s.area_min} m²` : null,
    formato.pluralizar(s.banos, "baño", "baños"),
    formato.pluralizar(s.garajes, "garaje"),
    formato.datoCargado(s.estrato) ? `estrato ${s.estrato}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

const MENORES = new Set(["de", "del", "la", "las", "el", "los", "y", "en"]);

// El clasificador guarda las zonas en minuscula ("la estrella"); en un mensaje
// para una persona van como nombre propio.
function capitalizarZona(zona) {
  return String(zona || "")
    .trim()
    .split(/\s+/)
    .map((palabra, i) => {
      const p = palabra.toLocaleLowerCase("es-CO");
      if (i > 0 && MENORES.has(p)) return p;
      return p.charAt(0).toLocaleUpperCase("es-CO") + p.slice(1);
    })
    .join(" ");
}

function unirConO(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} o ${items[items.length - 1]}`;
}

// El pedido como frase, para el saludo del DM: "apartamento en Envigado,
// Itagüí o Sabaneta, hasta $350.000.000, 2 alcobas". Solo tipo, zonas, tope y
// alcobas: es para que el colega RECONOZCA su pedido, no para repetirselo
// entero. Sin tipo, zona ni precio no hay nada reconocible y devuelve null
// (el saludo cae al fragmento de su propio texto).
function frasePedido(pedido) {
  if (!pedido) return null;
  const tipo = String(pedido.tipo || "").trim().toLocaleLowerCase("es-CO");
  const zonas = (Array.isArray(pedido.zonas) && pedido.zonas.length ? pedido.zonas : [pedido.zona])
    .map((z) => String(z || "").trim())
    .filter(Boolean)
    .map(capitalizarZona);
  const precio = formato.datoCargado(pedido.precio_max) ? formato.formatearPrecio(pedido.precio_max) : null;
  if (!tipo && !zonas.length && !precio) return null;

  let cabeza = tipo || "propiedad";
  if (/arriendo|renta|alquiler/i.test(String(pedido.operacion || ""))) cabeza += " en arriendo";
  if (zonas.length) cabeza += ` en ${unirConO(zonas)}`;
  return [cabeza, precio ? `hasta ${precio}` : null, formato.pluralizar(pedido.habitaciones, "alcoba")]
    .filter(Boolean)
    .join(", ");
}

// Las primeras palabras del pedido tal como lo escribio el colega, sin emojis,
// asteriscos ni guiones bajos de WhatsApp. Es el respaldo cuando el
// clasificador no saco nada reconocible: el colega reconoce sus propias
// palabras mejor que cualquier resumen.
function fragmentoPedido(texto, max = 60) {
  const limpio = String(texto || "")
    .replace(/[^\p{L}\p{N}\s.,$:/()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (limpio.length < 8) return null;
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > 30 ? corte.slice(0, espacio) : corte).trim()}…`;
}

const TZ = "America/Bogota";
const diaEnBogota = (fecha) => fecha.toLocaleDateString("en-CA", { timeZone: TZ });

// "8 de septiembre" si el pedido es de OTRO dia que hoy (en Bogota), o null.
// Los caminos manuales pueden mandar el DM dias despues del pedido; ahi el
// colega necesita saber de cual de sus pedidos le hablamos.
function fechaSiEsOtroDia(fechaIso, ahora = new Date()) {
  if (!fechaIso) return null;
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) return null;
  if (diaEnBogota(fecha) === diaEnBogota(ahora)) return null;
  return fecha.toLocaleDateString("es-CO", { timeZone: TZ, day: "numeric", month: "long" });
}

module.exports = { numeroPedido, resumenPedido, frasePedido, fragmentoPedido, fechaSiEsOtroDia };

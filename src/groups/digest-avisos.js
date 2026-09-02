// El mensaje agrupado que recibe la asesora cuando hay varias cosas pendientes.
//
// POR QUE EXISTE (Juan, 2026-09-02, mirando su propio chat): "no quiero que
// seas tan insistente", "si un solo cliente envia 10 solicitudes que se
// agrupen y se envien agrupadas al asesor". Medido ese dia entre las 05:59 y
// las 08:33 — menos de tres horas: 23 mensajes a Natalia (18 de un solo
// mandato) y 14 a Catherine (11 del mismo), cero respuestas de las dos, y
// CUATRO rechazados por WhatsApp con `(#131056) pair rate limit hit`, el
// limite de frecuencia entre un numero de negocio y una persona. Tres de esas
// ofertas salieron en el mismo minuto. El volumen ya nos estaba costando
// entregas, no solo paciencia.
//
// LA LINEA QUE NO SE CRUZA: esto agrupa lo que va HACIA EL ASESOR. El DM
// automatico al colega (src/groups/vivo.js#asistir) sigue saliendo uno por
// uno, inmediato y con sus reglas intactas — "ya si la respuesta es
// automatica al colega se debe dejar responder uno por uno que cumpla con las
// reglas de validacion que tenemos" (Juan, mismo dia). Son dos destinatarios
// con necesidades opuestas: al colega le respondes SU pedido; a la asesora le
// das una bandeja.
//
// CON UN SOLO PENDIENTE NO PASA NADA POR ACA: quien llama manda el mensaje
// completo de siempre. Este modulo solo existe para dos o mas.

const formato = require("../lib/formato");

const MAX_ITEMS = 12;

function millones(valor) {
  const n = formato.parsearPrecio(valor);
  if (n === null) return null;
  return `$${Math.round(n / 1_000_000)}M`;
}

// Una linea por pedido de colega. Lo que la asesora necesita para decidir si
// pide el detalle: quien lo pidio, que busca y cuantas propiedades tenemos.
function lineaPedido(p, i) {
  const que = [p.operacion, p.tipo, p.zona, p.precioMax ? `hasta ${millones(p.precioMax)}` : null]
    .filter(Boolean)
    .join(" · ");
  const cuantas = p.utiles > 0 ? `${p.utiles} para ofrecer` : `${p.dudosas} para revisar`;
  return `${i}. ${p.colega || "un colega"} — ${que || "sin detalle"}\n   ${cuantas}`;
}

// Una linea por oferta de colega que le sirve a un mandato.
function lineaOferta(o, i) {
  const ficha = [o.zona, millones(o.precio), o.habitaciones ? `${o.habitaciones} alc` : null]
    .filter(Boolean)
    .join(" · ");
  const pero = o.reparos && o.reparos.length ? `\n   ${o.reparos.join(" · ")}` : "";
  return `${i}. ${ficha}${pero}`;
}

/**
 * Arma el digest.
 *
 * @param nombre    primer nombre de la asesora, para el saludo
 * @param pedidos   [{ id, colega, operacion, tipo, zona, precioMax, utiles, dudosas }]
 * @param ofertas   [{ id, mandato, zona, precio, habitaciones, reparos: [], cumpleTodo }]
 * @returns el texto, o null si no hay nada
 */
function construir(nombre, pedidos = [], ofertas = []) {
  const total = pedidos.length + ofertas.length;
  if (total === 0) return null;

  const partes = [`📋 ${nombre || "Hola"}, tenés ${total} cosas nuevas del radar.`];

  if (pedidos.length) {
    // Agrupadas por colega: si el mismo publico varias, se cuentan juntas en
    // vez de ocupar una linea cada una. Es el caso que Juan nombro.
    const porColega = new Map();
    for (const p of pedidos) {
      const k = p.colega || "un colega";
      if (!porColega.has(k)) porColega.set(k, []);
      porColega.get(k).push(p);
    }
    partes.push(``, `👤 PEDIDOS DE COLEGAS (${pedidos.length})`);
    let i = 0;
    for (const [colega, suyos] of porColega) {
      if (i >= MAX_ITEMS) break;
      if (suyos.length === 1) {
        partes.push(lineaPedido({ ...suyos[0], colega }, ++i));
      } else {
        // Varios pedidos del MISMO colega: una sola entrada, con el detalle
        // adentro. Es exactamente lo que evita los diez mensajes seguidos.
        partes.push(`${++i}. ${colega} — ${suyos.length} pedidos distintos`);
        for (const s of suyos.slice(0, 4)) {
          const que = [s.operacion, s.tipo, s.zona, s.precioMax ? `hasta ${millones(s.precioMax)}` : null]
            .filter(Boolean)
            .join(" · ");
          partes.push(`   · ${que || "sin detalle"}`);
        }
        if (suyos.length > 4) partes.push(`   · y ${suyos.length - 4} más`);
      }
    }
  }

  if (ofertas.length) {
    const porMandato = new Map();
    for (const o of ofertas) {
      const k = o.mandato || "un cliente";
      if (!porMandato.has(k)) porMandato.set(k, []);
      porMandato.get(k).push(o);
    }
    for (const [mandato, suyas] of porMandato) {
      const cumplen = suyas.filter((o) => o.cumpleTodo);
      const revisar = suyas.filter((o) => !o.cumpleTodo);
      partes.push(``, `🏠 OFERTAS PARA ${String(mandato).toUpperCase()} (${suyas.length})`);
      let i = 0;
      if (cumplen.length) {
        partes.push(`Cumplen todo:`);
        for (const o of cumplen.slice(0, MAX_ITEMS)) partes.push(lineaOferta(o, ++i));
      }
      if (revisar.length) {
        partes.push(cumplen.length ? `Para revisar:` : `Ninguna cumple del todo:`);
        for (const o of revisar.slice(0, MAX_ITEMS)) partes.push(lineaOferta(o, ++i));
      }
    }
  }

  partes.push(
    ``,
    `Respondé con el número para ver la ficha completa y el contacto del colega.`,
    `Si alguna ya la trabajaste, contame en qué quedó — con eso el radar aprende.`
  );

  return partes.join("\n");
}

module.exports = { construir, MAX_ITEMS };

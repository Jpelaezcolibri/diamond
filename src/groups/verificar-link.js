// Confirma que el link que estamos a punto de publicar realmente abre.
//
// QUE LINK, EXACTAMENTE (cambio 2026-08-18, mensaje "blanqueado")
//
// Hasta el mensaje "blanqueado" esto verificaba la landing propia
// (`match.link`), porque ese era el link que se publicaba. Desde que
// src/groups/redactar.js publica `match.linkWasi` en su lugar (ver la nota de
// diseno ahi), verificar la landing no comprueba nada sobre el artefacto real
// que recibe el colega — se puede aprobar un link de Diamond sano mientras el
// de Wasi que de verdad sale al grupo esta muerto. Por eso esto verifica
// `linkWasi`, no `link`.
//
// publicable.js ya garantizo (motivo sin_link_wasi) que `linkWasi` viene no
// vacio en toda propiedad que llega hasta aca.
//
// Se consulta Wasi por mensaje a proposito de este cambio: es el unico link
// que se publica, asi que es el unico que vale la pena comprobar en la ruta
// critica. Corre solo sobre las <=3 finalistas y solo en los pocos mensajes al
// dia que llegan hasta la publicacion, asi que su costo es irrelevante.

const TIMEOUT_MS = Number(process.env.GRUPOS_LINK_TIMEOUT_MS || 6000);

// Un link verificado no cambia de estado en minutos, y el limite de frecuencia
// hace que se publique poco: alcanza con recordar el resultado un rato.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // url -> { at, ok }

async function abre(url) {
  const c = cache.get(url);
  if (c && Date.now() - c.at < CACHE_MS) return c.ok;

  let ok = false;
  try {
    // GET y no HEAD: Next sirve las rutas dinamicas y algunos hosts responden
    // 405 a HEAD aunque el GET este perfecto. `redirect: "follow"` porque el
    // slug viejo de un titulo cambiado redirige 301 al canonico, y eso es un
    // link sano, no uno roto.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "DiamondRadar/1.0 (verificacion de link antes de publicar)" },
    });
    ok = res.ok;
    if (!ok) console.warn(`[radar] El link no abre (${res.status}): ${url}`);
  } catch (e) {
    // Falla cerrada: si no se puede comprobar, no se publica. Un link roto
    // delante de 80 competidores cuesta mas que perder un match.
    console.warn(`[radar] No se pudo verificar el link: ${url} — ${e.message}`);
    ok = false;
  }

  cache.set(url, { at: Date.now(), ok });
  return ok;
}

/**
 * Devuelve { verificadas, rotas } sobre la lista que YA paso la compuerta de
 * calidad. Se consultan en paralelo: son tres como maximo.
 */
async function verificar(publicables) {
  const lista = publicables || [];
  if (lista.length === 0) return { verificadas: [], rotas: [] };

  const resultados = await Promise.all(lista.map((m) => abre(m.linkWasi)));
  const verificadas = lista.filter((_, i) => resultados[i]);
  const rotas = lista.filter((_, i) => !resultados[i]).map((m) => ({ ref: m.ref, link: m.linkWasi }));
  return { verificadas, rotas };
}

function _resetCache() {
  cache.clear();
}

module.exports = { verificar, TIMEOUT_MS, _resetCache };

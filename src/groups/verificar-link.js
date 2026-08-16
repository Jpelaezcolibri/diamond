// Confirma que el link que estamos a punto de publicar realmente abre.
//
// POR QUE CONTRA LA LANDING Y NO CONTRA WASI
//
// La landing lee de la MISMA tabla `properties` que el radar, filtrada por
// `disponible = true`. Asi que esto NO dice nada nuevo sobre si la propiedad se
// vendio — para eso esta la compuerta de frescura del sync
// (src/data/sync-estado.js), que es la que sabe si el inventario esta al dia.
//
// Lo que si verifica, y que hoy no verifica nada mas, es que el artefacto
// exacto que va a recibir el colega funcione:
//
//   · El slug lo construyen DOS implementaciones separadas —src/lib/slug.js en
//     el bot y web/lib/slug.ts en la landing— declaradas como replicas. Hoy
//     coinciden. El dia que alguien toque una y no la otra, el bot publica
//     links rotos y ningun test lo nota.
//   · El dominio puede no estar apuntando (el README decia un host y el codigo
//     otro).
//   · El deploy de la landing puede estar caido o a medias.
//
// No se consulta Wasi por mensaje a proposito: eso ya lo hace DMAP una vez al
// dia, y meterlo en la ruta critica sumaria credenciales, limites de tasa y una
// dependencia mas para poder contestar.
//
// Corre solo sobre las <=3 finalistas y solo en los pocos mensajes al dia que
// llegan hasta la publicacion, asi que su costo es irrelevante.

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

  const resultados = await Promise.all(lista.map((m) => abre(m.link)));
  const verificadas = lista.filter((_, i) => resultados[i]);
  const rotas = lista.filter((_, i) => !resultados[i]).map((m) => ({ ref: m.ref, link: m.link }));
  return { verificadas, rotas };
}

function _resetCache() {
  cache.clear();
}

module.exports = { verificar, TIMEOUT_MS, _resetCache };

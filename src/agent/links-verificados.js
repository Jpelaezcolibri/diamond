// Ningun link inventado llega al chat (caso Laura V., 2026-10-20): Sofi le
// paso a una colega "https://www.diamondinmobiliaria.co/ficha/10505674", una
// ruta que no existe en ningun sitio nuestro, y la colega contesto "No abre el
// link". Un link solo sale si aparece tal cual en alguna fuente del turno: el
// prompt, el historial o el resultado de una herramienta. Lo demas se cambia
// por una promesa honesta y se registra en el log.
const URL_RE = /https?:\/\/[^\s<>"'`)\]*]+/g;
const EN_SU_LUGAR = "(te confirmo el link en un momento)";

function quitarLinksInventados(texto, fuentes = []) {
  // El JSON de una herramienta puede traer "\/" en vez de "/".
  const corpus = fuentes.filter(Boolean).map(String).join("\n").split("\\/").join("/");
  const quitados = [];
  const salida = String(texto || "").replace(URL_RE, (m) => {
    const url = m.replace(/[.,;:!?]+$/, "");
    if (corpus.includes(url)) return m;
    quitados.push(url);
    return EN_SU_LUGAR + m.slice(url.length);
  });
  return { texto: salida, quitados };
}

module.exports = { quitarLinksInventados, EN_SU_LUGAR };

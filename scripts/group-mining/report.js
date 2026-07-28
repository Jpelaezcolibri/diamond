// Etapa 3: el reporte. Es el entregable real de la Fase 0 — el HTML es lo que
// Juan mira para decidir si el proyecto sigue o se cancela.
//
// Dos secciones hacen el trabajo pesado y ninguna es automatica:
//   · la muestra de descartados, que es la unica forma de cazar falsos
//     negativos (un mensaje bueno que el embudo mato no aparece en ningun lado);
//   · la tabla de detecciones, para juzgar si la clasificacion acierta.

const fs = require("node:fs");

// Umbrales del spec (docs/superpowers/specs/2026-07-28-sofi-grupos-whatsapp-design.md).
const UMBRALES = {
  descarte: 0.7,
  costoMensualUsd: 5,
  demandasPorDia: 5,
  demandasConMatch: 0.3,
  ofertasPorDia: 10,
  ofertasUtilizables: 0.6,
};

const TAMANO_MUESTRA = 100;

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const usd = (n) => `US$${n.toFixed(2)}`;
const pesos = (n) => (n > 0 ? `$${n.toLocaleString("es-CO")}` : "—");

// Muestreo determinístico (cada N-ésimo, no aleatorio): dos corridas sobre el
// mismo export dan la misma muestra y se pueden comparar tras ajustar el léxico.
function muestra(items, n = TAMANO_MUESTRA) {
  if (items.length <= n) return items;
  const paso = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * paso)]);
}

function fila(nombre, valor, ok, detalle) {
  const estado = ok === null ? '<span class="man">revisar a mano</span>'
    : ok ? '<span class="ok">PASA</span>' : '<span class="no">NO PASA</span>';
  return `<tr><td>${esc(nombre)}</td><td class="num">${esc(valor)}</td><td>${estado}</td><td class="det">${esc(detalle)}</td></tr>`;
}

function tablaCompuertas({ stats, rango, cruces, usoTokens }) {
  const dias = Math.max(1, rango.dias || 1);
  const demandas = cruces.demandas.length;
  const ofertas = cruces.ofertas.length;
  const conMatch = cruces.demandas.filter((d) => d.matches.length > 0).length;
  const utilizables = cruces.ofertas.filter((o) => o.utilizable).length;

  const ratio = (a, b) => (b === 0 ? 0 : a / b);
  const costoMes = ((usoTokens?.costoUsd || 0) / dias) * 30;

  return [
    fila("Descarte en Etapa 0", pct(stats.tasaDescarte), stats.tasaDescarte >= UMBRALES.descarte,
      `≥ ${pct(UMBRALES.descarte)} — debajo de eso el costo deja de ser trivial`),
    fila("Costo proyectado / mes", usd(costoMes), costoMes <= UMBRALES.costoMensualUsd,
      `≤ ${usd(UMBRALES.costoMensualUsd)} — medido sobre tokens reales, no estimado`),
    fila("Demandas detectadas / día", (demandas / dias).toFixed(1), demandas / dias >= UMBRALES.demandasPorDia,
      `≥ ${UMBRALES.demandasPorDia} — normalizado sobre ${dias} días transcurridos`),
    fila("Demandas con ≥1 match", pct(ratio(conMatch, demandas)), ratio(conMatch, demandas) >= UMBRALES.demandasConMatch,
      `≥ ${pct(UMBRALES.demandasConMatch)} — detectar sin poder responder no sirve`),
    fila("Ofertas detectadas / día", (ofertas / dias).toFixed(1), ofertas / dias >= UMBRALES.ofertasPorDia,
      `≥ ${UMBRALES.ofertasPorDia} — es un inventario que se acumula`),
    fila("Ofertas con datos utilizables", pct(ratio(utilizables, ofertas)), ratio(utilizables, ofertas) >= UMBRALES.ofertasUtilizables,
      `≥ ${pct(UMBRALES.ofertasUtilizables)} — sin precio o zona es una fila muerta`),
    fila("Precisión de clasificación", "—", null, "≥ 80% sobre 100 detecciones — revisá la tabla de abajo"),
    fila("Falsos negativos", "—", null, "≤ 10% sobre la muestra de descartados — la métrica que más importa"),
  ].join("\n");
}

function tablaDemandas(demandas) {
  if (demandas.length === 0) return "<p class='vacio'>No se detectó ninguna demanda.</p>";
  return `<table><thead><tr>
    <th>Grupo</th><th>Fecha</th><th>Colega</th><th>Mensaje</th><th>Extraído</th><th>Matches</th>
  </tr></thead><tbody>${demandas.map((d) => {
    const extraido = [d.operacion, d.tipo, d.zona, d.habitaciones > 0 ? `${d.habitaciones} alc` : "", d.precio_max > 0 ? `hasta ${pesos(d.precio_max)}` : ""].filter(Boolean).join(" · ");
    const matches = d.matches.length === 0 ? "<em>ninguno</em>"
      : d.matches.map((m) => `<span class="ref ${m.fuente}">${esc(m.ref || "s/ref")}</span> ${esc(m.zona || "")} ${esc(pesos(parseInt(String(m.precio).replace(/\D/g, ""), 10) || 0))}`).join("<br>");
    return `<tr>
      <td class="det">${esc(d.mensaje.grupo)}</td>
      <td class="det">${esc(d.mensaje.fechaIso)}</td>
      <td class="det">${esc(d.mensaje.autor)}</td>
      <td class="txt">${esc(d.mensaje.texto)}</td>
      <td class="det">${esc(extraido)}</td>
      <td>${matches}</td>
    </tr>`;
  }).join("\n")}</tbody></table>`;
}

function tablaOfertas(ofertas) {
  if (ofertas.length === 0) return "<p class='vacio'>No se detectó ninguna oferta.</p>";
  return `<table><thead><tr>
    <th>Grupo</th><th>Fecha</th><th>Colega</th><th>Mensaje</th><th>Extraído</th><th>¿Utilizable?</th>
  </tr></thead><tbody>${ofertas.map((o) => {
    const extraido = [o.operacion, o.tipo, o.zona, o.ciudad, pesos(o.precio_max || o.precio_min)].filter(Boolean).join(" · ");
    const veredicto = o.utilizable
      ? '<span class="ok">sí</span>'
      : `<span class="no">falta ${esc(o.faltantes.join(", "))}</span>`;
    return `<tr>
      <td class="det">${esc(o.mensaje.grupo)}</td>
      <td class="det">${esc(o.mensaje.fechaIso)}</td>
      <td class="det">${esc(o.mensaje.autor)}</td>
      <td class="txt">${esc(o.mensaje.texto)}</td>
      <td class="det">${esc(extraido)}</td>
      <td>${veredicto}</td>
    </tr>`;
  }).join("\n")}</tbody></table>`;
}

function tablaDescartados(descartados) {
  const m = muestra(descartados.filter((d) => !["sistema", "multimedia"].includes(d.motivoDescarte)));
  if (m.length === 0) return "<p class='vacio'>No hay mensajes descartados por falta de señal.</p>";
  return `<table><thead><tr><th>Grupo</th><th>Colega</th><th>Mensaje descartado</th><th>Motivo</th></tr></thead><tbody>${
    m.map((d) => `<tr>
      <td class="det">${esc(d.grupo)}</td>
      <td class="det">${esc(d.autor)}</td>
      <td class="txt">${esc(d.texto)}</td>
      <td class="det">${esc(d.motivoDescarte)}</td>
    </tr>`).join("\n")
  }</tbody></table>`;
}

const CSS = `
:root { color-scheme: light dark; --bd:#d6d3cd; --mut:#6b6660; --ok:#1a7f3c; --no:#b3261e; --man:#8a6d00; --bg2:rgba(128,128,128,.06); }
* { box-sizing: border-box; }
body { font: 15px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; padding: 2rem 1.5rem 5rem; max-width: 1180px; margin-inline: auto; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2.75rem 0 .5rem; padding-top: 1rem; border-top: 1px solid var(--bd); }
h2:first-of-type { border-top: 0; }
.sub, .nota { color: var(--mut); font-size: .875rem; }
.nota { margin: .25rem 0 1rem; }
.wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .875rem; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--bd); vertical-align: top; }
th { font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: var(--mut); }
tbody tr:nth-child(even) { background: var(--bg2); }
.num { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
.det { color: var(--mut); font-size: .8rem; }
.txt { max-width: 30rem; }
.ok { color: var(--ok); font-weight: 600; }
.no { color: var(--no); font-weight: 600; }
.man { color: var(--man); font-weight: 600; }
.vacio { color: var(--mut); font-style: italic; }
.ref { font-family: ui-monospace, monospace; font-size: .8rem; padding: .05rem .3rem; border-radius: 3px; background: var(--bg2); }
.ref.aliado { border: 1px dashed var(--bd); }
.aviso { border-left: 3px solid var(--man); padding: .6rem .9rem; margin: 1rem 0; background: var(--bg2); font-size: .875rem; }
`;

// destino: ruta del HTML. datos: lo que produce run.js.
function generarReporte(destino, { stats, rango, descartados, cruces, usoTokens, lotesFallidos = 0 }) {
  const dias = Math.max(1, rango.dias || 1);
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Minería de grupos — Fase 0</title>
<style>${CSS}</style>
<h1>Minería de grupos de WhatsApp — Fase 0</h1>
<p class="sub">${esc(rango.desde)} → ${esc(rango.hasta)} · ${dias} días · ${stats.total} mensajes · Diamond Inmobiliaria</p>

${lotesFallidos > 0 ? `<p class="aviso"><strong>${lotesFallidos} lote(s) de clasificación fallaron.</strong> Esos mensajes quedaron fuera del análisis, así que las cifras de abajo subestiman el resultado real. Volvé a correr antes de decidir.</p>` : ""}

<h2>Compuerta de decisión</h2>
<p class="nota">Se pasa a la Fase 1 sólo si se cumplen todas. Cada dirección se mide por separado: se puede aprobar sólo una mitad.</p>
<div class="wrap"><table><thead><tr><th>Métrica</th><th>Valor</th><th>Veredicto</th><th>Umbral</th></tr></thead>
<tbody>${tablaCompuertas({ stats, rango, cruces, usoTokens })}</tbody></table></div>

<h2>Embudo</h2>
<div class="wrap"><table><tbody>
  <tr><td>Mensajes totales</td><td class="num">${stats.total}</td><td class="det">${(stats.total / dias).toFixed(1)}/día</td></tr>
  <tr><td>Descartados en Etapa 0 (gratis)</td><td class="num">${stats.descartados}</td><td class="det">${Object.entries(stats.porMotivo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(k)}: ${v}`).join(" · ")}</td></tr>
  <tr><td>Enviados a la IA</td><td class="num">${stats.pasan}</td><td class="det">${usoTokens?.input_tokens || 0} tokens de entrada · ${usoTokens?.output_tokens || 0} de salida · ${usd(usoTokens?.costoUsd || 0)} en total</td></tr>
  <tr><td>Demandas</td><td class="num">${cruces.demandas.length}</td><td class="det">colegas que buscan algo para un cliente</td></tr>
  <tr><td>Ofertas</td><td class="num">${cruces.ofertas.length}</td><td class="det">propiedades disponibles de colegas</td></tr>
  <tr><td>Ruido</td><td class="num">${cruces.ruido.length}</td><td class="det">pasaron el prefiltro pero no eran señal</td></tr>
</tbody></table></div>

<h2>Dirección 2 — Demandas de colegas</h2>
<p class="nota">Un colega busca algo. Los matches son inventario de Diamond (<span class="ref">ref</span>) o de la red de aliados (<span class="ref aliado">ref</span>).</p>
<div class="wrap">${tablaDemandas(cruces.demandas)}</div>

<h2>Dirección 1 — Ofertas de colegas</h2>
<p class="nota">Propiedades que alimentarían <code>ally_properties</code>. En Fase 0 no se escribe nada en la base.</p>
<div class="wrap">${tablaOfertas(cruces.ofertas)}</div>

<h2>Muestra de descartados en Etapa 0</h2>
<p class="nota"><strong>La sección más importante del reporte.</strong> Es la única forma de ver los falsos negativos: un mensaje bueno que el embudo mató no aparece en ninguna otra parte. Muestreo determinístico, así que dos corridas se pueden comparar. Si encontrás oportunidades reales acá, el arreglo va en <code>src/groups/lexico.js</code>.</p>
<div class="wrap">${tablaDescartados(descartados)}</div>
`;

  fs.writeFileSync(destino, html, "utf8");
  return destino;
}

module.exports = { generarReporte, muestra, UMBRALES, TAMANO_MUESTRA };

// Publicador automatico de amoblados en grupos (spec docs/superpowers/specs/
// 2026-10-19-publicador-grupos-design.md). Logica pura: que propiedad es
// publicable en que grupo, cual toca ahora y con que texto. El envio, el
// registro y el freno viven en src/scheduler/publicador-grupos.js.
//
// Juan asumio el riesgo de baneo de publicar por WAHA (2026-10-19). Por eso
// todo lo de aca falla hacia "no publicar": una propiedad dudosa no sale, un
// grupo sin categoria no recibe nada.
const { aptaParaKit } = require("./kit");
const { esAmoblada } = require("./amoblado");

const DIA_MS = 86400000;
const DIAS_SIN_REPETIR = 7;
const HORA_INICIO = 8;
const HORA_FIN = 18; // exclusiva: el ultimo post sale antes de las 6 p. m.
const BOGOTA_UTC = 5; // Colombia no tiene horario de verano

const APERTURAS = {
  amoblados: [
    "🏡 Amoblado en arriendo",
    "✨ Disponible para arriendo amoblado",
    "🔑 Amoblado listo para entrar",
    "📍 Arriendo amoblado disponible",
  ],
  fincas: ["🌳 Finca en renta"],
};

function textoDe(p) {
  return [p.titulo, p.descripcion, p.caracteristicas].filter(Boolean).join(" ").toLowerCase();
}

function esArriendo(p) {
  return /arriend|alquil|renta/i.test(String(p.operacion || ""));
}

function esFinca(p) {
  return /finca/i.test(String(p.tipo || "")) || /finca/i.test(String(p.titulo || ""));
}

// Un amoblado cuyo texto habla de noches o dias puede tener el precio por
// noche: publicarlo como mensual seria mentirle al colega.
function periodoDudoso(p) {
  return /noche|por\s+d[ií]a|diari[oa]/.test(textoDe(p));
}

// La finca se publica solo si el texto dice UN periodo: "mes" o "noche".
function periodoFinca(p) {
  const t = textoDe(p);
  const mes = /mensual|al mes|por mes|\/mes/.test(t);
  const noche = /noche/.test(t);
  if (mes === noche) return null;
  return mes ? "mes" : "noche";
}

function aptaPara(p, categoria) {
  if (!aptaParaKit(p) || !esArriendo(p)) return false;
  if (categoria === "amoblados") {
    if (esFinca(p) || esAmoblada(p) !== true) return false;
    if (!String(p.zona || "").trim()) return false;
    return !periodoDudoso(p);
  }
  if (categoria === "fincas") return esFinca(p) && periodoFinca(p) !== null;
  return false;
}

function partesBogota(ahora) {
  const b = new Date(ahora.getTime() - BOGOTA_UTC * 3600e3);
  return { hora: b.getUTCHours(), diaSemana: b.getUTCDay(), dia: b.toISOString().slice(0, 10) };
}

function enHorario(ahora = new Date()) {
  const { hora, diaSemana } = partesBogota(ahora);
  return diaSemana !== 0 && hora >= HORA_INICIO && hora < HORA_FIN;
}

function diaBogota(fecha) {
  return partesBogota(new Date(fecha)).dia;
}

// historial: [{ group_id, property_ref, estado, created_at }] de los ultimos
// DIAS_SIN_REPETIR dias como minimo. Devuelve { grupo, propiedad } o
// { motivo } si no toca nada.
function elegir({ grupos, propiedades, historial, ahora = new Date(), maxDia, noAntesDe = null, excluirRefs = new Set() }) {
  if (!enHorario(ahora)) return { motivo: "fuera_de_horario" };
  const hoy = diaBogota(ahora);
  const deHoy = historial.filter((h) => diaBogota(h.created_at) === hoy);
  if (deHoy.length >= maxDia) return { motivo: "tope_diario" };
  if (noAntesDe && ahora < noAntesDe) return { motivo: "espaciado" };

  const corte = ahora.getTime() - DIAS_SIN_REPETIR * DIA_MS;
  const ultimoDeGrupo = (id) => Math.max(0, ...historial.filter((h) => h.group_id === id).map((h) => new Date(h.created_at).getTime()));
  const ultimoDeRef = (ref) =>
    Math.max(0, ...historial.filter((h) => h.estado === "enviado" && String(h.property_ref) === String(ref)).map((h) => new Date(h.created_at).getTime()));

  const candidatos = grupos
    .filter((g) => g.publica && !deHoy.some((h) => h.group_id === g.id))
    .sort((a, b) => ultimoDeGrupo(a.id) - ultimoDeGrupo(b.id) || String(a.nombre).localeCompare(String(b.nombre)));

  for (const grupo of candidatos) {
    const recientes = new Set(
      historial
        .filter((h) => h.group_id === grupo.id && h.estado === "enviado" && new Date(h.created_at).getTime() >= corte)
        .map((h) => String(h.property_ref))
    );
    const opciones = propiedades
      .filter((p) => !excluirRefs.has(String(p.ref)) && !recientes.has(String(p.ref)) && aptaPara(p, grupo.publica))
      .sort((a, b) => ultimoDeRef(a.ref) - ultimoDeRef(b.ref) || String(a.ref).localeCompare(String(b.ref)));
    if (opciones.length) return { grupo, propiedad: opciones[0] };
  }
  return { motivo: "nada_que_publicar" };
}

function apertura(grupo, propiedad, ahora = new Date()) {
  const lista = APERTURAS[grupo.publica] || APERTURAS.amoblados;
  const dia = Math.floor(ahora.getTime() / DIA_MS);
  const semilla = [...String(grupo.id)].reduce((s, c) => s + c.charCodeAt(0), dia);
  let linea = lista[semilla % lista.length];
  if (grupo.publica === "fincas") linea += periodoFinca(propiedad) === "noche" ? " (precio por noche)" : " (precio mensual)";
  return linea;
}

function textoPost(grupo, propiedad, cuerpo, ahora = new Date()) {
  return `${apertura(grupo, propiedad, ahora)}\n\n${cuerpo}`;
}

module.exports = {
  aptaPara, periodoDudoso, periodoFinca, enHorario, elegir, textoPost, diaBogota,
  APERTURAS, DIAS_SIN_REPETIR,
};

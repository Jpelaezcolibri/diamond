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
const { parsearArea } = require("../lib/formato");

const ESPERA_ASESOR_MS = 15 * 60000;
const PRIORIDAD_ASESOR_DIAS = 7;

function esDeAsesor(p) {
  return Boolean(p) && p.origen === "asesor";
}

// Lo que un asesor pidio publicar (venta o arriendo) con los datos minimos.
function aptaDeAsesor(p) {
  if (!esDeAsesor(p) || !aptaParaKit(p) || !String(p.zona || "").trim() || parsearArea(p.area) === null) return false;
  // Un arriendo sin periodo claro (mensual o por noche) se publicaria con el precio ambiguo.
  if (esArriendo(p) && !["mensual", "diario"].includes(periodoWasi(p))) return false;
  return true;
}

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

// El periodo que marca Wasi (properties.periodo_precio, sync de DMAP desde
// 2026-10-19) manda sobre el texto. Sin el dato se adivina por el texto.
function periodoWasi(p) {
  const v = String(p.periodo_precio || "").toLowerCase();
  return ["mensual", "diario", "semanal"].includes(v) ? v : null;
}

// Un amoblado cuyo texto habla de noches o dias puede tener el precio por
// noche: publicarlo como mensual seria mentirle al colega.
function periodoDudoso(p) {
  const wasi = periodoWasi(p);
  if (wasi) return wasi !== "mensual";
  return /noche|por\s+d[ií]a|diari[oa]/.test(textoDe(p));
}

// La finca se publica solo si el periodo es UNO: "mes" o "noche".
function periodoFinca(p) {
  const wasi = periodoWasi(p);
  if (wasi === "mensual") return "mes";
  if (wasi === "diario") return "noche";
  if (wasi) return null;
  const t = textoDe(p);
  const mes = /mensual|al mes|por mes|\/mes/.test(t);
  const noche = /noche/.test(t);
  if (mes === noche) return null;
  return mes ? "mes" : "noche";
}

function esVenta(p) {
  return /venta/i.test(String(p.operacion || ""));
}

// Precio en pesos desde el texto de la ficha ("$450.000.000" -> 450000000).
function precioNumerico(p) {
  const n = Number(String(p.precio || "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const VENTA_MINIMA = 20000000; // por debajo es un precio mal cargado (o $0)

// La venta de Wasi en los grupos OFERTAS (Juan, 2026-10-20: "que el
// publicador saque tambien la venta de Wasi en los grupos de OFERTAS,
// priorizando las zonas mas pedidas"). Con zona, area y precio reales: una
// ficha sin zona no se puede ofrecer con honestidad en un grupo de colegas.
function aptaVentaWasi(p) {
  if (esDeAsesor(p) || !esVenta(p) || !aptaParaKit(p)) return false;
  if (!String(p.zona || "").trim() || parsearArea(p.area) === null) return false;
  return precioNumerico(p) >= VENTA_MINIMA;
}

function aptaPara(p, categoria) {
  // La venta (de un asesor o de Wasi) no es arriendo: se decide antes de la compuerta de arriendo.
  if (categoria === "ofertas") return aptaDeAsesor(p) || aptaVentaWasi(p) || aptaPara(p, "amoblados");
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
const normZona = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

// Cuantos pedidos de colegas nombran la zona de la propiedad. `demanda` es un
// Map zona normalizada -> pedidos (ultimos 30 dias, ver el scheduler). Cuenta
// tambien "poblado" para "el poblado" y viceversa.
function demandaDe(p, demanda) {
  const z = normZona(p.zona);
  if (!z || !demanda || demanda.size === 0) return 0;
  let total = 0;
  for (const [clave, n] of demanda) if (clave === z || clave.includes(z) || z.includes(clave)) total += n;
  return total;
}

function elegir({ grupos, propiedades, historial, ahora = new Date(), maxDia, noAntesDe = null, excluirRefs = new Set(), demanda = new Map() }) {
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
    const prioridad = (p) =>
      esDeAsesor(p) && ahora.getTime() - new Date(p.created_at).getTime() < PRIORIDAD_ASESOR_DIAS * DIA_MS ? 0 : 1;
    // Una ref que ya salio hoy en otro grupo va al final: asi rotan mas fichas.
    const salioHoy = (p) => (deHoy.some((h) => h.estado === "enviado" && String(h.property_ref) === String(p.ref)) ? 1 : 0);
    // En OFERTAS la venta va antes que los amoblados (87 % de los pedidos de
    // colegas son de venta; los amoblados tienen sus grupos propios) y, entre
    // ventas, primero las zonas mas pedidas.
    const enOfertas = grupo.publica === "ofertas";
    const clase = (p) => (enOfertas && esVenta(p) ? 0 : 1);
    const pedidos = (p) => (enOfertas && esVenta(p) ? demandaDe(p, demanda) : 0);
    const opciones = propiedades
      .filter((p) => !excluirRefs.has(String(p.ref)) && !recientes.has(String(p.ref)) && aptaPara(p, grupo.publica))
      .filter((p) => !esDeAsesor(p) || ahora.getTime() - new Date(p.created_at).getTime() >= ESPERA_ASESOR_MS)
      .sort(
        (a, b) =>
          prioridad(a) - prioridad(b) ||
          salioHoy(a) - salioHoy(b) ||
          clase(a) - clase(b) ||
          pedidos(b) - pedidos(a) ||
          ultimoDeRef(a.ref) - ultimoDeRef(b.ref) ||
          String(a.ref).localeCompare(String(b.ref))
      );
    if (opciones.length) return { grupo, propiedad: opciones[0] };
  }
  return { motivo: "nada_que_publicar" };
}

function rotacion(lista, grupo, ahora) {
  const dia = Math.floor(ahora.getTime() / DIA_MS);
  const semilla = [...String(grupo.id)].reduce((s, c) => s + c.charCodeAt(0), dia);
  return lista[semilla % lista.length];
}

// Encabezado del post. En un grupo "ofertas" entran ventas, arriendos y
// fincas: el encabezado lo decide la PROPIEDAD, no el grupo.
function encabezado(grupo, propiedad, ahora = new Date()) {
  let categoria = grupo.publica;
  let linea;
  if (categoria === "ofertas") {
    const tipo = String(propiedad.tipo || "").trim() || "Inmueble";
    if (!esArriendo(propiedad)) linea = `🏠 ${tipo} en venta`;
    else if (esFinca(propiedad)) categoria = "fincas";
    else if (esAmoblada(propiedad) === true) categoria = "amoblados";
    else linea = `🔑 ${tipo} en arriendo`;
  }
  if (!linea) linea = rotacion(APERTURAS[categoria] || APERTURAS.amoblados, grupo, ahora);
  if (categoria === "fincas") return linea + (periodoFinca(propiedad) === "noche" ? " (precio por noche)" : " (precio mensual)");
  const porNoche = String(propiedad.periodo_precio || "").toLowerCase() === "diario" || (esFinca(propiedad) && periodoFinca(propiedad) === "noche");
  if (esArriendo(propiedad) && porNoche && !/por noche/.test(linea)) linea += " (precio por noche)";
  return linea;
}

const apertura = encabezado;

function textoPost(grupo, propiedad, cuerpo, ahora = new Date()) {
  return `${apertura(grupo, propiedad, ahora)}\n\n${cuerpo}`;
}

module.exports = {
  aptaPara, aptaVentaWasi, demandaDe, esDeAsesor, encabezado, periodoDudoso, periodoFinca, enHorario, elegir, textoPost, diaBogota,
  APERTURAS, DIAS_SIN_REPETIR,
};

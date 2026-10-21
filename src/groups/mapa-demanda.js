// Mapa de demanda para captar (CRM /demanda, mockup aprobado por Juan el
// 2026-10-21: docs/superpowers/mockups/2026-10-21-mapa-demanda.html; reglas en
// .superpowers/sdd/demanda-brief.md).
//
// Puro: recibe los pedidos (group_signals clase 'demanda') y las propiedades
// y devuelve el mapa. Nada de Supabase ni process.env: la carga y la cache
// viven en src/data/demanda.js.
//
// Una celda es macrozona x tipo x banda de precio. La asesora capta donde hay
// muchos pedidos por cada propiedad que tenemos.
const { zonaTokens, madresDe, sinAcentos } = require("../lib/zonas");
const formato = require("../lib/formato");

// ── Macrozonas ──────────────────────────────────────────────────────────
//
// Un barrio cuenta en su municipio o comuna. Se reutiliza SUBZONA_DE
// (src/lib/zonas.js, barrio -> zona madre) para los barrios ya conocidos, y
// se suman aca solo los tokens de los municipios y de los barrios que esa
// tabla no tiene porque no hacen falta para el match.
const MACROZONAS = ["El Poblado", "Laureles", "Envigado", "Belén", "Sabaneta", "Itagüí", "La Estrella", "Oriente", "Otras"];

const MACRO_DE_TOKEN = new Map([
  ["poblado", "El Poblado"],
  ["palmas", "El Poblado"],
  ["laureles", "Laureles"],
  ["estadio", "Laureles"],
  ["colores", "Laureles"],
  ["envigado", "Envigado"],
  ["belen", "Belén"],
  ["rodeo", "Belén"],
  ["rosales", "Belén"],
  ["mota", "Belén"],
  ["bernal", "Belén"],
  ["fatima", "Belén"],
  ["sabaneta", "Sabaneta"],
  ["itagui", "Itagüí"],
  ["estrella", "La Estrella"],
  ["oriente", "Oriente"],
  ["rionegro", "Oriente"],
  ["llanogrande", "Oriente"],
  ["ceja", "Oriente"],
  ["retiro", "Oriente"],
  ["guarne", "Oriente"],
  ["marinilla", "Oriente"],
  ["viboral", "Oriente"],
  ["guatape", "Oriente"],
  ["penol", "Oriente"],
  ["santuario", "Oriente"],
  ["union", "Oriente"],
]);

const MADRE_A_MACRO = { poblado: "El Poblado", laureles: "Laureles", envigado: "Envigado", belen: "Belén" };

// La macrozona de UN texto de zona: la del primer token que se reconozca.
// "El Poblado (desde la 10 hasta Benedictinos)" es El Poblado, no Envigado:
// por eso se quita lo que va entre parentesis y gana el primero.
function macroDeTexto(texto) {
  const limpio = String(texto || "").replace(/\([^)]*\)/g, " ");
  for (const t of zonaTokens(limpio)) {
    if (MACRO_DE_TOKEN.has(t)) return MACRO_DE_TOKEN.get(t);
    const madre = madresDe([t])[0];
    if (madre && MADRE_A_MACRO[madre]) return MADRE_A_MACRO[madre];
  }
  return null;
}

// Los textos de zona de un pedido: `zonas` (lista) o `zona` partida por comas.
function textosDeZona(s) {
  const lista = Array.isArray(s.zonas) && s.zonas.length ? s.zonas : String(s.zona || "").split(/[,;/]| y | o /i);
  return lista.map((z) => String(z || "").trim()).filter(Boolean);
}

// Las macrozonas distintas que nombra un pedido. Sin ninguna reconocida (o sin
// zona): "Otras".
function macrozonasDePedido(s) {
  const out = new Set();
  for (const z of textosDeZona(s)) {
    const m = macroDeTexto(z);
    if (m) out.add(m);
  }
  if (!out.size && s.ciudad) {
    const m = macroDeTexto(s.ciudad);
    if (m) out.add(m);
  }
  return out.size ? [...out] : ["Otras"];
}

// Una propiedad esta en UNA macrozona: la de su zona, si no la de su ciudad.
function macrozonaDePropiedad(p) {
  return macroDeTexto(p.zona) || macroDeTexto(p.ciudad) || "Otras";
}

// ── Tipos ───────────────────────────────────────────────────────────────
const TIPOS = ["apartamento", "casa", "lote", "apartaestudio", "local-oficina", "finca", "otro"];

// Dúplex, penthouse y loft cuentan como apartamento (mismo criterio que
// src/lib/tipos-filtro.js). "Casa campestre" es finca.
function tipoUnico(t) {
  const x = sinAcentos(String(t || "")).trim();
  if (!x) return null;
  if (/aparta\s*estudio|\bestudio\b/.test(x)) return "apartaestudio";
  if (/apartamento|\bapto|duplex|penthouse|pent\s*house|\bph\b|loft/.test(x)) return "apartamento";
  if (/finca|campestre|chalet|cabana/.test(x)) return "finca";
  if (/\bcasa/.test(x)) return "casa";
  if (/lote|terreno|parcela/.test(x)) return "lote";
  if (/local|oficina|consultorio/.test(x)) return "local-oficina";
  return "otro";
}

// Los tipos distintos de un pedido ("apartamento, casa" suma en los dos,
// igual que un pedido con varias zonas suma en cada una).
function tiposDePedido(t) {
  const partes = String(t || "")
    .split(/[,;/]| y | o /i)
    .map(tipoUnico)
    .filter(Boolean);
  return partes.length ? [...new Set(partes)] : ["otro"];
}

function tipoDePropiedad(p) {
  return tipoUnico(p.tipo) || "otro";
}

// ── Bandas de precio ────────────────────────────────────────────────────
const M = 1_000_000;
const BANDAS = {
  venta: [
    { id: "<300", label: "< 300M", palabras: "de menos de 300 millones", max: 300 * M },
    { id: "300-500", label: "300–500M", palabras: "de 300 a 500 millones", max: 500 * M },
    { id: "500-800", label: "500–800M", palabras: "de 500 a 800 millones", max: 800 * M },
    { id: "800-1200", label: "800M–1.200M", palabras: "de 800 a 1.200 millones", max: 1200 * M },
    { id: "1200-2000", label: "1.200–2.000M", palabras: "de 1.200 a 2.000 millones", max: 2000 * M },
    { id: ">2000", label: "> 2.000M", palabras: "de más de 2.000 millones", max: Infinity },
  ],
  arriendo: [
    { id: "<3", label: "< 3M", palabras: "de menos de 3 millones al mes", max: 3 * M },
    { id: "3-6", label: "3–6M", palabras: "de 3 a 6 millones al mes", max: 6 * M },
    { id: "6-10", label: "6–10M", palabras: "de 6 a 10 millones al mes", max: 10 * M },
    { id: ">10", label: "> 10M", palabras: "de más de 10 millones al mes", max: Infinity },
  ],
};
const SIN_PRECIO = { id: "sin", label: "Sin precio", palabras: "sin precio definido", max: null };

// Por debajo de esto un "presupuesto de venta" es un dato mal leido, no un
// precio: va a "sin precio" en vez de inflar la banda mas barata.
const PISO_VENTA = 20 * M;
const PISO_ARRIENDO = 300_000;

function bandaDe(valor, operacion) {
  const n = formato.parsearPrecio(valor);
  if (!n) return SIN_PRECIO;
  if (n < (operacion === "arriendo" ? PISO_ARRIENDO : PISO_VENTA)) return SIN_PRECIO;
  return (BANDAS[operacion] || BANDAS.venta).find((b) => n < b.max);
}

// ── Operacion ───────────────────────────────────────────────────────────
// Un pedido de compra mal clasificado como arriendo (presupuesto >= 60 M)
// cuenta como venta. Sin operacion, el presupuesto decide; sin los dos, no
// entra.
const UMBRAL_COMPRA = 60 * M;

function presupuesto(s) {
  return formato.parsearPrecio(s.precio_max) || formato.parsearPrecio(s.precio_min) || null;
}

function operacionDePedido(s) {
  const op = String(s.operacion || "").toLowerCase().trim();
  const p = presupuesto(s);
  if (op === "venta") return "venta";
  if (op === "arriendo") return p && p >= UMBRAL_COMPRA ? "venta" : "arriendo";
  if (p) return p >= UMBRAL_COMPRA ? "venta" : "arriendo";
  return null;
}

function operacionDePropiedad(p) {
  const op = sinAcentos(String(p.operacion || ""));
  return { venta: op.includes("venta"), arriendo: op.includes("arriendo") || op.includes("alquiler") };
}

// ── Dedup ───────────────────────────────────────────────────────────────
const normTexto = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();

function deduplicar(pedidos) {
  const vistos = new Set();
  const out = [];
  for (const s of pedidos || []) {
    const clave = normTexto(s.texto_original) || `id:${s.id}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(s);
  }
  return out;
}

// ── Matches ─────────────────────────────────────────────────────────────
const PUNTAJE_PROPIO = 85;

// Las refs propias del match con puntaje >= 85. Si el match no trae puntaje,
// cuenta cualquier ref propia.
function refsPropias(s) {
  const out = [];
  for (const m of Array.isArray(s.matches) ? s.matches : []) {
    if (!m || !m.ref || m.fuente === "aliado") continue;
    const puntaje = typeof m.puntaje === "number" ? m.puntaje : typeof m.score === "number" ? m.score : null;
    if (puntaje === null || puntaje >= PUNTAJE_PROPIO) out.push(String(m.ref));
  }
  return out;
}

// ── Que piden ───────────────────────────────────────────────────────────
const RE_ALCOBAS = /(\d)\s*(?:alcobas?|habitaci[oó]n(?:es)?|habs?\b|cuartos?|dormitorios?)/i;
const RE_PARQ_N = /(\d)\s*(?:parqueaderos?|garajes?|parqueos?|celdas?)/i;
const RE_PARQ = /parqueadero|garaje|parqueo/i;
const RE_UNIDAD = /unidad\s+cerrada|conjunto\s+cerrado|porter[ií]a|vigilancia\s+24/i;
const RE_PISO = /ascensor|piso\s+(?:bajo|m[aá]ximo)|hasta\s+(?:el\s+)?piso|primer\s+piso|sin\s+escaleras/i;

function alcobasDe(s) {
  if (Number(s.habitaciones) > 0) return Number(s.habitaciones);
  const m = String(s.texto_original || "").match(RE_ALCOBAS);
  return m ? Number(m[1]) : null;
}

function parqueaderosDe(s) {
  if (Number(s.garajes) > 0) return Number(s.garajes);
  if (Number(s.parqueaderos) > 0) return Number(s.parqueaderos);
  const t = String(s.texto_original || "");
  const m = t.match(RE_PARQ_N);
  if (m) return Number(m[1]);
  return RE_PARQ.test(t) ? 1 : 0;
}

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

function quePiden(pedidos, macro) {
  const total = pedidos.length;
  const alcobas = new Map();
  let parq1 = 0;
  let parq2 = 0;
  let unidad = 0;
  let piso = 0;
  const barrios = new Map();
  for (const s of pedidos) {
    const a = alcobasDe(s);
    if (a) alcobas.set(a, (alcobas.get(a) || 0) + 1);
    const p = parqueaderosDe(s);
    if (p >= 1) parq1++;
    if (p >= 2) parq2++;
    if (RE_UNIDAD.test(String(s.texto_original || ""))) unidad++;
    if (Number(s.piso_max) > 0 || RE_PISO.test(String(s.texto_original || ""))) piso++;
    for (const z of textosDeZona(s)) {
      if (macroDeTexto(z) !== macro && macro !== "Otras") continue;
      if (macro === "Otras" && macroDeTexto(z)) continue;
      const nombre = z.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
      // El nombre de la macrozona no es un barrio.
      if (!nombre || sinAcentos(nombre).replace(/^(el|la)\s+/, "") === sinAcentos(macro).replace(/^(el|la)\s+/, "")) continue;
      // "La Castellana" y "Castellana" son el mismo barrio.
      const clave = sinAcentos(nombre).replace(/^(el|la|los|las)\s+/, "");
      const b = barrios.get(clave) || { nombre, n: 0 };
      b.n++;
      barrios.set(clave, b);
    }
  }
  const barras = [...alcobas.entries()]
    .sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .slice(0, 2)
    .map(([n, c]) => ({ texto: `${n} ${n === 1 ? "alcoba" : "alcobas"}`, pct: pct(c, total) }));
  barras.push({ texto: "1 parqueadero o más", pct: pct(parq1, total) });
  barras.push({ texto: "2 parqueaderos", pct: pct(parq2, total) });
  barras.push({ texto: "Unidad con portería", pct: pct(unidad, total) });
  barras.push({ texto: "Piso máximo / ascensor", pct: pct(piso, total) });
  return {
    barras,
    barrios: [...barrios.values()]
      .sort((x, y) => y.n - x.n || x.nombre.localeCompare(y.nombre))
      .slice(0, 5)
      .map((b) => b.nombre),
  };
}

// ── Argumento para el propietario ───────────────────────────────────────
const TIPO_SINGULAR = {
  apartamento: { texto: "un apartamento", fem: false },
  casa: { texto: "una casa", fem: true },
  lote: { texto: "un lote", fem: false },
  apartaestudio: { texto: "un apartaestudio", fem: false },
  "local-oficina": { texto: "un local u oficina", fem: false },
  finca: { texto: "una finca", fem: true },
  oficina: { texto: "una oficina", fem: true },
  bodega: { texto: "una bodega", fem: true },
  local: { texto: "un local", fem: false },
  otro: { texto: "un inmueble", fem: false },
};

function tenemosTexto(n, fem) {
  if (!n) return `no tenemos ${fem ? "ninguna" : "ninguno"}`;
  if (n === 1) return `solo tenemos ${fem ? "una" : "uno"}`;
  return `solo tenemos ${n}`;
}

function comisionTexto(comisionEnv) {
  return String(comisionEnv || "").includes("50/50")
    ? "con comisión compartida 50/50 con la red"
    : "compartiendo comisión con la red";
}

// Texto del mockup aprobado, con la concordancia corregida. Va al propietario:
// "usted". La cifra es honesta: "Este mes" solo con los pedidos de los ultimos
// 30 dias; si son pocos, "En los ultimos tres meses" con los de 90 dias.
function argumento({ orgName, colegas, ventana = "mes", tipo, macrozona, banda, tenemos, comision }) {
  const t = TIPO_SINGULAR[tipo] || TIPO_SINGULAR.otro;
  const cuantos = colegas === 1 ? "1 colega de la red buscó" : `${colegas} colegas de la red buscaron`;
  const cuando = ventana === "trimestre" ? "En los últimos tres meses" : "Este mes";
  return (
    `Hola, soy de ${orgName}. ${cuando} ${cuantos} ${t.texto} como ${t.fem ? "la suya" : "el suyo"} en ${macrozona} (${banda.palabras}), ` +
    `y hoy ${tenemosTexto(tenemos, t.fem)} para ofrecerles. Si nos da la exclusiva, su inmueble les llega a todos ` +
    `ellos el mismo día, ${comisionTexto(comision)}. ¿Le parece si lo visitamos esta semana?`
  );
}

const MIN_PARA_ARGUMENTO = 3;

// Elige la ventana honesta: 30 dias si hay >= 3 pedidos, si no 90 dias, si no nada.
function argumentoDeCelda({ orgName, n30, n90, tipo, macrozona, banda, tenemos, comision }) {
  const base = { orgName, tipo, macrozona, banda, tenemos, comision };
  if (n30 >= MIN_PARA_ARGUMENTO) return { texto: argumento({ ...base, colegas: n30, ventana: "mes" }), motivo: null };
  if (n90 >= MIN_PARA_ARGUMENTO) return { texto: argumento({ ...base, colegas: n90, ventana: "trimestre" }), motivo: null };
  return { texto: null, motivo: "Muy pocos pedidos para usar como argumento" };
}

// ── Inventario que no calza ─────────────────────────────────────────────
const RE_RURAL = /vereda|rural|parcelaci[oó]n|campestre|finca|\bkm\b|kil[oó]metro/i;

function motivoNoCalza(p) {
  if (!String(p.zona || "").trim()) return "sin zona en Wasi";
  if (["finca", "lote"].includes(tipoDePropiedad(p)) || RE_RURAL.test(`${p.tipo || ""} ${p.titulo || ""} ${p.zona || ""}`)) return "rural";
  return "sin pedidos";
}

// ── Calculo ─────────────────────────────────────────────────────────────
const UMBRAL_CALIENTE_90 = 30;

function umbralCaliente(dias) {
  return (UMBRAL_CALIENTE_90 * dias) / 90;
}

function claveCelda(macro, tipo, banda) {
  return `${macro}|${tipo}|${banda}`;
}

// El inicio del mes actual en Medellin (UTC-5, sin horario de verano).
function inicioDeMes(ahora) {
  const bogota = new Date(ahora - 5 * 3600e3);
  return Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), 1) + 5 * 3600e3;
}

/**
 * @param {object} p
 * @param {object[]} p.pedidos     group_signals clase 'demanda' del periodo
 * @param {object[]} p.propiedades properties de la org (se filtra disponible)
 * @param {number}   p.dias        7 | 30 | 90
 * @param {string}   p.operacion   'venta' | 'arriendo'
 * @param {string}   p.orgName
 * @param {string}   [p.comision]  valor de RADAR_LINEA_COMISION
 * @param {number}   [p.ahora]
 */
function calcular({ pedidos = [], propiedades = [], dias = 30, operacion = "venta", orgName = "", comision = "", ahora = Date.now() }) {
  const op = operacion === "arriendo" ? "arriendo" : "venta";
  const todos = pedidos.filter((s) => !s.clase || s.clase === "demanda");

  // Pedidos de la operacion dentro de una ventana de N dias (sin created_at
  // cuenta como dentro). Los grupos se cuentan antes de deduplicar.
  const ventana = (n) => {
    const desde = ahora - n * 86400e3;
    const dentro = todos.filter((s) => {
      if (operacionDePedido(s) !== op) return false;
      const t = s.created_at ? new Date(s.created_at).getTime() : NaN;
      return Number.isNaN(t) || t >= desde;
    });
    return { gruposIds: new Set(dentro.map((s) => s.group_id).filter(Boolean)), unicos: deduplicar(dentro) };
  };
  const armar = (lista) => {
    const m = new Map();
    for (const s of lista) {
      const banda = bandaDe(presupuesto(s), op);
      for (const macro of macrozonasDePedido(s)) {
        for (const tipo of tiposDePedido(s.tipo)) {
          const k = claveCelda(macro, tipo, banda.id);
          if (!m.has(k)) m.set(k, { macrozona: macro, tipo, banda, pedidos: [], tenemos: [] });
          m.get(k).pedidos.push(s);
        }
      }
    }
    return m;
  };

  const vSel = ventana(dias);
  const delaOp = vSel.unicos;
  const celdas = armar(delaOp);
  const cuenta30 = dias === 30 ? null : armar(ventana(30).unicos);
  const cuenta90 = dias === 90 ? null : armar(ventana(90).unicos);
  const nEn = (mapa, selMapa, k) => (mapa || selMapa).get(k)?.pedidos.length || 0;

  const grupos = vSel.gruposIds;
  const refsConMatch = new Set();
  let sinInventario = 0;
  for (const s of delaOp) {
    const propias = refsPropias(s);
    for (const r of propias) refsConMatch.add(r);
    if (!propias.length) sinInventario++;
  }

  const disponibles = propiedades.filter((p) => p.disponible !== false && operacionDePropiedad(p)[op]);
  for (const p of disponibles) {
    const k = claveCelda(macrozonaDePropiedad(p), tipoDePropiedad(p), bandaDe(p.precio, op).id);
    if (celdas.has(k)) celdas.get(k).tenemos.push(p);
  }

  const umbral = umbralCaliente(dias);
  const filas = [...celdas.values()]
    .filter((c) => c.pedidos.length > 0)
    .map((c) => {
      const pedidosN = c.pedidos.length;
      const tenemos = c.tenemos.length;
      const porPropiedad = pedidosN / Math.max(tenemos, 1);
      const pedidosMes = Math.round((pedidosN * 30) / dias);
      const id = claveCelda(c.macrozona, c.tipo, c.banda.id);
      const n30 = nEn(cuenta30, celdas, id);
      const n90 = nEn(cuenta90, celdas, id);
      const arg = argumentoDeCelda({ orgName, n30, n90, tipo: c.tipo, macrozona: c.macrozona, banda: c.banda, tenemos, comision });
      return {
        id,
        macrozona: c.macrozona,
        tipo: c.tipo,
        banda: c.banda.id,
        bandaLabel: c.banda.label,
        pedidos: pedidosN,
        pedidosMes,
        tenemos,
        refs: c.tenemos.map((p) => String(p.ref)),
        porPropiedad: Math.round(porPropiedad * 10) / 10,
        caliente: porPropiedad >= umbral,
        quePiden: quePiden(c.pedidos, c.macrozona),
        pedidos30: n30,
        pedidos90: n90,
        argumento: arg.texto,
        argumentoMotivo: arg.motivo,
      };
    })
    .sort((a, b) => b.porPropiedad - a.porPropiedad || b.pedidos - a.pedidos);

  const calientes = new Set(filas.filter((f) => f.caliente).map((f) => f.id));

  // Captaciones del mes en celdas calientes (la meta del mes la pone el CRM).
  const desdeMes = inicioDeMes(ahora);
  const captaciones = disponibles
    .filter((p) => p.created_at && new Date(p.created_at).getTime() >= desdeMes)
    .filter((p) => calientes.has(claveCelda(macrozonaDePropiedad(p), tipoDePropiedad(p), bandaDe(p.precio, op).id)))
    .map((p) => String(p.ref));

  const noCalza = disponibles
    .filter((p) => !refsConMatch.has(String(p.ref)))
    .map((p) => ({ ref: String(p.ref), titulo: p.titulo || null, zona: p.zona || p.ciudad || null, motivo: motivoNoCalza(p) }));

  return {
    dias,
    operacion: op,
    umbralCaliente: Math.round(umbral * 10) / 10,
    kpis: {
      pedidos: delaOp.length,
      grupos: grupos.size,
      sinInventario,
      pctSinInventario: pct(sinInventario, delaOp.length),
      celdasCalientes: calientes.size,
      captacionesCalientes: captaciones.length,
    },
    celdas: filas,
    captaciones,
    noCalza: { total: disponibles.length, n: noCalza.length, lista: noCalza },
  };
}

module.exports = {
  MACROZONAS,
  TIPOS,
  BANDAS,
  PUNTAJE_PROPIO,
  macroDeTexto,
  macrozonasDePedido,
  macrozonaDePropiedad,
  tiposDePedido,
  tipoDePropiedad,
  bandaDe,
  operacionDePedido,
  deduplicar,
  refsPropias,
  quePiden,
  argumento,
  argumentoDeCelda,
  tenemosTexto,
  comisionTexto,
  umbralCaliente,
  calcular,
};

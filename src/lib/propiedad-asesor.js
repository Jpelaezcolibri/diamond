// Propiedad que un asesor le pide a Sofi publicar (spec docs/superpowers/
// specs/2026-10-19-sofi-publica-propiedad-asesor-design.md §2). Logica pura:
// convierte lo que dijo el asesor en una fila de `properties` y dice que
// falta. Nada se inventa: un dato que no se entiende cuenta como faltante.
const crypto = require("crypto");

const TIPOS = {
  apartamento: "Apartamento", apto: "Apartamento", apartaestudio: "Apartaestudio",
  casa: "Casa", finca: "Finca", local: "Local", oficina: "Oficina", lote: "Lote",
};
const SIN_ALCOBAS = new Set(["Local", "Oficina", "Lote"]);
const FEMENINO = new Set(["Casa", "Finca", "Oficina"]);

function texto(v) {
  return String(v ?? "").trim();
}

function pesos(n) {
  return `$${Math.round(n).toLocaleString("es-CO")}`;
}

// Estricto: o se entiende todo el texto o es faltante.
// "4.500.000", "$4500000", "4,5 millones", "450 millones", "850 mil".
function parsePrecio(v, minimo = 100000) {
  const s = texto(v).toLowerCase().replace(/[\s$]/g, "").replace(/(cop|pesos)$/, "");
  if (!s) return null;
  let n = null;
  let m;
  if (/^\d+$/.test(s) || /^\d{1,3}([.,]\d{3})+$/.test(s)) {
    n = Number(s.replace(/[.,]/g, ""));
  } else if ((m = /^(\d{1,3}\.\d{3}|\d{1,4}(?:[.,]\d{1,2})?)(millones|millon|millón|mill|m)$/.exec(s))) {
    // "1.200 millones": el punto con 3 digitos es de miles; si no, es decimal.
    const mant = /^\d{1,3}\.\d{3}$/.test(m[1]) ? Number(m[1].replace(".", "")) : parseFloat(m[1].replace(",", "."));
    n = Math.round(mant * 1e6);
  } else if ((m = /^(\d{1,3})mil$/.exec(s))) {
    n = Number(m[1]) * 1000;
  }
  return n !== null && Number.isFinite(n) && n >= minimo ? n : null;
}

function parseArea(v) {
  const s = texto(v).toLowerCase().replace(/\s+/g, "").replace(/(m2|m²|mts2|mt2|mts|mt|metros|m)$/, "");
  let n = null;
  if (/^\d{1,3}\.\d{3}$/.test(s)) n = Number(s.replace(".", ""));
  else if (/^\d+([.,]\d{1,2})?$/.test(s)) n = parseFloat(s.replace(",", "."));
  return n !== null && Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}

function parseEntero(v) {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function operacionDe(v) {
  const t = texto(v);
  const arr = /arriend|renta|alquil/i.test(t);
  const ven = /vent|vend/i.test(t);
  if (arr && ven) return null;
  if (arr) return "Arriendo";
  if (ven) return "Venta";
  return null;
}

function periodoDe(v) {
  const t = texto(v);
  const mes = /mes|mensual/i.test(t);
  const dia = /d[ií]a|noche|diari/i.test(t);
  if (mes && dia) return null;
  if (mes) return "mensual";
  if (dia) return "diario";
  return null;
}

function tituloDe({ tipo, amoblado, operacion, zona }) {
  const mueble = amoblado ? (FEMENINO.has(tipo) ? " amoblada" : " amoblado") : "";
  return `${tipo}${mueble} en ${operacion === "Arriendo" ? "arriendo" : "venta"} en ${zona}`;
}

function normalizar(d = {}) {
  const faltantes = [];
  const operacion = operacionDe(d.operacion);
  if (!operacion) faltantes.push("operación (venta o arriendo)");
  const tipo = TIPOS[texto(d.tipo).toLowerCase()] || null;
  if (!tipo) faltantes.push("tipo de inmueble");
  const zona = texto(d.barrio);
  if (!zona) faltantes.push("barrio o sector");
  const ciudad = texto(d.municipio);
  if (!ciudad) faltantes.push("municipio");
  const precio = parsePrecio(d.precio);
  if (precio === null) faltantes.push("precio (en números)");

  let periodo = null;
  let amoblado = null;
  if (operacion === "Arriendo") {
    periodo = periodoDe(d.periodo);
    if (!periodo) faltantes.push("si el canon es mensual o por noche");
    amoblado = typeof d.amoblado === "boolean" ? d.amoblado : null;
    if (amoblado === null) faltantes.push("si está amoblado");
  }

  const area = parseArea(d.area);
  if (area === null) faltantes.push("área en m²");
  const habitaciones = parseEntero(d.alcobas);
  const banos = parseEntero(d.banos);
  if (tipo && !SIN_ALCOBAS.has(tipo)) {
    if (habitaciones === null) faltantes.push("alcobas");
    if (banos === null) faltantes.push("baños");
  }

  const administracion = parsePrecio(d.administracion, 1000);
  const fila = {
    titulo: tipo && operacion && zona ? tituloDe({ tipo, amoblado, operacion, zona }) : null,
    tipo,
    operacion,
    precio: precio === null ? null : pesos(precio),
    area: area === null ? null : `${area}m2`,
    habitaciones,
    banos,
    garaje: parseEntero(d.parqueaderos),
    estrato: parseEntero(d.estrato),
    administracion: administracion === null ? null : pesos(administracion),
    zona: zona || null,
    ciudad: ciudad || null,
    descripcion: texto(d.descripcion) || null,
    caracteristicas: amoblado ? "Amoblado" : null,
    periodo_precio: periodo,
  };
  return { fila, faltantes };
}

// Ata la confirmacion a la vista previa: si el modelo cambia un dato o llega
// otra foto entre preparar y confirmar, el token no coincide.
function tokenDe(fila, fotos) {
  return crypto.createHash("sha256").update(JSON.stringify({ fila, fotos })).digest("hex").slice(0, 12);
}

function siguienteRef(refs) {
  const numeros = (refs || []).map((r) => /^D(\d+)$/i.exec(String(r))).filter(Boolean).map((m) => Number(m[1]));
  return `D${Math.max(1000, ...numeros) + 1}`;
}

module.exports = { normalizar, tokenDe, siguienteRef };

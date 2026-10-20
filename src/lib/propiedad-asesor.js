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

// "4.500.000", "$4500000", "4,5 millones", "450 millones", "4.5M".
function parsePrecio(v, minimo = 100000) {
  const s = texto(v).toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const num = s.replace(/[^\d.,]/g, "");
  if (!num) return null;
  const n = /mill|m$/.test(s) ? parseFloat(num.replace(",", ".")) * 1e6 : Number(num.replace(/[.,]/g, ""));
  return Number.isFinite(n) && n >= minimo ? n : null;
}

function parseArea(v) {
  const n = parseFloat(texto(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}

function parseEntero(v) {
  if (v === null || v === undefined || texto(v) === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function operacionDe(v) {
  const t = texto(v);
  if (/arriend|renta|alquil/i.test(t)) return "Arriendo";
  if (/vent/i.test(t)) return "Venta";
  return null;
}

function periodoDe(v) {
  const t = texto(v);
  if (/mes|mensual/i.test(t)) return "mensual";
  if (/d[ií]a|noche|diari/i.test(t)) return "diario";
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

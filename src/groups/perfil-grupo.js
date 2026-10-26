// Perfil de un grupo para el publicador (Juan, 2026-10-26; spec
// docs/superpowers/specs/2026-10-26-publicador-mixto-design.md §3): que zonas,
// que operacion y que tipos acepta. Del nombre del grupo, con override manual
// en whatsapp_groups.perfil. Los pedidos del grupo no restringen: ordenan.
const ZONAS_POR_PALABRA = {
  sur: ["Envigado", "Sabaneta", "La Estrella", "Itagüí", "Caldas"],
  pob: ["El Poblado"], poblado: ["El Poblado"],
  env: ["Envigado"], envigado: ["Envigado"],
  sab: ["Sabaneta"], sabaneta: ["Sabaneta"],
  itagui: ["Itagüí"], estrella: ["La Estrella"],
  laureles: ["Laureles"], belen: ["Belén"],
  oriente: ["Rionegro", "El Retiro", "La Ceja", "Guarne", "Marinilla", "El Carmen de Viboral", "Llanogrande"],
  occidente: ["San Jerónimo", "Santa Fe de Antioquia", "Sopetrán"],
};
const NORTE_ANT = ["Bello", "Copacabana", "Girardota", "Barbosa", "San Pedro de los Milagros", "Santa Rosa de Osos"];

const palabras = (s) =>
  String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function zonasDelNombre(ps) {
  const out = [];
  for (const w of ps) for (const z of ZONAS_POR_PALABRA[w] || []) if (!out.includes(z)) out.push(z);
  if (ps.includes("norte") && ps.includes("ant")) for (const z of NORTE_ANT) if (!out.includes(z)) out.push(z);
  return out;
}

function operacionDelNombre(ps, publica) {
  const arriendo = ps.some((w) => /^(arriendos?|renta|rentas|amoblados?|airbnb)$/.test(w));
  const venta = ps.some((w) => /^ventas?$/.test(w));
  if (arriendo && venta) return publica === "amoblados" || publica === "arriendos" || publica === "fincas" ? "arriendo" : null;
  if (arriendo) return "arriendo";
  if (venta) return "venta";
  return publica === "amoblados" || publica === "arriendos" ? "arriendo" : null;
}

function perfilDe(grupo, pedidos = []) {
  const ps = palabras(grupo && grupo.nombre);
  const o = (grupo && grupo.perfil && typeof grupo.perfil === "object") ? grupo.perfil : {};
  return {
    zonas: Array.isArray(o.zonas) ? o.zonas : zonasDelNombre(ps),
    operacion: o.operacion === "venta" || o.operacion === "arriendo" ? o.operacion : operacionDelNombre(ps, grupo && grupo.publica),
    tipos: Array.isArray(o.tipos) ? o.tipos : [],
    pedidos: Array.isArray(pedidos) ? pedidos : [],
  };
}

module.exports = { perfilDe, ZONAS_POR_PALABRA };

// Filtro por tipo compartido por properties.search y ally-properties.search.
// filters.tipo puede ser un string (un solo tipo) o una lista de tipos
// aceptados; filters.tipoEnTitulo hace que tambien cuente el titulo
// (una ficha "Apartamento" cuyo titulo dice Penthouse).
const { sinAcentos } = require("./zonas");

const lista = (tipo) => (Array.isArray(tipo) ? tipo : [tipo]).filter(Boolean);

// Version en memoria (tests, sin Supabase): sin tildes ni mayusculas.
function tipoCalzaEnMemoria(p, f) {
  const tipos = lista(f.tipo).map((t) => sinAcentos(String(t)));
  if (!tipos.length) return true;
  const tipo = sinAcentos(String(p.tipo || ""));
  const titulo = f.tipoEnTitulo ? sinAcentos(String(p.titulo || "")) : "";
  return tipos.some((t) => tipo.includes(t) || (titulo && titulo.includes(t)));
}

// Cadena para PostgREST .or(). ilike no ignora tildes, por eso la lista que
// llega ya trae las dos grafias ("duplex" y "dúplex"). Los valores son una
// lista fija; igual se descarta todo lo que no sea letras y espacios para que
// una coma, parentesis o punto jamas rompa la cadena.
function tipoOr(f) {
  const columnas = f.tipoEnTitulo ? ["tipo", "titulo"] : ["tipo"];
  const terminos = lista(f.tipo)
    .map((t) => String(t).trim())
    .filter((t) => /^[\p{L} ]+$/u.test(t))
    .flatMap((t) => columnas.map((c) => `${c}.ilike.%${t}%`));
  return terminos.length ? terminos.join(",") : null;
}

module.exports = { tipoCalzaEnMemoria, tipoOr };

// Kit de publicacion en grupos (spec docs/superpowers/specs/2026-10-16-kit-
// publicacion-y-duenos-arriendo-design.md §3). La asesora comparte desde SU
// celular: aca no se envia nada a WhatsApp, solo se decide QUE propiedades se
// pueden publicar, se arma el texto y se registra quien compartio que.
const supabase = require("../data/supabase");
const { withLandingLink } = require("../data/properties");
const syncEstado = require("../data/sync-estado");
const { REFS_BLOQUEADAS } = require("./publicable");
const verificarLink = require("./verificar-link");
const { postGrupo } = require("./redactar");
const { aliasPublico } = require("../lib/identidad-publica");

const FOTOS_MAX = 4;
const DIAS_RECIENTE = 7;
const DIA_MS = 86400000;

// Sin pedido de por medio: solo la calidad del dato. Lo que no pasa no se
// muestra, para que nunca salga una vendida o una sin link.
function aptaParaKit(p, { refsBloqueadas = REFS_BLOQUEADAS } = {}) {
  if (!p || p.disponible !== true) return false;
  if (!String(p.link || "").trim()) return false;
  if (!Array.isArray(p.images) || p.images.filter(Boolean).length === 0) return false;
  if (refsBloqueadas.has(String(p.ref || "").toUpperCase())) return false;
  return true;
}

function etiquetaUltima(publicacion, aliasPorUsuario, ahora = new Date()) {
  if (!publicacion) return { texto: "Nunca compartida", reciente: false };
  const dias = Math.floor((ahora.getTime() - new Date(publicacion.created_at).getTime()) / DIA_MS);
  const cuando = dias <= 0 ? "hoy" : dias === 1 ? "hace 1 día" : `hace ${dias} días`;
  const alias = aliasPorUsuario[publicacion.user_id];
  return { texto: `Compartida ${cuando}${alias ? ` por ${alias}` : ""}`, reciente: dias < DIAS_RECIENTE };
}

// Ultima publicacion por ref. Best-effort: sin la tabla, todo "Nunca".
async function ultimasPublicaciones(orgId) {
  const { data, error } = await supabase
    .from("kit_publicaciones")
    .select("property_ref, user_id, created_at")
    .eq("org_id", orgId)
    .gte("created_at", new Date(Date.now() - 60 * DIA_MS).toISOString())
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[kit] No se pudo leer kit_publicaciones (revisar migracion 2026-10-16_kit_publicacion):", error.message);
    return [];
  }
  return data || [];
}

// Alias publico por auth user id: nunca el nombre.
async function aliasPorUsuario(orgId) {
  const { data, error } = await supabase.from("advisors").select("auth_user_id, alias_publico").eq("org_id", orgId);
  if (error) {
    console.warn("[kit] No se pudo leer advisors:", error.message);
    return {};
  }
  const mapa = {};
  // Sin alias_publico no se pone nada: la etiqueta queda sin "por ..." en vez
  // de mostrar el texto de reemplazo de aliasPublico.
  for (const a of data || []) if (a.auth_user_id && String(a.alias_publico || "").trim()) mapa[a.auth_user_id] = aliasPublico(a);
  return mapa;
}

async function contarDesde(tabla, orgId, columna, desdeIso) {
  const { count, error } = await supabase
    .from(tabla)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte(columna, desdeIso);
  return error ? null : count;
}

async function listar(org, { operacion = "Venta", zona = null } = {}) {
  const inventario = await syncEstado.estadoDelInventario(org.id);
  if (!inventario.fresco) return { fresco: false, horas: inventario.horas, items: [], kpis: null };

  let q = supabase.from("properties").select("*").eq("org_id", org.id).eq("disponible", true).eq("operacion", operacion);
  if (zona) q = q.ilike("zona", `%${zona}%`);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(300);
  if (error) throw error;

  const [publicaciones, alias] = await Promise.all([ultimasPublicaciones(org.id), aliasPorUsuario(org.id)]);
  const ultimaPorRef = {};
  for (const p of publicaciones) if (!ultimaPorRef[p.property_ref]) ultimaPorRef[p.property_ref] = p;

  const ahora = new Date();
  const items = (data || [])
    .filter((p) => aptaParaKit(p))
    .map((p) => ({
      ref: p.ref,
      titulo: p.titulo,
      zona: p.zona,
      operacion: p.operacion,
      area: p.area,
      habitaciones: p.habitaciones,
      precio: p.precio,
      foto: p.images.filter(Boolean)[0],
      etiqueta: etiquetaUltima(ultimaPorRef[p.ref], alias, ahora),
    }));

  const semana = new Date(ahora.getTime() - 7 * DIA_MS).toISOString();
  const [compartidasSemana, clientesSemana] = await Promise.all([
    contarDesde("kit_publicaciones", org.id, "created_at", semana),
    contarDesde("leads", org.id, "kit_at", semana),
  ]);
  // kpis: los conteos pueden ser null si la migracion no corrio (el CRM muestra "—").
  return { fresco: true, horas: inventario.horas, items, kpis: { compartidasSemana, clientesSemana, listas: items.length } };
}

// La ref llega del request y va a ilike: solo caracteres de una ref, sin
// comodines de LIKE (% _ \).
const REF_VALIDA = /^[A-Za-z0-9-]+$/;

async function post(org, ref, { comision = true } = {}) {
  if (!REF_VALIDA.test(String(ref || ""))) return null;
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("org_id", org.id)
    .eq("disponible", true)
    .ilike("ref", ref)
    .maybeSingle();
  if (error) throw error;
  if (!data || !aptaParaKit(data)) return null;
  const propiedad = withLandingLink(data, org.landing_base_url);
  // El link se verifica al abrir la ficha, no al listar (spec §3.2).
  const { verificadas } = await verificarLink.verificar([propiedad]);
  return {
    texto: postGrupo(propiedad, { org, comision }),
    fotos: propiedad.images.filter(Boolean).slice(0, FOTOS_MAX),
    linkOk: verificadas.length === 1,
  };
}

const ACCIONES = new Set(["compartir", "copiar", "descargar"]);

async function registrar(org, { ref, userId = null, accion }) {
  if (!ref || !ACCIONES.has(accion)) return { ok: false };
  const { error } = await supabase
    .from("kit_publicaciones")
    .insert({ org_id: org.id, property_ref: String(ref), user_id: userId, accion });
  if (error) {
    console.warn("[kit] No se pudo registrar la publicacion (revisar migracion 2026-10-16_kit_publicacion):", error.message);
    return { ok: false };
  }
  return { ok: true };
}

module.exports = { aptaParaKit, etiquetaUltima, listar, post, registrar, FOTOS_MAX, ACCIONES };

// src/data/propiedades-asesor.js
// Propiedades que publica Sofi a pedido de un asesor (origen = 'asesor').
// Spec docs/superpowers/specs/2026-10-19-sofi-publica-propiedad-asesor-design.md.
const config = require("../config");
const { buildSlug } = require("../lib/slug");
const { siguienteRef } = require("../lib/propiedad-asesor");

const DIA_MS = 86400000;
const VIGENCIA_DIAS = 30;
const AVISO_DIAS = 5;
const COLUMNA_FALTANTE = /origen|vence_at|vigencia_preguntada_at/;

const self = {
  // Indireccion para que los tests cambien el cliente sin tocar el require.
  _supabase: () => require("./supabase"),
};

// `desde`: ISO opcional (creacion de la ultima propiedad del captador). La
// ventana empieza en el mayor entre ahora - horas y `desde`, para no arrastrar
// las fotos de la propiedad anterior. Si hay mas de `max`, quedan las mas nuevas.
self.fotosRecientes = async function fotosRecientes(conversationId, { horas = 6, max = 10, desde = null } = {}) {
  const porHoras = Date.now() - horas * 3600e3;
  const inicio = new Date(Math.max(porHoras, desde ? new Date(desde).getTime() || 0 : 0)).toISOString();
  const { data, error } = await self._supabase()
    .from("messages")
    .select("media_url, media_mime, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .not("media_url", "is", null)
    .gte("created_at", inicio)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).filter((m) => /^image\//.test(String(m.media_mime || ""))).map((m) => m.media_url).slice(-max);
};

// created_at de la ultima propiedad que este captador publico con Sofi. Error -> null.
self.ultimaCreadaPor = async function ultimaCreadaPor(orgId, advisorId) {
  try {
    const { data, error } = await self._supabase()
      .from("properties")
      .select("created_at")
      .eq("org_id", orgId)
      .eq("origen", "asesor")
      .eq("captador_id", advisorId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data || !data.length) return null;
    return data[0].created_at || null;
  } catch {
    return null;
  }
};

self.crear = async function crear(org, advisor, fila, fotos) {
  const base = String(org.landing_base_url || config.landingBaseUrl).replace(/\/+$/, "");
  // Confirmar dos veces (reintento del modelo o doble toque) no crea dos refs:
  // misma propiedad del mismo captador en las ultimas 6 h con la misma primera foto.
  if (fotos && fotos.length) {
    const desde = new Date(Date.now() - 6 * 3600e3).toISOString();
    const { data: previas, error: eDup } = await self._supabase()
      .from("properties")
      .select("*")
      .eq("org_id", org.id)
      .eq("origen", "asesor")
      .eq("captador_id", advisor.id)
      .gte("created_at", desde)
      .contains("images", [fotos[0]])
      .limit(1);
    if (!eDup && previas && previas.length) return { ...previas[0], ya_existia: true };
  }
  for (let intento = 0; intento < 3; intento++) {
    const { data: refs, error } = await self._supabase().from("properties").select("ref").eq("org_id", org.id).ilike("ref", "D%");
    if (error) throw error;
    const ref = siguienteRef((refs || []).map((r) => r.ref));
    const row = {
      ...fila,
      org_id: org.id,
      ref,
      link: `${base}/propiedades/${buildSlug(fila.titulo, ref)}`,
      images: fotos,
      disponible: true,
      origen: "asesor",
      captador_id: advisor.id,
      vence_at: new Date(Date.now() + VIGENCIA_DIAS * DIA_MS).toISOString(),
      vigencia_preguntada_at: null,
    };
    const { data, error: e2 } = await self._supabase().from("properties").insert(row).select().single();
    if (!e2) return data;
    if (e2.code === "23505") continue;
    if (COLUMNA_FALTANTE.test(String(e2.message || ""))) {
      const err = new Error("Falta la migracion 2026-10-19_propiedades_asesor.sql");
      err.code = "SIN_MIGRACION";
      throw err;
    }
    throw e2;
  }
  throw new Error("No se pudo asignar una ref D libre");
};

async function deCaptador(orgId, advisorId, ref) {
  const { data, error } = await self._supabase()
    .from("properties")
    .select("id, ref")
    .eq("org_id", orgId)
    .eq("origen", "asesor")
    .eq("captador_id", advisorId)
    .eq("ref", String(ref || "").trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

self.aplicarVigencia = async function aplicarVigencia(orgId, advisorId, ref, sigue) {
  const p = await deCaptador(orgId, advisorId, ref);
  if (!p) return { estado: "no_encontrada", ref: String(ref || "").trim().toUpperCase() };
  const patch = sigue
    ? { disponible: true, vence_at: new Date(Date.now() + VIGENCIA_DIAS * DIA_MS).toISOString(), vigencia_preguntada_at: null }
    : { disponible: false };
  const { error } = await self._supabase().from("properties").update(patch).eq("id", p.id);
  if (error) throw error;
  return { estado: sigue ? "renovada" : "baja", ref: p.ref };
};

self.porPreguntar = async function porPreguntar(orgId, ahora = new Date()) {
  const limite = new Date(ahora.getTime() + AVISO_DIAS * DIA_MS).toISOString();
  const { data, error } = await self._supabase()
    .from("properties")
    .select("id, ref, titulo, captador_id, vence_at")
    .eq("org_id", orgId)
    .eq("origen", "asesor")
    .eq("disponible", true)
    .is("vigencia_preguntada_at", null)
    .lte("vence_at", limite);
  if (error) throw error;
  return data || [];
};

self.vencidas = async function vencidas(orgId, ahora = new Date()) {
  const { data, error } = await self._supabase()
    .from("properties")
    .select("id, ref, titulo, captador_id")
    .eq("org_id", orgId)
    .eq("origen", "asesor")
    .eq("disponible", true)
    .lte("vence_at", ahora.toISOString());
  if (error) throw error;
  return data || [];
};

self.marcarPreguntada = async function marcarPreguntada(id, ahora = new Date()) {
  const { error } = await self._supabase().from("properties").update({ vigencia_preguntada_at: ahora.toISOString() }).eq("id", id);
  if (error) throw error;
};

self.darDeBaja = async function darDeBaja(id) {
  const { error } = await self._supabase().from("properties").update({ disponible: false }).eq("id", id);
  if (error) throw error;
};

self.VIGENCIA_DIAS = VIGENCIA_DIAS;
self.AVISO_DIAS = AVISO_DIAS;
module.exports = self;

// Respuestas de colegas a nuestras publicaciones (spec 2026-10-20-publicaciones-y-respuestas).
const DIA_MS = 86400000;
const self = { _supabase: () => require("./supabase") };

// Una sola forma del lid: solo digitos + "@lid" (acepta "123" o "123@lid").
// null si no hay lid o no tiene digitos.
function lidCanonico(lid) {
  if (!lid) return null;
  const digitos = String(lid).replace(/\D/g, "");
  return digitos ? `${digitos}@lid` : null;
}
self.lidCanonico = lidCanonico;

self.postReciente = async function postReciente(orgId, ref, { dias = 7, ahora = new Date() } = {}) {
  const desde = new Date(ahora.getTime() - dias * DIA_MS).toISOString();
  const { data, error } = await self._supabase()
    .from("grupo_publicaciones").select("id, property_ref, group_id, created_at")
    .eq("org_id", orgId).eq("estado", "enviado").eq("property_ref", String(ref)).gte("created_at", desde)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
};

self.postsEnGrupos = async function postsEnGrupos(orgId, nombresGrupos, { horas = 48, ahora = new Date() } = {}) {
  if (!nombresGrupos || nombresGrupos.length === 0) return [];
  const { data: grupos, error: e1 } = await self._supabase()
    .from("whatsapp_groups").select("id, nombre").eq("org_id", orgId).in("nombre", nombresGrupos);
  if (e1) throw e1;
  const ids = (grupos || []).map((g) => g.id);
  if (!ids.length) return [];
  const desde = new Date(ahora.getTime() - horas * 3600e3).toISOString();
  const { data, error } = await self._supabase()
    .from("grupo_publicaciones").select("id, property_ref, group_id, created_at")
    .eq("org_id", orgId).eq("estado", "enviado").in("group_id", ids).gte("created_at", desde)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
};

self.postPorWamid = async function postPorWamid(orgId, wamid) {
  // El wamid viene del payload externo y va dentro de un filtro .or() de PostgREST:
  // solo se aceptan caracteres de un id de WhatsApp (sin , ( ) * ni espacios).
  if (!wamid || !/^[A-Za-z0-9@._:-]+$/.test(String(wamid))) return null;
  const { data, error } = await self._supabase()
    .from("grupo_publicaciones").select("id, property_ref, group_id, created_at")
    .eq("org_id", orgId)
    // wamid guardado = lo que devolvio enviarTexto (`true_<chat>_<ID>`); el
    // webhook puede citar esa forma o el ID desnudo: se aceptan las dos.
    .or(`wamid.eq.${String(wamid)},wamid.like.*_${String(wamid).split("_").pop()}`).limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
};

self.colegaGrupos = async function colegaGrupos(orgId, { lid = null, telefono = null } = {}) {
  let q = self._supabase().from("colegas_grupos").select("grupos").eq("org_id", orgId).limit(1);
  if (lid) q = q.eq("lid", String(lid).replace(/\D/g, ""));
  else if (telefono) q = q.eq("telefono", String(telefono));
  else return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data && data[0] && data[0].grupos) || [];
};

self.registrar = async function registrar(orgId, { ref, publicacionId = null, groupId = null, via, lid = null, telefono = null, nombre = null, texto = null, leadId = null, atendida = false }) {
  const lidC = lidCanonico(lid);
  const clave = lidC || telefono;
  if (!clave) return null;
  const ahora = new Date().toISOString();
  const { data: previa, error: e1 } = await self._supabase()
    .from("respuestas_publicacion").select("id, mensajes")
    .eq("org_id", orgId).eq("property_ref", String(ref)).eq("colega_clave", clave).maybeSingle();
  if (e1) throw e1;
  if (previa) {
    const { error } = await self._supabase().from("respuestas_publicacion")
      .update({ ultimo_entrante_at: ahora, mensajes: (previa.mensajes || 1) + 1, ...(leadId ? { lead_id: leadId } : {}) })
      .eq("id", previa.id);
    if (error) throw error;
    return { id: previa.id, nueva: false };
  }
  const fila = {
    org_id: orgId, property_ref: String(ref), publicacion_id: publicacionId, group_id: groupId, via,
    colega_lid: lidC, colega_telefono: telefono, colega_nombre: nombre, colega_clave: clave,
    primer_texto: texto ? String(texto).slice(0, 500) : null, lead_id: leadId,
    ...(atendida ? { atendida_at: ahora, atendida_por: via === "sofi" ? "sofi" : "linea" } : {}),
  };
  const { data, error } = await self._supabase().from("respuestas_publicacion").insert(fila).select("id").single();
  if (error) throw error;
  return { id: data.id, nueva: true };
};

self.marcarAtendidas = async function marcarAtendidas(orgId, { lid = null, telefono = null }, por) {
  const clave = lidCanonico(lid) || telefono;
  if (!clave) return 0;
  const { data, error } = await self._supabase().from("respuestas_publicacion")
    .update({ atendida_at: new Date().toISOString(), atendida_por: por })
    .eq("org_id", orgId).eq("colega_clave", clave).is("atendida_at", null).select("id");
  if (error) throw error;
  return (data || []).length;
};

// "Marcar atendida" del CRM: una sola fila, de esta org. Devuelve si existia
// (una ya atendida se deja como esta y cuenta como existente).
self.marcarAtendidaPorId = async function marcarAtendidaPorId(orgId, id, por = "manual") {
  const { data, error } = await self._supabase().from("respuestas_publicacion")
    .update({ atendida_at: new Date().toISOString(), atendida_por: por })
    .eq("org_id", orgId).eq("id", id).is("atendida_at", null).select("id");
  if (error) throw error;
  if ((data || []).length) return { ok: true, ya: false };
  const { data: fila, error: e2 } = await self._supabase().from("respuestas_publicacion")
    .select("id").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (e2) throw e2;
  return fila ? { ok: true, ya: true } : { ok: false };
};

self.abiertas = async function abiertas(orgId) {
  const { data, error } = await self._supabase().from("respuestas_publicacion").select("*")
    .eq("org_id", orgId).in("via", ["linea", "grupo"]).is("atendida_at", null).limit(500);
  if (error) throw error;
  return data || [];
};

self.marcar = async function marcar(id, patch) {
  const { error } = await self._supabase().from("respuestas_publicacion").update(patch).eq("id", id);
  if (error) throw error;
};

self.marcarPuente = async function marcarPuente(orgId, { lid = null, telefono = null } = {}) {
  const clave = lidCanonico(lid) || telefono;
  if (!clave) return 0;
  const { data, error } = await self._supabase().from("respuestas_publicacion")
    .update({ puente_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("colega_clave", clave).is("puente_at", null).select("id");
  if (error) throw error;
  return (data || []).length;
};

module.exports = self;

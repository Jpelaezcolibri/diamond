// Notificaciones de la App de asesores (Fase 1, spec 2026-10-07-app-diamond-
// asesores §4). Escribe la fila que lee la campana del CRM (tabla
// notificaciones, Realtime) y manda el push al celular de cada suscripcion del
// asesor (web-push con claves VAPID). WhatsApp NO sale de aca: los dos tipos
// urgentes (cita por confirmar, pidieron un asesor) ya salen por su camino.
//
// Nunca lanza: una notificacion que falla no puede tumbar la cita, la
// confirmacion o el aviso que la disparo.
const supabase = require("../data/supabase");

function depsPorDefecto() {
  const vapid = Boolean(process.env.VAPID_PRIVATE_KEY && process.env.VAPID_PUBLIC_KEY);
  let webpush = null;
  if (vapid) {
    webpush = require("web-push");
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:soporte@diamondinmobiliaria.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }
  return {
    vapid,
    insertar: async (fila) => {
      if (!supabase) return { ok: true };
      const { error } = await supabase.from("notificaciones").insert(fila);
      if (error) throw error;
      return { ok: true };
    },
    suscripciones: async (advisorId) => {
      if (!supabase) return [];
      const { data, error } = await supabase.from("push_suscripciones").select("id, endpoint, p256dh, auth").eq("advisor_id", advisorId);
      if (error) throw error;
      return data || [];
    },
    enviarPush: async (sub, payload) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60 });
        return { ok: true };
      } catch (e) {
        return { ok: false, statusCode: e.statusCode, error: e.message };
      }
    },
    borrarSuscripcion: async (id) => {
      if (supabase) await supabase.from("push_suscripciones").delete().eq("id", id);
    },
  };
}

async function notificar({ orgId, advisor, tipo, titulo, cuerpo = null, link = null, leadId = null }, deps = null) {
  if (!advisor || !advisor.id || !orgId) return { ok: false, push: 0 };
  const d = deps || depsPorDefecto();
  try {
    await d.insertar({ org_id: orgId, advisor_id: advisor.id, tipo, titulo, cuerpo, link, lead_id: leadId });
  } catch (e) {
    console.warn(`[notificar] No se pudo guardar la notificacion ${tipo} para ${advisor.name || advisor.id}:`, e.message);
    return { ok: false, push: 0 };
  }
  if (!d.vapid) return { ok: true, push: 0 };

  let push = 0;
  try {
    const subs = await d.suscripciones(advisor.id);
    const payload = JSON.stringify({ titulo, cuerpo, link });
    for (const sub of subs) {
      const r = await d.enviarPush(sub, payload);
      if (r && r.ok) push++;
      // 404/410: el navegador dio de baja la suscripcion; no sirve guardarla.
      else if (r && (r.statusCode === 404 || r.statusCode === 410)) await d.borrarSuscripcion(sub.id).catch(() => {});
      else console.warn(`[notificar] push fallo para ${advisor.name || advisor.id}:`, r && r.error);
    }
  } catch (e) {
    console.warn("[notificar] No se pudo mandar el push:", e.message);
  }
  return { ok: true, push };
}

module.exports = { notificar };

// Publicador automatico de amoblados en grupos desde la linea del radar
// (Juan, 2026-10-19; spec docs/superpowers/specs/2026-10-19-publicador-grupos-design.md).
//
// Cada 5 min, en horario, publica como mucho UN post: el grupo que hace mas
// tiempo no recibe nada, con la ref que hace mas tiempo no sale. Que se
// publica y en que orden lo decide src/groups/publicador.js; aca vive el
// freno:
// - RADAR_PUBLICAR_ACTIVO=true lo enciende (apagado por defecto: es un envio
//   automatico desde una linea no oficial, como ventana-asesora).
// - Sin la tabla grupo_publicaciones no publica: el tope y el candado de 7
//   dias dependen de ella.
// - Una sola sesion activa y WORKING en WAHA.
// - Un envio que falla pausa el resto del dia y avisa a ALERTA_TECNICA_TO. El
//   baneo de julio empezo con un 503; insistir es lo peor que se puede hacer.

const publicador = require("../groups/publicador");

const VALORES_ENCENDIDO = new Set(["true", "1", "si", "sí", "on"]);
const ESPACIO_MIN = 20;
const ESPACIO_MAX = 40;
const TICK_MS = 5 * 60 * 1000;
const DIA_MS = 86400000;

const estado = { noAntesDe: null, pausadoDia: null, avisoSesionDia: null, linkRoto: new Map() };

function activo() {
  return VALORES_ENCENDIDO.has(String(process.env.RADAR_PUBLICAR_ACTIVO ?? "").trim().toLowerCase());
}

function maxDia() {
  const n = Number(process.env.RADAR_PUBLICAR_MAX_DIA || 8);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

function depsPorDefecto() {
  const supabase = require("../data/supabase");
  const whatsappGroups = require("../data/whatsapp-groups");
  const organizations = require("../data/organizations");
  const syncEstado = require("../data/sync-estado");
  const waha = require("../lib/waha");
  const kit = require("../groups/kit");
  const { enviarAlertaTecnica } = require("../lib/alerta-saldo");
  return {
    orgs: () => organizations.listActive(),
    inventarioFresco: async (org) => (await syncEstado.estadoDelInventario(org.id)).fresco,
    grupos: async (org) => {
      const { data, error } = await supabase.from("whatsapp_groups").select("id, jid, nombre, publica").eq("org_id", org.id).not("publica", "is", null);
      if (error) throw error;
      return data || [];
    },
    // null = la tabla no existe o no se pudo leer: falla cerrado.
    historial: async (org, desdeIso) => {
      const { data, error } = await supabase
        .from("grupo_publicaciones")
        .select("group_id, property_ref, estado, created_at")
        .eq("org_id", org.id)
        .gte("created_at", desdeIso);
      if (error) {
        console.warn("[publicador] No se pudo leer grupo_publicaciones (revisar migracion 2026-10-19_publicador_grupos):", error.message);
        return null;
      }
      return data || [];
    },
    propiedades: async (org) => {
      const { data, error } = await supabase.from("properties").select("*").eq("org_id", org.id).eq("disponible", true);
      if (error) throw error;
      return data || [];
    },
    sesion: async (org) => {
      const sesiones = await whatsappGroups.listSessions(org.id);
      const activas = (sesiones || []).filter((s) => s.estado === "activa");
      if (activas.length !== 1) return { nombre: null, motivo: `${activas.length} sesiones activas` };
      const e = await waha.estadoSesion(activas[0].nombre).catch((err) => ({ status: `error: ${err.message}` }));
      return e && e.status === "WORKING" ? { nombre: activas[0].nombre } : { nombre: null, motivo: `sesion ${activas[0].nombre} en ${e && e.status}` };
    },
    post: (org, ref) => kit.post(org, ref),
    enviar: (sesion, jid, texto) => waha.enviarTexto(sesion, jid, texto),
    registrar: async (fila) => {
      const { error } = await supabase.from("grupo_publicaciones").insert(fila);
      if (error) console.error("[publicador] No se pudo registrar la publicacion:", error.message);
    },
    alertar: (resumen, detalle) => enviarAlertaTecnica(resumen, detalle).catch(() => false),
    azar: Math.random,
    // Cuenta TODAS las publicaciones enviadas de la ref, sin ventana de fechas. null = error.
    vecesPublicada: async (org, ref) => {
      const { count, error } = await supabase
        .from("grupo_publicaciones")
        .select("id", { count: "exact", head: true })
        .eq("org_id", org.id)
        .eq("property_ref", String(ref))
        .eq("estado", "enviado");
      if (error) {
        console.warn("[publicador] No se pudo contar las publicaciones de", ref, error.message);
        return null;
      }
      return count;
    },
    // Excepcion aprobada por Juan: "el aviso de que se publico le llega al asesor". Sale
    // una sola vez por propiedad y responde a lo que el propio asesor pidio, asi que no
    // pasa por ritmo ni por ASESORA_SOLO_VISITAS.
    avisarCaptador: async (org, propiedad, grupo) => {
      if (!propiedad.captador_id) return;
      const advisor = await require("../data/advisors").findById(org.id, propiedad.captador_id).catch(() => null);
      if (!advisor || !advisor.phone) return;
      const texto = `📣 Tu ${propiedad.ref} salió en ${grupo.nombre}. Sigue rotando en los demás grupos; si un colega pregunta, te aviso.`;
      const r = await require("../lib/mensaje-asesor").enviarYRegistrar(org, advisor.phone, texto).catch((e) => ({ ok: false, error: e.message }));
      if (!r || !r.ok) console.warn(`[publicador] No se pudo avisar a ${advisor.name} de la ${propiedad.ref}: ${r && r.error}`);
    },
  };
}

async function runParaOrg(org, d, ahora) {
  const hoy = publicador.diaBogota(ahora);
  if (estado.pausadoDia === hoy) return { resultado: "pausado" };
  if (!publicador.enHorario(ahora)) return { resultado: "fuera_de_horario" };

  const historial = await d.historial(org, new Date(ahora.getTime() - (publicador.DIAS_SIN_REPETIR + 1) * DIA_MS).toISOString());
  if (historial === null) return { resultado: "sin_tabla" };
  if (!(await d.inventarioFresco(org))) return { resultado: "inventario_viejo" };

  // Tras un reinicio no hay espaciado en memoria: 20 min desde el ultimo post.
  let noAntesDe = estado.noAntesDe;
  if (!noAntesDe && historial.length) {
    const ultimo = Math.max(...historial.map((h) => new Date(h.created_at).getTime()));
    noAntesDe = new Date(ultimo + ESPACIO_MIN * 60000);
  }

  const excluirRefs = new Set([...estado.linkRoto].filter(([, dia]) => dia === hoy).map(([ref]) => ref));
  const [grupos, propiedades] = await Promise.all([d.grupos(org), d.propiedades(org)]);
  const eleccion = publicador.elegir({ grupos, propiedades, historial, ahora, maxDia: maxDia(), noAntesDe, excluirRefs });
  if (!eleccion.grupo) return { resultado: eleccion.motivo };
  const { grupo, propiedad } = eleccion;

  const sesion = await d.sesion(org);
  if (!sesion.nombre) {
    if (estado.avisoSesionDia !== hoy) {
      estado.avisoSesionDia = hoy;
      await d.alertar("El publicador de grupos no publicó: la línea del radar no está lista.", sesion.motivo || "");
    }
    return { resultado: "sin_sesion" };
  }

  const post = await d.post(org, propiedad.ref);
  if (!post || !post.linkOk) {
    estado.linkRoto.set(String(propiedad.ref), hoy);
    console.warn(`[publicador] Ref ${propiedad.ref} sin post o con link que no abre; se salta hoy`);
    return { resultado: "link_roto", ref: propiedad.ref };
  }

  const texto = publicador.textoPost(grupo, propiedad, post.texto, ahora);
  const r = await d.enviar(sesion.nombre, grupo.jid, texto);
  const fila = {
    org_id: org.id,
    group_id: grupo.id,
    group_jid: grupo.jid,
    property_ref: String(propiedad.ref),
    estado: r && r.ok ? "enviado" : "fallo",
    wamid: (r && r.wamid) || null,
    error: r && r.ok ? null : String((r && r.error) || "sin detalle").slice(0, 500),
  };
  await d.registrar(fila);

  if (!r || !r.ok) {
    estado.pausadoDia = hoy;
    await d.alertar(
      "El publicador de grupos falló un envío y se pausó por hoy.",
      `${grupo.nombre} · Ref ${propiedad.ref}: ${fila.error}`
    );
    return { resultado: "fallo", ref: propiedad.ref, grupo: grupo.nombre };
  }

  const espacio = ESPACIO_MIN + d.azar() * (ESPACIO_MAX - ESPACIO_MIN);
  estado.noAntesDe = new Date(ahora.getTime() + espacio * 60000);
  console.log(`[publicador] Ref ${propiedad.ref} -> ${grupo.nombre} (${fila.wamid})`);

  // El envio ya quedo registrado: es el primero de la propiedad si la cuenta total es 1.
  // Sin cuenta confiable (null) no se avisa.
  if (publicador.esDeAsesor(propiedad) && d.avisarCaptador && d.vecesPublicada) {
    const veces = await d.vecesPublicada(org, propiedad.ref).catch(() => null);
    if (veces === 1) await d.avisarCaptador(org, propiedad, grupo).catch((e) => console.warn("[publicador] avisarCaptador:", e.message));
  }
  return { resultado: "enviado", ref: propiedad.ref, grupo: grupo.nombre };
}

async function runOnce({ ahora = new Date(), deps = null } = {}) {
  if (!activo()) return [];
  const d = deps || depsPorDefecto();
  const resultados = [];
  for (const org of await d.orgs()) {
    try {
      resultados.push({ org: org.name, ...(await runParaOrg(org, d, ahora)) });
    } catch (e) {
      console.error("[publicador] error en", org.name, e.message);
      resultados.push({ org: org.name, resultado: "error" });
    }
  }
  return resultados;
}

function start() {
  if (!activo()) {
    console.log("[publicador] apagado (RADAR_PUBLICAR_ACTIVO)");
    return;
  }
  const tick = () => runOnce().catch((e) => console.error("[publicador] runOnce:", e.message));
  setTimeout(tick, 60 * 1000);
  setInterval(tick, TICK_MS);
  console.log(`[publicador] PRENDIDO — amoblados en grupos, máx ${maxDia()} por día`);
}

function _reset() {
  estado.noAntesDe = null;
  estado.pausadoDia = null;
  estado.avisoSesionDia = null;
  estado.linkRoto.clear();
}

module.exports = { start, runOnce, activo, _reset };

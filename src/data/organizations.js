const supabase = require("./supabase");
const memory = require("./memory");

async function findByWhatsappPhoneId(phoneId) {
  if (!supabase) {
    return memory.organizations.find((o) => o.whatsapp_phone_id === phoneId) || null;
  }
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("whatsapp_phone_id", phoneId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Org por defecto para canales de prueba (Telegram, /test) en fase single-tenant
async function getDefault() {
  if (!supabase) return memory.organizations[0];
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Todas las orgs activas — usado por los schedulers (followups, reminders):
// antes solo procesaban getDefault() (la primera org), asi que el dia que
// exista una org #2 sus seguimientos/recordatorios nunca corrian.
async function listActive() {
  if (!supabase) return memory.organizations;
  const { data, error } = await supabase.from("organizations").select("*").eq("status", "active");
  if (error) throw error;
  return data || [];
}

// ── Interruptor del motor de Radar ───────────────────────────────────────
//
// Lo que apaga es lo que se paga: clasificar un export y mandar el digest.
// Leer lo ya detectado nunca depende de esto.

async function findById(orgId) {
  if (!supabase) return memory.organizations.find((o) => o.id === orgId) || null;
  const { data, error } = await supabase
    .from("organizations").select("*").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return data;
}

// La decision, sin IO. Solo un `false` explicito apaga: si la columna todavia
// no existe (migracion sin correr) o la org no se pudo leer, se asume
// ENCENDIDO. Una organizacion que nunca pidio apagar Radar no puede quedarse
// sin producto porque falte un alter table.
function radarEncendido(org) {
  return org?.radar_activo !== false;
}

async function radarActivo(orgId) {
  return radarEncendido(await findById(orgId));
}

async function setRadarActivo(orgId, activo) {
  if (!supabase) {
    const o = memory.organizations.find((x) => x.id === orgId);
    if (!o) throw new Error("Organizacion no encontrada");
    o.radar_activo = Boolean(activo);
    return o;
  }
  const { data, error } = await supabase
    .from("organizations")
    .update({ radar_activo: Boolean(activo) })
    .eq("id", orgId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Modo de respuesta del radar en los grupos ────────────────────────────
//
// sombra   redacta y registra, no publica nada
// asistido Sofi revalida y avisa por privado a la asesora, no publica nada
// auto     publica en el grupo (compuertas deterministicas, sin juicio de un
//          modelo — ver publicable.js: "aca no hay nadie revisando")
//
// Toggle en base (2026-08-18) en vez de variable de entorno de Railway:
// cambiar una env var implica editar el servicio y esperar el redeploy.
const MODOS_RESPUESTA = ["sombra", "asistido", "auto"];

// Sin columna (migracion sin correr) o valor invalido, cae a la variable de
// entorno — el comportamiento de siempre — y no a un default fijo: no hay
// forma segura de adivinar que modo asumia production antes de esta migracion.
// El carril de COMPRA (Juan, 2026-09-02): "quiero tener la posibilidad de
// desactivar los mandatos... para poder enfocar todas las fuerzas en las
// propiedades que tenemos para la venta".
//
// Degrada a ENCENDIDO si la columna no existe todavia: es el comportamiento
// que la organizacion tenia antes de que el interruptor existiera, mismo
// criterio que radarEncendido.
function mandatosActivos(org) {
  return !org || org.mandatos_activos !== false;
}

async function setMandatosActivos(orgId, activos) {
  if (!supabase) {
    const o = memory.organizations.find((x) => x.id === orgId);
    if (!o) throw new Error("Organizacion no encontrada");
    o.mandatos_activos = Boolean(activos);
    return o;
  }
  const { data, error } = await supabase
    .from("organizations")
    .update({ mandatos_activos: Boolean(activos) })
    .eq("id", orgId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

function modoDeRespuesta(org) {
  const valor = org && org.grupos_respuesta_modo;
  if (MODOS_RESPUESTA.includes(valor)) return valor;
  return process.env.GRUPOS_RESPUESTA_MODO || "sombra";
}

async function setModoDeRespuesta(orgId, modo) {
  if (!MODOS_RESPUESTA.includes(modo)) throw new Error(`Modo de respuesta invalido: ${modo}`);
  if (!supabase) {
    const o = memory.organizations.find((x) => x.id === orgId);
    if (!o) throw new Error("Organizacion no encontrada");
    o.grupos_respuesta_modo = modo;
    return o;
  }
  const { data, error } = await supabase
    .from("organizations")
    .update({ grupos_respuesta_modo: modo })
    .eq("id", orgId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  findByWhatsappPhoneId, getDefault, listActive,
  findById, radarActivo, setRadarActivo, radarEncendido,
  modoDeRespuesta, setModoDeRespuesta, MODOS_RESPUESTA,
  mandatosActivos, setMandatosActivos,
};

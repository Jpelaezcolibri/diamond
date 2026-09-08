// Inbox pasivo de los mensajes DIRECTOS (no de grupo) que le llegan a la
// linea vinculada del radar — ver db/migrations/2026-08-21_linea_dm.sql para
// el por que existe y por que NO se generaliza a cualquier linea.
//
// Nadie responde desde aca: es lectura y alerta, no un canal de conversacion
// (ver la nota de diseno en src/groups/dm.js).

const supabase = require("./supabase");
const memory = require("./memory");

// La IDENTIDAD de quien escribe (Juan, 2026-09-08): un chat 1 a 1 llega por
// `<telefono>@c.us` o por `<lid>@lid`, nunca por los dos. Se resuelve a UNA
// columna para consultar el hilo y el dedup de alertas. El lid gana si
// existe, porque es la unica identidad estable para el 98% de los colegas
// (ver docs/superpowers/specs/2026-09-08-linea-dm-lid-y-seguimiento-design.md).
function columnaDeIdentidad(identidad) {
  if (!identidad) return null;
  if (identidad.lid) return { columna: "remitente_lid", valor: identidad.lid };
  if (identidad.telefono) return { columna: "remitente_telefono", valor: identidad.telefono };
  return null;
}

function esTablaFaltante(error) {
  // 42P01: la tabla no existe. PGRST205: PostgREST no la tiene en su cache.
  return error?.code === "42P01" || error?.code === "PGRST205";
}

// Falta una COLUMNA, que no es lo mismo que faltar la tabla. PGRST204:
// PostgREST no la encuentra en su cache de esquema. 42703: Postgres dice que
// no existe. Mismo criterio que src/data/group-signals.js#esColumnaFaltante,
// src/data/mandatos.js y src/data/radar-trazabilidad.js.
function esColumnaFaltante(error) {
  return error?.code === "PGRST204" || error?.code === "42703";
}

// Lo que `create` puede sacrificar cuando una migracion no corrio todavia.
// Hoy solo remitente_lid (2026-09-08_linea_dm_lid.sql); si manana se agrega
// otra columna nueva, va aca.
const COLUMNAS_NUEVAS = ["remitente_lid"];

let faltaTabla = false;
function avisarFaltaTabla() {
  if (faltaTabla) return;
  faltaTabla = true;
  console.warn(
    "[linea-dm] Falta correr db/migrations/2026-08-21_linea_dm.sql — los DM de la linea vinculada no se estan guardando."
  );
}

// Un aviso por proceso, no uno por mensaje: mientras la migracion este
// pendiente esto corre en CADA DM que entra y taparia el log.
let faltaColumna = false;
function avisarFaltaColumna() {
  if (faltaColumna) return;
  faltaColumna = true;
  console.warn(
    "[linea-dm] Falta correr db/migrations/2026-09-08_linea_dm_lid.sql — el DM se guarda igual, pero sin remitente_lid: el hilo del colega no se puede agrupar por su lid."
  );
}

// Alta con dedup por wa_message_id (mismo criterio que group-signals.js).
async function create(orgId, fields) {
  const row = {
    org_id: orgId,
    sesion: fields.sesion || null,
    wa_message_id: fields.waMessageId,
    remitente_telefono: fields.remitenteTelefono || null,
    remitente_lid: fields.remitenteLid || null,
    remitente_nombre: fields.remitenteNombre || null,
    texto: fields.texto || null,
    fecha_mensaje: fields.fechaMensaje || null,
    senal_id: fields.senalId || null,
  };

  if (!supabase) {
    memory.lineaDm = memory.lineaDm || [];
    const yaEsta = memory.lineaDm.find((m) => m.org_id === orgId && m.wa_message_id === row.wa_message_id);
    if (yaEsta) return { mensaje: yaEsta, duplicado: true };
    const creado = { id: memory.uid(), created_at: new Date().toISOString(), ...row };
    memory.lineaDm.push(creado);
    return { mensaje: creado, duplicado: false };
  }

  let { data, error } = await supabase.from("linea_dm").insert(row).select().single();

  // DEGRADACION SI FALTA LA COLUMNA (revision final, 2026-09-08). El caso
  // real es desplegar antes de que corra 2026-09-08_linea_dm_lid.sql. Sin
  // esto, el error caia en el `throw` de abajo: la excepcion la atrapa el
  // .catch del webhook (src/channels/whatsapp-group.js), pero para entonces
  // yaVisto() ya marco el mensaje y a WAHA ya se le respondio 200 — la
  // primera respuesta de un colega se perdia PARA SIEMPRE, y el panel vacio
  // mandaba a diagnosticar lo que no era. Se suelta UNA columna, no la fila.
  if (error && esColumnaFaltante(error)) {
    avisarFaltaColumna();
    const degradado = { ...row };
    for (const c of COLUMNAS_NUEVAS) delete degradado[c];
    ({ data, error } = await supabase.from("linea_dm").insert(degradado).select().single());
  }

  if (!error) return { mensaje: data, duplicado: false };
  // 23505 = violacion de indice unico: dedup haciendo su trabajo, no un fallo.
  if (error.code === "23505") return { mensaje: null, duplicado: true };
  if (esTablaFaltante(error)) {
    avisarFaltaTabla();
    return { mensaje: null, duplicado: false };
  }
  throw error;
}

// Los ultimos mensajes de ESTE remitente, mas viejo primero — el contexto
// completo del hilo que necesita el clasificador (src/groups/dm.js): una
// fecha puede quedar dicha en un mensaje y la hora en el siguiente.
async function historialDe(orgId, identidad, { limite = 10 } = {}) {
  const filtro = columnaDeIdentidad(identidad);
  if (!filtro) return [];
  if (!supabase) {
    return (memory.lineaDm || [])
      .filter((m) => m.org_id === orgId && m[filtro.columna] === filtro.valor)
      .slice(-limite);
  }
  const { data, error } = await supabase
    .from("linea_dm")
    .select("id, texto, created_at")
    .eq("org_id", orgId)
    .eq(filtro.columna, filtro.valor)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) {
    // Tabla o columna faltante: el hilo se degrada a vacio (el clasificador
    // trabaja con el mensaje suelto) en vez de tumbar todo el procesamiento.
    if (esTablaFaltante(error) || esColumnaFaltante(error)) return [];
    throw error;
  }
  return (data || []).reverse();
}

async function guardarClasificacion(orgId, id, { tieneCita, avanceTipo = null, fechaHoraIso = null, confianza = null }) {
  if (!supabase) {
    const m = (memory.lineaDm || []).find((x) => x.id === id && x.org_id === orgId);
    if (m) { m.tiene_cita = tieneCita; m.avance_tipo = avanceTipo; m.cita_fecha_hora_iso = fechaHoraIso; m.cita_confianza = confianza; }
    return true;
  }
  const { error } = await supabase
    .from("linea_dm")
    .update({ tiene_cita: tieneCita, avance_tipo: avanceTipo, cita_fecha_hora_iso: fechaHoraIso, cita_confianza: confianza })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) {
    if (esTablaFaltante(error) || esColumnaFaltante(error)) return false;
    console.error("[linea-dm] No se pudo guardar la clasificacion:", error.message);
    return false;
  }
  return true;
}

async function marcarAlertado(orgId, id) {
  if (!supabase) {
    const m = (memory.lineaDm || []).find((x) => x.id === id && x.org_id === orgId);
    if (m) m.alertado_at = new Date().toISOString();
    return true;
  }
  const { error } = await supabase
    .from("linea_dm")
    .update({ alertado_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) {
    console.error("[linea-dm] No se pudo marcar el aviso del avance:", error.message);
    return false;
  }
  return true;
}

// La CLAVE del ultimo avance YA alertado de este remitente (fecha_hora si la
// hay, si no el tipo de avance) — para no re-avisar el MISMO avance en cada
// mensaje nuevo del hilo, pero SI avisar de nuevo si cambia (reagenda, o
// paso de "agendando" a "cita_confirmada").
async function ultimaCitaAlertada(orgId, identidad) {
  const filtro = columnaDeIdentidad(identidad);
  if (!filtro) return null;
  const clave = (m) => m?.cita_fecha_hora_iso || m?.avance_tipo || null;
  if (!supabase) {
    const alertadas = (memory.lineaDm || [])
      .filter((m) => m.org_id === orgId && m[filtro.columna] === filtro.valor && m.alertado_at)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return clave(alertadas[0]);
  }
  const { data, error } = await supabase
    .from("linea_dm")
    .select("cita_fecha_hora_iso, avance_tipo")
    .eq("org_id", orgId)
    .eq(filtro.columna, filtro.valor)
    .not("alertado_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Sin la columna no hay como saber que se alerto antes. Devolver null es
    // lo mismo que hacia el throw (dm.js lo atrapa con .catch(() => null)),
    // pero sin ruido: el efecto es que el dedup del aviso no frena nada
    // mientras la migracion siga pendiente.
    if (esTablaFaltante(error) || esColumnaFaltante(error)) return null;
    throw error;
  }
  return clave(data);
}

module.exports = { create, historialDe, guardarClasificacion, marcarAlertado, ultimaCitaAlertada, columnaDeIdentidad };

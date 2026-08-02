// Learning Domain — el Event Store de Radar.
//
// QUE GUARDA: lo que le paso a una oportunidad despues de que Radar la
// detecto. Si el asesor le escribio al colega, si hubo visita, si termino en
// negocio, y si no, por que.
//
// POR QUE EXISTE: `group_signals.estado` guarda una fotografia — nuevo,
// gestionado, descartado. La fotografia dice como termino; no dice como llego
// hasta ahi. Radar aprende de la historia, no de la fotografia (P15).
//
// APPEND-ONLY, Y EN SERIO. Este modulo no expone actualizar ni borrar, y la
// base tampoco lo permite: hay un trigger que revienta cualquier UPDATE o
// DELETE. Si algo cambia, se registra un evento nuevo. Reescribir la historia
// de una oportunidad es exactamente lo que P15 prohibe.
//
// DIRECCION DE LA DEPENDENCIA — la regla que hay que cuidar al tocar esto:
//
//   Radar -> Learning Domain     OK
//   Learning Domain -> Radar     NUNCA
//
// Nada del producto puede necesitar esta tabla para funcionar. Esta entera se
// puede borrar y Radar sigue detectando, cruzando y mandando el digest igual.
// Por eso `registrar` es best-effort para sus llamadores: si falla, se pierde
// un evento, no una venta.

const supabase = require("./supabase");
const memory = require("./memory");

// El recorrido natural de una oportunidad, de punta a punta. Incluye los dos
// finales —CIERRE y PERDIDO— porque el fracaso ensena tanto como el exito, y
// DESCARTADO, que es distinto de perder: es no haberla tomado nunca.
const TIPOS = [
  "SIN_RESPUESTA", "CONVERSACION", "VISITA",
  "NEGOCIACION", "CIERRE", "PERDIDO", "DESCARTADO",
];

// La tabla llega con la migracion 2026-08-02_learning_domain.sql. Si todavia no
// corrio, registrar() no puede tumbar al que la llama: el producto no depende
// del aprendizaje. Se avisa una sola vez para no llenar los logs.
let faltaTabla = false;

function esTablaFaltante(error) {
  // 42P01: la tabla no existe. PGRST205: PostgREST no la tiene en su cache.
  return error?.code === "42P01" || error?.code === "PGRST205";
}

// Registra un evento. `advisorId` es quien lo REGISTRA, que puede no ser quien
// observo la senal: un admin puede cerrar el ciclo de una oportunidad ajena.
//
// Devuelve el evento, o null si no se pudo guardar. Nunca lanza por falta de
// tabla — ver la nota de dependencia arriba.
async function registrar(orgId, { signalId, advisorId = null, tipo, motivo = null }) {
  if (!TIPOS.includes(tipo)) throw new Error(`Tipo de evento invalido: ${tipo}`);
  if (!signalId) throw new Error("Falta signalId: un evento sin oportunidad no ensena nada");

  const row = {
    org_id: orgId,
    signal_id: signalId,
    advisor_id: advisorId || null,
    tipo,
    motivo: motivo || null,
  };

  if (!supabase) {
    const creado = { id: memory.uid(), ...row, created_at: new Date().toISOString() };
    memory.signalEvents.push(creado);
    return creado;
  }

  const { data, error } = await supabase.from("signal_events").insert(row).select().single();
  if (error) {
    if (esTablaFaltante(error)) {
      if (!faltaTabla) {
        faltaTabla = true;
        console.warn(
          "[learning] Falta correr db/migrations/2026-08-02_learning_domain.sql — " +
          "los eventos de las oportunidades no se estan guardando."
        );
      }
      return null;
    }
    throw error;
  }
  return data;
}

// La historia completa de una oportunidad, en orden (P16). El orden ES parte
// del conocimiento: "visita y despues perdido" y "perdido y despues visita"
// son dos cosas distintas.
async function historia(orgId, signalId) {
  if (!supabase) {
    return memory.signalEvents
      .filter((e) => e.org_id === orgId && e.signal_id === signalId)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  const { data, error } = await supabase
    .from("signal_events")
    .select("*")
    .eq("org_id", orgId)
    .eq("signal_id", signalId)
    .order("created_at", { ascending: true });
  if (error) {
    if (esTablaFaltante(error)) return [];
    throw error;
  }
  return data || [];
}

// El ultimo evento de cada oportunidad de una tanda. Es lo que la pantalla
// necesita para mostrar "en que quedo" sin traer la historia entera.
//
// Se resuelve en memoria y no con una consulta por senal: son decenas de
// señales por pantalla y la tabla es chica. Cuando deje de serlo, esto pasa a
// ser una vista en la base — y por eso los llamadores reciben un Map y no
// saben como se calculo.
async function ultimoPorSenal(orgId, signalIds) {
  const ids = (signalIds || []).filter(Boolean);
  if (ids.length === 0) return new Map();

  let filas;
  if (!supabase) {
    filas = memory.signalEvents.filter((e) => e.org_id === orgId && ids.includes(e.signal_id));
  } else {
    const { data, error } = await supabase
      .from("signal_events")
      .select("*")
      .eq("org_id", orgId)
      .in("signal_id", ids)
      .order("created_at", { ascending: true });
    if (error) {
      if (esTablaFaltante(error)) return new Map();
      throw error;
    }
    filas = data || [];
  }

  // Orden ascendente + sobreescribir deja el ultimo de cada senal.
  const ultimo = new Map();
  for (const e of filas) ultimo.set(e.signal_id, e);
  return ultimo;
}

// Solo lectura y alta. No hay `actualizar` ni `borrar`, y su ausencia es la
// decision, no un olvido: lo custodia test/signal-events.test.js.
module.exports = { registrar, historia, ultimoPorSenal, TIPOS };

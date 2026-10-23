// Eco de la linea OFICIAL de Sofi dentro de la linea VINCULADA del radar.
//
// EL CASO (2026-10-21 al 23): Sofi le escribe a Daiana por Cloud API — el
// resumen de pedidos de 12 m. y 5 p. m., el aviso "Respuestas a nuestras
// publicaciones sin atender", el mensaje que mantiene abierta la ventana.
// WAHA, que escucha la linea de Daiana, entrega cada uno como un DM entrante
// de un contacto "Diamond" (lid 48297494470698, sin telefono). dm.js lo
// trataba como a cualquier colega: lo guardaba en linea_dm, y como el texto
// nombra refs, respuestas-publicacion#deLinea lo registraba como respuesta de
// un colega a nuestra publicacion. El siguiente resumen lo listaba como "sin
// atender" y asi: 3 de las 7 filas de respuestas_publicacion eran de Sofi
// hablandose a si misma. Con RADAR_SOFI_LINEA encendido, ademas, Sofi le
// habria contestado a Sofi.
//
// LA REGLA: un DM es eco de Sofi si (a) viene del telefono de la linea
// oficial, (b) su texto es exactamente un mensaje que Sofi mando por Cloud API
// en las ultimas horas (tabla messages, role=assistant), o (c) viene de un lid
// que ya se reconocio por (b) en este proceso. Se compara el texto completo y
// solo si tiene cierto largo: un "Hola" de un colega jamas se confunde con el
// "¡Hola!" que Sofi le dijo a un cliente.
//
// FALLA ABIERTA a proposito: si la base no responde, el mensaje sigue como de
// un colega. Es preferible que un eco se cuele una vez a que se le calle a
// una persona por una duda de red.

const HORAS_ATRAS = 72;
const LARGO_MINIMO = 25;

const self = { _supabase: () => require("../data/supabase") };

// Lids reconocidos como Sofi en este proceso. Se aprende, no se configura:
// el lid que WhatsApp le asigna a nuestra linea dentro del chat de Daiana no
// se conoce de antemano y no esta en directorio_lids.
const lidsPropios = new Set();

function soloDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

function numeroOficial(org) {
  return soloDigitos((org && org.contact_whatsapp_number) || process.env.CONTACT_WHATSAPP_NUMBER);
}

async function mensajeRecienteDeSofi(texto, ahora) {
  const desde = new Date(ahora.getTime() - HORAS_ATRAS * 3600 * 1000).toISOString();
  const { data, error } = await self._supabase()
    .from("messages").select("id")
    .eq("role", "assistant").eq("content", texto).gte("created_at", desde)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

/**
 * @param org        organizacion (usa contact_whatsapp_number; cae al env)
 * @param identidad  { texto, lid, telefono }
 * @returns true si el DM es un mensaje de la propia Sofi. Nunca lanza.
 */
self.esEcoDeSofi = async function esEcoDeSofi(org, { texto, lid = null, telefono = null, ahora = new Date() } = {}) {
  try {
    const oficial = numeroOficial(org);
    if (oficial && telefono && soloDigitos(telefono) === oficial) return true;
    if (lid && lidsPropios.has(String(lid))) return true;
    const t = String(texto || "");
    if (t.length < LARGO_MINIMO) return false;
    if (!(await mensajeRecienteDeSofi(t, ahora))) return false;
    if (lid) lidsPropios.add(String(lid));
    return true;
  } catch (e) {
    console.warn("[eco-sofi] no se pudo verificar, sigue como colega:", e.message);
    return false;
  }
};

// Solo para tests.
self._reset = () => lidsPropios.clear();
self.HORAS_ATRAS = HORAS_ATRAS;
self.LARGO_MINIMO = LARGO_MINIMO;

module.exports = self;

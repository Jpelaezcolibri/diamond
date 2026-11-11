// Líneas del radar que SOLO ESCUCHAN (Juan, 2026-11-11): "actívalos desde la
// línea de Natalia, que Sofi tome el requerimiento y que conteste desde la
// línea de Sofi o de Daiana directamente al interno del colega, sin necesidad
// de responder desde la línea de Natalia".
//
// Una línea en RADAR_SESIONES_SOLO_ESCUCHA (lista separada por comas, p. ej.
// "RADA-NATALIA") alimenta el radar con los pedidos de sus grupos, pero nunca
// escribe: ni en grupos ni al privado. Lo que el radar le quiera mandar al
// colega sale por RADAR_SESION_SALIDA (p. ej. "DaianaDiamond"). Sin línea de
// salida no se adivina: no sale nada y el flujo cae al aviso a la asesora,
// como cualquier DM que no salió.
//
// Para el resto del sistema (que asume UNA sola línea activa: aprobación
// manual, DM desde el CRM, ventana de la asesora, publicador) una línea que
// solo escucha no cuenta como "activa": whatsapp-groups.listSessions la
// devuelve con estado "escucha".

function lista() {
  return String(process.env.RADAR_SESIONES_SOLO_ESCUCHA || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function esSoloEscucha(nombre) {
  return Boolean(nombre) && lista().includes(String(nombre).trim());
}

// La sesión por la que de verdad sale un envío pedido desde `nombre`.
// null = no hay por dónde (la línea solo escucha y no hay salida válida).
function sesionDeSalida(nombre) {
  if (!esSoloEscucha(nombre)) return nombre;
  const salida = String(process.env.RADAR_SESION_SALIDA || "").trim();
  if (!salida || esSoloEscucha(salida)) return null;
  return salida;
}

// Vista de una fila de whatsapp_sessions para el resto del sistema.
function vistaDeSesion(s) {
  if (!s || s.estado !== "activa" || !esSoloEscucha(s.nombre)) return s;
  return { ...s, estado: "escucha", soloEscucha: true };
}

module.exports = { esSoloEscucha, sesionDeSalida, vistaDeSesion };

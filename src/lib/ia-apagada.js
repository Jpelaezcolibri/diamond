// IA APAGADA (Juan, 2026-11-18): "apaga todo lo que tenga que ver con la api
// de este proyecto... no quiero invertir mas en este proyecto".
//
// Con IA_APAGADA=true ninguna pieza del bot llama a Claude:
//   - Sofi (engine.js) contesta un texto fijo la primera vez y pasa el chat a
//     una asesora (modo humano). Los mensajes siguientes quedan en el CRM.
//   - El radar de grupos no clasifica (whatsapp-group.js lo corta antes).
//   - Sofi en la linea del radar, el clasificador de DM, los seguimientos y
//     Sofi comando quedan apagados.
//   - getClient() lanza: es la red de seguridad para cualquier camino que se
//     haya escapado (scripts, importar-export, revalidar).
// Lo que no usa IA sigue igual: webhook, CRM, citas, publicador de grupos,
// recordatorios por plantilla, sync de Wasi.

const VALORES_ENCENDIDO = new Set(["1", "true", "si", "sí", "yes", "on"]);

function iaApagada() {
  return VALORES_ENCENDIDO.has(String(process.env.IA_APAGADA ?? "").trim().toLowerCase());
}

// Tuteo y sin nombres de asesoras (regla de identidad publica).
const RESPUESTA_FIJA =
  "¡Hola! Gracias por escribir a Diamond Inmobiliaria. Un asesor de nuestro equipo te responde por este mismo chat en breve.";

class IaApagadaError extends Error {
  constructor() {
    super("IA apagada (IA_APAGADA=true): no se llama a la API");
    this.name = "IaApagadaError";
  }
}

module.exports = { iaApagada, RESPUESTA_FIJA, IaApagadaError };

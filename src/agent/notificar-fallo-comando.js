// Aviso a Juan por WhatsApp cuando Sofi-Comando confirma algo que no ejecuto
// de verdad, o cuando una herramienta mutante devuelve un fallo real. Best
// effort a proposito: un fallo notificando NUNCA puede tumbar la respuesta
// del chat (quien llama a esto ya lo hace con .catch()).
//
// Reusa RADAR_WATCHDOG_TO -- el mismo canal que ya usan src/lib/mensaje-asesor.js
// y src/scheduler/radar-watchdog.js. Sin variable de entorno nueva.
const organizations = require("../data/organizations");
const canalWhatsapp = require("../channels/whatsapp");

function destinos() {
  return (process.env.RADAR_WATCHDOG_TO || "")
    .split(",").map((t) => t.trim()).filter(Boolean)
    .slice(0, 5); // tope defensivo: un CSV mal pegado no debe abrir un spam masivo
}

function recorte(s, n) {
  const str = String(s || "");
  return str.length > n ? `${str.slice(0, n)}...` : str;
}

function textoSinConfirmar({ userName, textoUsuario, reply }) {
  return [
    "⚠️ Sofi-Comando: posible acción no confirmada",
    "",
    `Quien: ${userName || "sin nombre"}`,
    `Pidió: "${recorte(textoUsuario, 200)}"`,
    `Sofi contestó (sin llamar ninguna herramienta real):`,
    `"${recorte(reply, 300)}"`,
    "",
    "Revisá si esto se ejecutó de verdad.",
  ].join("\n");
}

function textoFallo({ userName, fallos }) {
  const detalle = fallos.map((f) => `- ${f.nombre}: ${recorte(f.resultado, 200)}`).join("\n");
  return [
    "⚠️ Sofi-Comando: fallo real de herramienta",
    "",
    `Quien: ${userName || "sin nombre"}`,
    detalle,
  ].join("\n");
}

async function notificarFalloComando(scope, { userName, textoUsuario, reply, auditoria }) {
  const to = destinos();
  if (to.length === 0) return;

  const org = await organizations.findById(scope.orgId);
  if (!org) return;

  const mensajes = [];
  if (auditoria.sinConfirmar) mensajes.push(textoSinConfirmar({ userName, textoUsuario, reply }));
  if (auditoria.fallos.length > 0) mensajes.push(textoFallo({ userName, fallos: auditoria.fallos }));

  for (const texto of mensajes) {
    for (const destino of to) {
      await canalWhatsapp.sendWhatsApp(org, destino, texto).catch((e) =>
        console.warn(`[sofi-comando] no se pudo notificar a ${destino}:`, e?.message || e)
      );
    }
  }
}

module.exports = { notificarFalloComando, textoSinConfirmar, textoFallo };

// Aviso de saldo/tope de Anthropic por un canal que NO es la linea de la
// asesora (2026-10-07). Del 25-sep al 7-oct la cuenta se quedo sin saldo:
// Sofi y el radar callaron 12 dias y nadie se entero, porque el vigilante
// avisa a RADAR_WATCHDOG_TO (el numero de Daiana) y ASESORA_SOLO_VISITAS lo
// apaga. Este aviso va a ALERTA_TECNICA_TO (Juan) y no lo apaga nada.
//
// Por WhatsApp oficial (no depende de Anthropic). Si la ventana de 24 h con
// ese numero esta cerrada, sale la plantilla `alerta_tecnica`. Enfriamiento
// de 6 h (ALERTA_SALDO_CADA_MIN) para no repetir en cada mensaje fallido.

const PATRON = /credit balance is too low|specified API usage limits/i;
const CADA_MIN = Number(process.env.ALERTA_SALDO_CADA_MIN || 360);
let ultimoAviso = 0;

function esErrorDeSaldo(err) {
  if (!err) return false;
  const texto = [err.message, err.error && err.error.error && err.error.error.message].filter(Boolean).join(" ");
  return PATRON.test(texto);
}

function destinos() {
  return String(process.env.ALERTA_TECNICA_TO || "").split(",").map((t) => t.replace(/\D/g, "")).filter(Boolean);
}

async function enviarPorWhatsapp(texto) {
  const lista = destinos();
  if (lista.length === 0) {
    console.error(`[alerta-saldo] ALERTA_TECNICA_TO vacio. ${texto}`);
    return false;
  }
  // Requires tardios: whatsapp.js arrastra engine.js, que usa anthropic.js.
  const canal = require("../channels/whatsapp");
  const organizations = require("../data/organizations");
  const org = await organizations.getDefault();
  let alguno = false;
  for (const to of lista) {
    let r = await canal.sendWhatsApp(org, to, texto).catch((e) => ({ ok: false, error: e.message }));
    if (!r || !r.ok) {
      r = await canal
        .sendWhatsAppTemplate(org, to, { name: "alerta_tecnica", bodyParams: ["Anthropic sin saldo o con tope de gasto: Sofi y el radar no responden."] })
        .catch((e) => ({ ok: false, error: e.message }));
    }
    if (r && r.ok) alguno = true;
    else console.error(`[alerta-saldo] NO se pudo avisar a ${to}: ${r && r.error}`);
  }
  return alguno;
}

async function observarError(err, { ahora = new Date(), enviar = enviarPorWhatsapp } = {}) {
  if (!esErrorDeSaldo(err)) return false;
  if (ultimoAviso && ahora.getTime() - ultimoAviso < CADA_MIN * 60 * 1000) return false;
  ultimoAviso = ahora.getTime();
  const texto =
    "🚨 Anthropic sin saldo o con tope de gasto: Sofi y el radar no están respondiendo. " +
    "Recargá en console.anthropic.com → Plans & Billing. Detalle: " +
    String(err.message || "").slice(0, 160);
  console.error(`[alerta-saldo] ${texto}`);
  return enviar(texto).catch((e) => {
    console.error("[alerta-saldo] fallo el envio:", e.message);
    return false;
  });
}

function _reset() {
  ultimoAviso = 0;
}

module.exports = { esErrorDeSaldo, observarError, _reset };

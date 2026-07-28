// Canal de ESCUCHA de los grupos gremiales de WhatsApp (Fase 1, modo sombra).
//
// Recibe los webhooks de WAHA, que corre como dispositivo vinculado a la linea
// de un asesor — el mismo mecanismo que WhatsApp Web.
//
// ═══ ESTE MODULO NO PUEDE ENVIAR MENSAJES ═══
//
// No exporta ninguna funcion de envio, y no es un flag apagado que alguien
// pueda prender con prisa a las once de la noche: la funcion no existe. Es la
// diferencia entre una puerta cerrada con llave y una pared, y es lo que
// mantiene el riesgo de baneo de la linea del asesor en cero. Hay un test que
// lo verifica.
//
// ═══ LAS CUATRO INVARIANTES DE PRIVACIDAD ═══
//
// Un dispositivo vinculado recibe TODOS los chats del asesor, no solo los
// grupos: es inherente al protocolo, no hay forma de pedirle otra cosa a
// WhatsApp. Sus mensajes privados VAN a llegar a este endpoint. La unica
// defensa honesta es arquitectonica, y son estas cuatro:
//
//   1. Se descarta cualquier chat que no termine en @g.us, en la primera
//      linea, antes de cualquier log, consulta o escritura.
//   2. Se descarta cualquier grupo que no este en la lista blanca con modo
//      distinto de 'ignorar'.
//   3. Este modulo no exporta ninguna funcion de envio.
//   4. Lo que no es senal no se persiste (el ruido muere en el buffer).
//
// Cada una tiene su test. Si se rompe una, se rompe el trato con el asesor.

const express = require("express");
const config = require("../config");
const organizations = require("../data/organizations");
const whatsappGroups = require("../data/whatsapp-groups");
const { motivoDescarte } = require("../groups/prefilter");
const buffer = require("../groups/buffer");

const router = express.Router();

// Dedup en memoria contra reenvios de WAHA y contra el mismo mensaje visto por
// dos sesiones distintas. El indice unico de group_signals es la red de
// seguridad definitiva; esto evita pagar la IA dos veces por lo mismo.
const vistos = new Map(); // waMessageId -> timestamp
const VISTOS_TTL_MS = 30 * 60 * 1000;
const VISTOS_MAX = 5000;

function yaVisto(id) {
  const ahora = Date.now();
  if (vistos.size > VISTOS_MAX) {
    for (const [k, t] of vistos) if (ahora - t > VISTOS_TTL_MS) vistos.delete(k);
  }
  const t = vistos.get(id);
  if (t && ahora - t < VISTOS_TTL_MS) return true;
  vistos.set(id, ahora);
  return false;
}

// El secreto lo configura WAHA como header propio en el webhook (ver
// docs/grupos-waha.md). Sin secreto configurado el endpoint no se monta.
function autorizado(req) {
  const enviado = req.headers["x-api-key"] || req.headers["x-webhook-secret"];
  return Boolean(config.groups.webhookSecret) && enviado === config.groups.webhookSecret;
}

// Extrae lo que necesitamos del payload de WAHA. Para un mensaje de grupo,
// `from` es el JID del grupo y `participant` es quien lo escribio; en un chat
// 1-a-1 `participant` no viene. Ver https://waha.devlike.pro/docs/how-to/receive-messages/
function normalizar(body) {
  const p = body?.payload || {};
  return {
    sesion: body?.session || null,
    waMessageId: p.id || null,
    chatId: p.from || null,
    autorId: p.participant || p.author || null,
    autorNombre: p._data?.notifyName || p.notifyName || null,
    texto: typeof p.body === "string" ? p.body : "",
    fromMe: Boolean(p.fromMe),
    tieneMedia: Boolean(p.hasMedia),
  };
}

const esGrupo = (chatId) => typeof chatId === "string" && chatId.endsWith("@g.us");
const soloDigitos = (jid) => String(jid || "").replace(/\D/g, "") || null;

router.post("/webhook/grupos", async (req, res) => {
  // Siempre 200: WAHA reintenta ante un error, y un reintento infinito por un
  // mensaje que igual ibamos a descartar no le sirve a nadie.
  if (!autorizado(req)) return res.status(401).json({ ok: false });

  const ev = normalizar(req.body);

  // ── INVARIANTE 1 ─────────────────────────────────────────────────────
  // Todo lo que no sea un mensaje de grupo se descarta ACA, antes de
  // cualquier log, consulta o escritura. Los chats privados del asesor no
  // llegan a existir en ningun lado de este sistema.
  if (req.body?.event !== "message" || !esGrupo(ev.chatId) || !ev.waMessageId) {
    return res.json({ ok: true });
  }

  try {
    const org = await organizations.getDefault();

    // ── INVARIANTE 2 ───────────────────────────────────────────────────
    // Lista blanca. Un grupo nuevo nace en modo 'ignorar' y no procesa nada
    // hasta que alguien lo prende a mano en el CRM. Registrarlo guarda solo
    // el JID y el nombre del grupo — nunca el contenido.
    const blanca = await whatsappGroups.whitelist(org.id);
    const grupo = blanca.get(ev.chatId);
    if (!grupo) {
      await whatsappGroups.registrarGrupo(org.id, { jid: ev.chatId }).catch(() => {});
      return res.json({ ok: true });
    }

    // Lo que escribe el propio asesor no es senal del gremio.
    if (ev.fromMe) return res.json({ ok: true });
    if (yaVisto(ev.waMessageId)) return res.json({ ok: true });

    buffer.contar("recibidos");

    // Etapa 0: descarte gratis. El texto de lo descartado no se guarda ni se
    // registra en logs — muere aca.
    const mensaje = {
      id: ev.waMessageId,
      grupo: grupo.nombre || ev.chatId,
      groupId: grupo.id,
      autor: ev.autorNombre,
      autorTelefono: soloDigitos(ev.autorId),
      texto: ev.texto,
      waMessageId: ev.waMessageId,
      esSistema: false,
      esMultimedia: ev.tieneMedia,
    };
    if (motivoDescarte(mensaje) !== null) {
      buffer.contar("prefiltrados");
      return res.json({ ok: true });
    }

    buffer.push(org, mensaje);
    whatsappGroups.touchSession(org.id, ev.sesion).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    // Nunca se registra el contenido del mensaje en el log de error.
    console.error("[grupos] webhook:", e.message);
    return res.json({ ok: true });
  }
});

// Salud del canal, para el detector de humo.
router.get("/webhook/grupos/estado", (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ ok: false });
  res.json({ ok: true, ...buffer.estado() });
});

// ⚠️ El modulo exporta el router y NADA MAS. No hay funcion de envio: ver el
// encabezado y test/group-canal.test.js.
module.exports = router;
module.exports._normalizar = normalizar;
module.exports._esGrupo = esGrupo;
module.exports._yaVisto = yaVisto;

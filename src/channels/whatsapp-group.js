// Canal de escucha de los grupos gremiales y unica puerta de entrada del radar
// en vivo.
//
// Recibe los webhooks de WAHA, que corre como dispositivo vinculado a una linea
// dedicada de la empresa — el mismo mecanismo que WhatsApp Web.
//
// ═══ SOBRE EL ENVIO (cambio deliberado del 2026-08-16) ═══
//
// Este modulo ya no es solo-lectura: puede publicar respuestas dentro de los
// grupos habilitados. Conviene tener presente por que la vieja garantia no era
// la que protegia: el montaje anterior SOLO LEIA y aun asi la cuenta fue
// baneada el 2026-07-30. Lo que WhatsApp sanciona es el cliente no autorizado,
// no la conducta.
//
// Lo que sustituye a esa garantia:
//   · La linea vinculada es secundaria y sacrificable. Nunca la de Sofi (esta
//     en Cloud API oficial), nunca la de un asesor con clientes.
//   · El envio sale por UNA sola funcion, waha.enviarTexto, y este modulo no
//     define ninguna propia.
//   · QUE se dice lo decide src/groups/publicable.js; SI se dice lo decide
//     src/groups/politica.js. Aca no hay reglas de negocio.
//
// ═══ LAS INVARIANTES DE PRIVACIDAD ═══
//
// Un dispositivo vinculado recibe TODOS los chats de la linea, no solo los
// grupos: es inherente al protocolo, no hay forma de pedirle otra cosa a
// WhatsApp. La unica defensa honesta es arquitectonica:
//
//   1. Se descarta cualquier chat que no termine en @g.us, en la primera linea,
//      antes de cualquier log, consulta o escritura.
//   2. Se descarta cualquier grupo que no este en la lista blanca.
//   3. Solo se publica en grupos con permiso explicito (`responde`), que es un
//      permiso distinto del de escuchar y arranca apagado.
//   4. Lo que no es senal no se persiste: el ruido muere en memoria.
//
// Cada una tiene su test.

const express = require("express");
const config = require("../config");
const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
const whatsappGroups = require("../data/whatsapp-groups");
const { motivoDescarte } = require("../groups/prefilter");
const { huella } = require("../../epe/core/hash");
const { enqueue } = require("../lib/user-queue");
const vivo = require("../groups/vivo");
const waha = require("../lib/waha");

const router = express.Router();

// Modo del radar en vivo. 'sombra' redacta y registra sin publicar; 'auto'
// publica. Cualquier otro valor (o la variable sin definir) apaga la respuesta:
// falla cerrada, un typo no puede encender el envio por accidente.
const MODO = () => process.env.GRUPOS_RESPUESTA_MODO || "sombra";

// Espaciado entre dos publicaciones seguidas en el MISMO grupo.
//
// No es un tope y no descarta nada: si entran veinte pedidos con match, se
// responden los veinte. Lo unico que evita es dispararlos en el mismo segundo,
// que es el patron que peor se lee —tanto para un humano del grupo como para
// los sistemas de WhatsApp— y el que menos aporta.
//
// Se aplica DESPUES de publicar y dentro de la cola por grupo, asi que el
// siguiente mensaje espera su turno en vez de perderse. Poner 0 lo desactiva.
const ESPACIADO_MS = Number(process.env.GRUPOS_RESPUESTA_ESPACIADO_SEG || 20) * 1000;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Contadores en memoria para el detector de humo. No guardan texto.
const metricas = {
  recibidos: 0, prefiltrados: 0, historicos: 0, difundidos: 0,
  publicados: 0, sombra: 0, callados: 0, errores: 0, desde: new Date().toISOString(),
};
function contar(k) {
  if (k in metricas) metricas[k] += 1;
}

// ── Dedup por id de mensaje ──────────────────────────────────────────────
// Contra reenvios de WAHA y contra el mismo mensaje visto por dos sesiones.
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

// ── Dedup por CONTENIDO ──────────────────────────────────────────────────
//
// Los colegas difunden el mismo aviso a diez grupos a la vez, y la linea esta
// en varios. Medido en produccion el 2026-07-29: de 494 senales, 312 eran
// repeticiones, y 108 de los 111 textos repetidos venian de grupos distintos.
//
// El dedup por id no lo ataja —cada copia trae un waMessageId propio— y sin
// esto el radar contestaria diez veces el mismo pedido, en diez grupos. Es
// exactamente la conducta que hace que a uno lo saquen del gremio.
const difundidos = new Map(); // huella -> timestamp
const DIFUNDIDOS_TTL_MS = Number(process.env.GROUPS_DEDUP_HORAS || 6) * 3600 * 1000;
const DIFUNDIDOS_MAX = 5000;

async function yaDifundido(mensaje) {
  const h = await huella(mensaje);
  const ahora = Date.now();
  if (difundidos.size > DIFUNDIDOS_MAX) {
    for (const [k, t] of difundidos) if (ahora - t > DIFUNDIDOS_TTL_MS) difundidos.delete(k);
  }
  const t = difundidos.get(h);
  if (t && ahora - t < DIFUNDIDOS_TTL_MS) return true;
  difundidos.set(h, ahora);
  return false;
}

// El secreto lo configura WAHA como header propio en el webhook. Sin secreto
// configurado el endpoint no se monta (ver src/server.js).
function autorizado(req) {
  const enviado = req.headers["x-api-key"] || req.headers["x-webhook-secret"];
  return Boolean(config.groups.webhookSecret) && enviado === config.groups.webhookSecret;
}

// Para un mensaje de grupo, `from` es el JID del grupo y `participant` es quien
// lo escribio. El nombre del colega viaja en una clave distinta segun el motor:
// WEBJS usa notifyName, NOWEB tiende a pushName, y a veces va anidado en _data.
function nombreDelAutor(p) {
  return (
    p._data?.notifyName || p.notifyName ||
    p._data?.pushName || p.pushName ||
    p.participantName || p._data?.verifiedBizName || null
  );
}

// Se registra UNA vez por proceso: si el nombre no aparece, deja las CLAVES del
// payload en el log. Nunca los valores — el contenido es de terceros.
let avisadoSinAutor = false;

function normalizar(body) {
  const p = body?.payload || {};
  const autorNombre = nombreDelAutor(p);
  if (!autorNombre && p.id && !avisadoSinAutor) {
    avisadoSinAutor = true;
    console.warn(
      "[grupos] El mensaje no trae nombre del autor. Claves del payload:",
      Object.keys(p).join(", "),
      "| _data:", Object.keys(p._data || {}).join(", ") || "(sin _data)"
    );
  }
  return {
    sesion: body?.session || null,
    waMessageId: p.id || null,
    chatId: p.from || null,
    autorId: p.participant || p.author || null,
    autorNombre,
    texto: typeof p.body === "string" ? p.body : "",
    fromMe: Boolean(p.fromMe),
    tieneMedia: Boolean(p.hasMedia),
    // WAHA manda segundos epoch. Sin fecha NO se asume "ahora": se asume
    // sospechoso y se descarta (ver esAnteriorAlCorte).
    tsMs: typeof p.timestamp === "number" ? p.timestamp * 1000 : null,
  };
}

// CORTE TEMPORAL. Al vincular un dispositivo, WhatsApp puede sincronizar
// historial. Ofrecer en un grupo gremial una propiedad publicada hace tres
// meses —que casi seguro ya se vendio— es dano de reputacion, no un bug menor.
//
// Se exige que el mensaje sea posterior AL MAS TARDIO de los dos cortes: el de
// la sesion y el del grupo. Prender hoy un grupo no puede arrastrar lo de la
// semana pasada. Un mensaje sin fecha se descarta: si no se puede probar que es
// de hoy, no entra.
function esAnteriorAlCorte(tsMs, sesion, grupo) {
  if (typeof tsMs !== "number") return true;
  const cortes = [sesion?.escucha_desde, grupo?.escuchaDesde]
    .filter(Boolean)
    .map((iso) => new Date(iso).getTime())
    .filter((n) => !Number.isNaN(n));
  if (cortes.length === 0) return false; // sin corte configurado, no se filtra
  return tsMs < Math.max(...cortes);
}

const esGrupo = (chatId) => typeof chatId === "string" && chatId.endsWith("@g.us");
const soloDigitos = (jid) => String(jid || "").replace(/\D/g, "") || null;

// Procesa el mensaje despues de haber respondido 200. WAHA reintenta si el
// webhook tarda, y clasificar + cruzar + publicar no cabe en ese plazo.
async function procesar(org, ev, grupo, sesion) {
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

  // Etapa 0 antes de cualquier gasto: el texto de lo descartado no se guarda ni
  // se registra en logs, muere aca.
  if (motivoDescarte(mensaje) !== null) return contar("prefiltrados");
  if (await yaDifundido(mensaje)) return contar("difundidos");

  contar("recibidos");

  const asesor = await advisors.findForTransfer(org, "venta").catch(() => null);

  const r = await vivo.procesarMensaje(org, mensaje, {
    grupo,
    modo: MODO(),
    asesor,
    advisorId: sesion?.advisor_id || null,
    // La UNICA via de salida. Se ata aca, al grupo del que vino el mensaje: el
    // radar no tiene forma de escribirle a otro chat.
    enviar: (texto) => waha.enviarTexto(ev.sesion, ev.chatId, texto),
  });

  if (r.resultado === "publicado") contar("publicados");
  else if (r.resultado === "sombra") contar("sombra");
  else if (r.resultado === "error_envio") contar("errores");
  else if (r.resultado === "callado") contar("callados");

  // Solo despues de haber publicado de verdad. Como esto corre dentro de la cola
  // del grupo, el pedido que venga atras espera y se responde igual: se demora,
  // no se pierde.
  if (r.resultado === "publicado" && ESPACIADO_MS > 0) await dormir(ESPACIADO_MS);
  return r;
}

router.post("/webhook/grupos", async (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ ok: false });

  const ev = normalizar(req.body);

  // ── INVARIANTE 1 ─────────────────────────────────────────────────────
  // Todo lo que no sea un mensaje de grupo se descarta ACA, antes de cualquier
  // log, consulta o escritura. Los chats privados de esa linea no llegan a
  // existir en ningun lado de este sistema.
  if (req.body?.event !== "message" || !esGrupo(ev.chatId) || !ev.waMessageId) {
    return res.json({ ok: true });
  }

  try {
    const org = await organizations.getDefault();

    // ── INVARIANTE 2 ───────────────────────────────────────────────────
    // Lista blanca. Un grupo nuevo nace apagado y no procesa nada hasta que
    // alguien lo prende a mano. Registrarlo guarda solo el jid y el nombre.
    const blanca = await whatsappGroups.whitelist(org.id);
    const grupo = blanca.get(ev.chatId);
    if (!grupo) {
      await whatsappGroups.registrarGrupo(org.id, { jid: ev.chatId }).catch(() => {});
      return res.json({ ok: true });
    }

    // Lo que escribe la propia linea no es senal del gremio — y evita que el
    // radar se conteste a si mismo.
    if (ev.fromMe) return res.json({ ok: true });

    const sesion = await whatsappGroups.sesionPorNombre(org.id, ev.sesion);
    if (esAnteriorAlCorte(ev.tsMs, sesion, grupo)) {
      contar("historicos");
      return res.json({ ok: true });
    }

    if (yaVisto(ev.waMessageId)) return res.json({ ok: true });

    // Se responde YA y se procesa despues, encolado por grupo: dos pedidos que
    // entran juntos no pueden dispararse en paralelo y saltarse el cooldown.
    res.json({ ok: true });
    enqueue(`grupo:${grupo.id}`, () =>
      procesar(org, ev, grupo, sesion).catch((e) => {
        contar("errores");
        // Nunca se registra el contenido del mensaje en el log de error.
        console.error("[grupos] procesando:", e.message);
      })
    );
    whatsappGroups.touchSession(org.id, ev.sesion).catch(() => {});
    return;
  } catch (e) {
    console.error("[grupos] webhook:", e.message);
    if (!res.headersSent) res.json({ ok: true });
    return;
  }
});

// Salud del canal, para el detector de humo.
router.get("/webhook/grupos/estado", (req, res) => {
  if (!autorizado(req)) return res.status(401).json({ ok: false });
  res.json({ ok: true, modo: MODO(), metricas });
});

module.exports = router;
module.exports._normalizar = normalizar;
module.exports._esGrupo = esGrupo;
module.exports._yaVisto = yaVisto;
module.exports._esAnteriorAlCorte = esAnteriorAlCorte;
module.exports._metricas = metricas;

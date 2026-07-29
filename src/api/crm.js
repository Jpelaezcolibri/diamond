// API interna para el CRM (crm/ en Vercel). Protegida con BOT_API_KEY.
// Requiere Supabase: el CRM y el bot comparten la misma base de datos.
const express = require("express");
const multer = require("multer");
const config = require("../config");
const supabase = require("../data/supabase");
const conversations = require("../data/conversations");
const { sendWhatsApp, uploadMediaToMeta, sendWhatsAppMedia } = require("../channels/whatsapp");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

router.use("/api", (req, res, next) => {
  if (!config.botApiKey || req.headers["x-api-key"] !== config.botApiKey) {
    return res.status(401).json({ error: "API key invalida" });
  }
  if (!supabase) {
    return res.status(501).json({ error: "El CRM requiere Supabase configurado en el bot" });
  }
  next();
});

// ── Grupos de WhatsApp (Fase 1, modo sombra) ────────────────────────────
//
// El modo de un grupo es la llave de la privacidad del asesor: define si Sofi
// lo escucha o no. Por eso pasa por aca, con la service key y autenticado,
// en vez de que el CRM escriba directo contra Supabase.
const whatsappGroups = require("../data/whatsapp-groups");
const organizations = require("../data/organizations");
const waha = require("../lib/waha");

// Vincular la linea: crea la sesion en WAHA y la registra. El corte temporal
// (escucha_desde) queda fijado en este instante — nada anterior se procesa.
router.post("/api/grupos/sesion", async (req, res) => {
  const { nombre, advisorId } = req.body || {};
  if (!nombre || !/^[a-z0-9_-]{2,40}$/i.test(nombre)) {
    return res.status(400).json({ error: "Nombre de sesion invalido (letras, numeros, guiones)" });
  }
  if (!config.groups.webhookSecret) {
    return res.status(400).json({ error: "Falta GROUPS_WEBHOOK_SECRET en el bot" });
  }
  try {
    const org = await organizations.getDefault();
    const webhookUrl = `${config.groups.publicUrl}/webhook/grupos`;
    const remota = await waha.crearSesion(nombre, { webhookUrl, webhookSecret: config.groups.webhookSecret });
    const local = await whatsappGroups.upsertSession(org.id, { nombre, advisorId: advisorId || null });
    res.json({ ok: true, sesion: local, waha: { status: remota?.status || null } });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Estado + QR en una sola llamada: es lo que la pantalla de pareo consulta en
// bucle, y el QR caduca en segundos — pedirlo aparte duplicaria el polling.
// Solo se pide el QR si la sesion realmente lo esta esperando.
router.post("/api/grupos/sesion/estado", async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "Falta el nombre de la sesion" });
  try {
    const org = await organizations.getDefault();
    const [remota, locales] = await Promise.all([
      waha.estadoSesion(nombre).catch((e) => ({ status: "ERROR", error: e.message })),
      whatsappGroups.listSessions(org.id),
    ]);
    const status = remota?.status || null;
    const qr = status === "SCAN_QR_CODE" ? await waha.qr(nombre).catch(() => null) : null;

    // Si ya quedo vinculada, se marca activa. El corte temporal NO se toca:
    // se fijo al crear la sesion y reescribirlo abriria la puerta a
    // reprocesar historial.
    if (status === "WORKING") await whatsappGroups.upsertSession(org.id, { nombre, estado: "activa" });

    res.json({
      ok: true,
      status,
      qr,
      error: remota?.error || null,
      sesion: locales.find((s) => s.nombre === nombre) || null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Volver a parear desde cero: descarta las credenciales guardadas y pide un QR
// nuevo. Es la salida cuando WhatsApp deja de aceptar el dispositivo vinculado
// —la sesion queda en FAILED y reiniciarla no sirve, porque reintenta con las
// mismas credenciales rechazadas.
//
// Mueve tambien el corte temporal a este instante: al vincular un dispositivo
// nuevo WhatsApp le resincroniza historial, y esos mensajes viejos no se
// procesan.
router.post("/api/grupos/sesion/revincular", async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "Falta el nombre de la sesion" });
  try {
    const org = await organizations.getDefault();
    const remota = await waha.revincular(nombre);
    const local = await whatsappGroups.upsertSession(org.id, { nombre, estado: "pendiente", reiniciarCorte: true });
    console.warn(`[grupos] ${nombre} re-vinculada: credenciales descartadas, corte movido a ${local.escucha_desde}`);
    res.json({ ok: true, status: remota?.status || null, sesion: local });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Importa de una todos los grupos de la linea, en vez de esperar a que llegue
// un mensaje en cada uno. Nacen TODOS en 'ignorar': importarlos no es
// escucharlos.
router.post("/api/grupos/importar", async (req, res) => {
  const { sesion } = req.body || {};
  if (!sesion) return res.status(400).json({ error: "Falta el nombre de la sesion" });
  try {
    const org = await organizations.getDefault();
    let grupos = await waha.listarGrupos(sesion);

    // Si WAHA no devuelve nada, los grupos que YA conocemos igual necesitan
    // nombre. Los descubre el webhook con cada mensaje, pero de ahi solo sale
    // el jid: quedan decenas de "Grupo sin nombre", y sin nombre el asesor no
    // sabe a que grupo ir a responder. Se les pregunta el nombre de a uno,
    // que no depende del store vacio del motor.
    if (grupos.length === 0) {
      const conocidos = (await whatsappGroups.listGroups(org.id)).filter((g) => !g.nombre);
      if (conocidos.length > 0) {
        console.warn(`[grupos] WAHA no listo ningun grupo; resolviendo el nombre de ${conocidos.length} ya conocidos.`);
        const mapa = await waha.nombresPorJid(sesion, conocidos.map((g) => g.jid));
        grupos = [...mapa].map(([jid, nombre]) => ({ jid, nombre }));
        console.log(`[grupos] nombres resueltos: ${grupos.length} de ${conocidos.length}`);
      }
    }

    const r = await whatsappGroups.importarGrupos(org.id, grupos);
    const conNombre = grupos.filter((g) => g.nombre).length;
    console.log(`[grupos] importados ${r.nuevos} nuevos de ${r.total} (${conNombre} con nombre) en la sesion ${sesion}`);
    res.json({ ok: true, ...r, conNombre });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Metricas en vivo del embudo. Viven en memoria del bot (no en la base), asi
// que el CRM tiene que preguntarlas. Se exponen aca —con BOT_API_KEY— para que
// mirarlas no obligue a abrir una terminal.
router.post("/api/grupos/metricas", (req, res) => {
  res.json({ ok: true, ...require("../groups/buffer").estado() });
});

// Marcar una senal como revisada (o descartada, o de vuelta a pendiente).
//
// Con volumen alto —el 2026-07-29 entraron ~980 senales en un dia— sin una
// marca de "ya lo mire" el asesor relee los mismos pedidos todos los dias y
// los nuevos se pierden entre ellos. NO borra nada: solo cambia el estado.
router.post("/api/grupos/senal/estado", async (req, res) => {
  const { id, estado } = req.body || {};
  if (!id) return res.status(400).json({ error: "Falta el id de la senal" });
  if (!["nuevo", "gestionado", "descartado"].includes(estado)) {
    return res.status(400).json({ error: "Estado invalido. Use: nuevo, gestionado, descartado" });
  }
  try {
    const org = await organizations.getDefault();
    const senal = await require("../data/group-signals").setEstado(org.id, id, estado);
    if (!senal) return res.status(404).json({ error: "Senal no encontrada" });
    res.json({ ok: true, senal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/api/grupos/:id/modo", async (req, res) => {
  const { modo } = req.body || {};
  if (!whatsappGroups.MODOS.includes(modo)) {
    return res.status(400).json({ error: `Modo invalido. Use: ${whatsappGroups.MODOS.join(", ")}` });
  }
  try {
    const org = await organizations.getDefault();
    const grupo = await whatsappGroups.setModo(org.id, req.params.id, modo);
    console.log(`[grupos] ${grupo.nombre || grupo.jid} -> ${modo}`);
    res.json({ ok: true, grupo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function getConversation(id) {
  const { data, error } = await supabase
    .from("conversations")
    .select("*, leads(*), organizations:org_id(*)")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

// wamid del mensaje citado (si aplica)
async function contextWaIdFor(replyToId) {
  if (!replyToId) return null;
  const { data } = await supabase
    .from("messages").select("wa_message_id").eq("id", replyToId).maybeSingle();
  return data?.wa_message_id || null;
}

// Envio manual de texto desde el CRM (con cita opcional)
router.post("/api/conversations/:id/send", async (req, res) => {
  try {
    const { text, replyToId } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "Falta 'text'" });

    const conv = await getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversacion no encontrada" });

    const contextWaId = await contextWaIdFor(replyToId);
    const { ok, wamid, error } = await sendWhatsApp(conv.organizations, conv.leads.phone, text.trim(), {
      contextWaId,
      fromPhoneId: conv.whatsapp_phone_id,
    });
    const msg = await conversations.appendMessage(conv.id, "assistant", text.trim(), {
      wa_message_id: wamid,
      reply_to_id: replyToId || null,
    });
    await conversations.setDelivery(msg.id, ok ? "sent" : "failed", error);
    await supabase
      .from("conversations")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", conv.id);

    res.json({ ok: true, delivery: ok ? "sent" : "failed" });
  } catch (e) {
    console.error("[api] Error en send:", e);
    res.status(500).json({ error: e.message });
  }
});

// Envio de media desde el CRM: imagen, audio (nota de voz) o documento
router.post("/api/conversations/:id/media", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Falta el archivo" });
    const conv = await getConversation(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversacion no encontrada" });

    const mime = req.file.mimetype;
    const waType = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "document";
    const caption = (req.body?.caption || "").trim();
    const contextWaId = await contextWaIdFor(req.body?.replyToId);

    // 1. Subir a Meta y enviar al cliente
    const mediaId = await uploadMediaToMeta(conv.organizations, req.file.buffer, mime, req.file.originalname, conv.whatsapp_phone_id);
    const wamid = await sendWhatsAppMedia(conv.organizations, conv.leads.phone, {
      type: waType,
      mediaId,
      caption,
      contextWaId,
      filename: req.file.originalname,
      fromPhoneId: conv.whatsapp_phone_id,
    });

    // 2. Persistir en Storage para verlo en el CRM
    const ext = (mime.split("/")[1] || "bin").split(";")[0];
    const path = `out/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upError } = await supabase.storage.from("media").upload(path, req.file.buffer, {
      contentType: mime,
      upsert: true,
    });
    if (upError) throw upError;
    const { data: pub } = supabase.storage.from("media").getPublicUrl(path);

    await conversations.appendMessage(
      conv.id,
      "assistant",
      caption || (waType === "image" ? "[Imagen]" : waType === "audio" ? "[Nota de voz]" : `[Documento] ${req.file.originalname}`),
      {
        type: waType,
        media_url: pub.publicUrl,
        media_mime: mime,
        wa_message_id: wamid,
        reply_to_id: req.body?.replyToId || null,
      }
    );
    await supabase
      .from("conversations")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", conv.id);

    res.json({ ok: true });
  } catch (e) {
    console.error("[api] Error en media:", e);
    res.status(500).json({ error: e.message });
  }
});

// Tomar control (humano) o devolverselo a Sofi (bot)
router.post("/api/conversations/:id/modo", async (req, res) => {
  try {
    const { modo } = req.body || {};
    if (!["bot", "humano"].includes(modo)) {
      return res.status(400).json({ error: "modo debe ser 'bot' o 'humano'" });
    }
    const conv = await conversations.setModo(req.params.id, modo);
    res.json({ ok: true, modo: conv.modo });
  } catch (e) {
    console.error("[api] Error en modo:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

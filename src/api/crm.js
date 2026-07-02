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
    const wamid = await sendWhatsApp(conv.organizations, conv.leads.phone, text.trim(), { contextWaId });
    await conversations.appendMessage(conv.id, "assistant", text.trim(), {
      wa_message_id: wamid,
      reply_to_id: replyToId || null,
    });
    await supabase
      .from("conversations")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", conv.id);

    res.json({ ok: true });
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
    const mediaId = await uploadMediaToMeta(conv.organizations, req.file.buffer, mime, req.file.originalname);
    const wamid = await sendWhatsAppMedia(conv.organizations, conv.leads.phone, {
      type: waType,
      mediaId,
      caption,
      contextWaId,
      filename: req.file.originalname,
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

// API interna para el CRM (crm/ en Vercel). Protegida con BOT_API_KEY.
// Requiere Supabase: el CRM y el bot comparten la misma base de datos.
const express = require("express");
const config = require("../config");
const supabase = require("../data/supabase");
const conversations = require("../data/conversations");
const { sendWhatsApp } = require("../channels/whatsapp");

const router = express.Router();

router.use("/api", (req, res, next) => {
  if (!config.botApiKey || req.headers["x-api-key"] !== config.botApiKey) {
    return res.status(401).json({ error: "API key invalida" });
  }
  if (!supabase) {
    return res.status(501).json({ error: "El CRM requiere Supabase configurado en el bot" });
  }
  next();
});

// Envio manual de un asesor desde el CRM
router.post("/api/conversations/:id/send", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "Falta 'text'" });

    const { data: conv, error } = await supabase
      .from("conversations")
      .select("*, leads(*), organizations:org_id(*)")
      .eq("id", req.params.id)
      .single();
    if (error || !conv) return res.status(404).json({ error: "Conversacion no encontrada" });

    await sendWhatsApp(conv.organizations, conv.leads.phone, text.trim());
    await conversations.appendMessage(conv.id, "assistant", text.trim());
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

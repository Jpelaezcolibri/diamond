const express = require("express");
const config = require("./config");
const whatsapp = require("./channels/whatsapp");
const telegram = require("./channels/telegram");
const organizations = require("./data/organizations");
const leads = require("./data/leads");
const conversations = require("./data/conversations");
const { procesarMensaje } = require("./agent/engine");

const app = express();
app.use(express.json());

app.use(whatsapp);
app.use(telegram);
app.use(require("./api/crm"));

app.get("/", (req, res) => {
  res.json({ ok: true, service: "bot-inmobiliario", mode: config.supabaseUrl ? "supabase" : "demo-memoria" });
});

// ── Endpoints de prueba local (sin WhatsApp ni Telegram) ─────────
app.post("/test", async (req, res) => {
  const { phone = "test_user", message } = req.body;
  if (!message) return res.status(400).json({ error: "Falta el campo 'message'" });
  try {
    const org = await organizations.getDefault();
    const { reply, lead, transfer } = await procesarMensaje({
      org,
      phone,
      text: message,
      source: "test",
    });
    res.json({ reply, lead, transfer });
  } catch (e) {
    console.error("[test] Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/test/:phone", async (req, res) => {
  try {
    const org = await organizations.getDefault();
    const lead = await leads.findOrCreate(org.id, req.params.phone, "test");
    await conversations.resetForLead(lead.id);
    await leads.update(lead.id, {
      nombre: null, presupuesto: null, zona_interes: null, tipo_interes: null,
      urgencia: null, score: 0, estado: "nuevo", property_ref_origen: null,
    });
    res.json({ ok: true, message: "Conversacion y lead reiniciados" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(config.port, () => {
  const modo = config.supabaseUrl ? "Supabase" : "DEMO en memoria (sin SUPABASE_URL)";
  console.log(`Bot inmobiliario corriendo en puerto ${config.port} — datos: ${modo}`);
});

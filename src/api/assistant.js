// API interna del Centro de Comando (Sofi-Comando), consumida por el CRM.
// Protegida con BOT_API_KEY, igual que src/api/crm.js. La identidad (viewerUid,
// role) la envia el CRM ya autenticada; el bot re-resuelve la org y el alcance.
const express = require("express");
const config = require("../config");
const { resolveScope } = require("../agent/scope");
const sofiComando = require("../agent/sofi-comando");

const router = express.Router();

// El middleware de src/api/crm.js esta scopeado a su propio router, no cubre
// este; se replica el guard de x-api-key aca.
router.use("/api/assistant", (req, res, next) => {
  if (!config.botApiKey || req.headers["x-api-key"] !== config.botApiKey) {
    return res.status(401).json({ error: "API key invalida" });
  }
  next();
});

// Abre (o retoma) la sesion del dia y devuelve el briefing + historial.
router.post("/api/assistant/session", async (req, res) => {
  try {
    const { orgId, viewerUid, role, userName } = req.body || {};
    if (!viewerUid || !role) return res.status(400).json({ error: "Faltan viewerUid o role" });
    const scope = await resolveScope({ orgId, viewerUid, role });
    const out = await sofiComando.openSession(scope, { userName });
    res.json(out);
  } catch (e) {
    console.error("[assistant] session:", e);
    res.status(500).json({ error: e.message });
  }
});

// Turno de chat.
router.post("/api/assistant/message", async (req, res) => {
  try {
    const { orgId, viewerUid, role, sessionId, text, userName } = req.body || {};
    if (!viewerUid || !role || !sessionId || !text?.trim()) {
      return res.status(400).json({ error: "Faltan datos" });
    }
    const scope = await resolveScope({ orgId, viewerUid, role });
    const out = await sofiComando.processMessage(scope, sessionId, text.trim(), { userName });
    res.json(out);
  } catch (e) {
    console.error("[assistant] message:", e);
    res.status(500).json({ error: e.message });
  }
});

// Cierra el dia: resumen + siembra de la cola de manana.
router.post("/api/assistant/close", async (req, res) => {
  try {
    const { orgId, viewerUid, role, sessionId, userName } = req.body || {};
    if (!viewerUid || !role || !sessionId) return res.status(400).json({ error: "Faltan datos" });
    const scope = await resolveScope({ orgId, viewerUid, role });
    const out = await sofiComando.closeSession(scope, sessionId, { userName });
    res.json(out);
  } catch (e) {
    console.error("[assistant] close:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

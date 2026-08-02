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

// ── Grupos de WhatsApp ──────────────────────────────────────────────────
//
// Ya NO hay endpoints de vinculacion de lineas: el 2026-07-30 WhatsApp baneo
// la cuenta de la asesora cuya linea estaba pareada con WAHA. La captura ahora
// entra por dos vias que no tocan el protocolo de WhatsApp —el export nativo
// del chat y el reenvio a Sofi por la Cloud API— asi que no hay ninguna linea
// que parear, y por lo tanto ninguna puerta que dejar cerrada.
const organizations = require("../data/organizations");

// Metricas del radar. Antes vivian en memoria del bot y se reiniciaban con
// cada deploy —"desde el ultimo reinicio" era una ventana inutil para decidir
// nada—. Ahora salen de la base, asi que sobreviven y se pueden comparar.
router.post("/api/grupos/metricas", async (req, res) => {
  try {
    const org = await organizations.getDefault();
    const dias = Number(req.body?.dias) || 14;
    res.json({ ok: true, ...(await require("../data/group-signals").resumen(org.id, { dias })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Import de exports .txt ──────────────────────────────────────────────
//
// La via segura para leer los grupos: el asesor exporta el chat desde su
// telefono (funcion nativa de WhatsApp) y sube el archivo. Nada se conecta a
// la linea de nadie.
//
// Responde 202 con un id y procesa en segundo plano: un export de varios
// grupos tarda minutos y el navegador cortaria la conexion mucho antes.
const importJobs = require("../groups/import-jobs");
const { DIAS_DEFAULT: DIAS_DEFAULT_IMPORT } = require("../groups/importar-export");

router.post("/api/grupos/importar-export", upload.array("files", 10), async (req, res) => {
  const archivos = (req.files || []).map((f) => ({
    nombre: f.originalname,
    contenido: f.buffer.toString("utf8"),
  }));
  if (archivos.length === 0) {
    return res.status(400).json({ error: "No llego ningun archivo .txt" });
  }

  // Tres casos:
  //   -1  → incremental: cada grupo arranca donde quedo la vez anterior. Es el
  //         default de la pantalla y lo que hace viable subir dos veces al dia.
  //    0  → todo el historial (caro, valido para un grupo nuevo).
  //   N   → ventana fija de N dias, ignorando la marca de agua.
  const crudo = req.body?.dias;
  const pedido = crudo === "" || crudo === undefined ? -1 : Number(crudo);
  const incremental = pedido < 0;
  // Con incremental sigue habiendo un techo: la primera carga de un grupo no
  // tiene marca de agua y sin tope se traeria el historial entero.
  const dias = incremental ? DIAS_DEFAULT_IMPORT : (pedido || null);

  try {
    const org = req.body?.orgId
      ? { id: req.body.orgId }
      : await organizations.getDefault();
    if (!org?.id) return res.status(404).json({ error: "No se pudo resolver la organizacion" });

    const job = importJobs.crear(org.id, { archivos: archivos.length, dias });
    res.status(202).json({ ok: true, jobId: job.id });

    // Deliberadamente sin await: la respuesta ya salio.
    const { importar } = require("../groups/importar-export");
    importar(org, archivos, {
      dias,
      incremental,
      // Quien sube el export es quien observa las señales que salgan de el. Lo
      // resuelve el CRM contra el usuario logueado; si no viene, quedan sin
      // autor y solo las ve un admin.
      advisorId: req.body?.advisorId || null,
      onProgreso: (p) => importJobs.progreso(job.id, p),
    })
      .then((stats) => {
        importJobs.terminar(job.id, stats);
        console.log(
          `[radar] Import listo: ${stats.señales} señales nuevas, ${stats.duplicadas} duplicadas, ` +
          `${stats.ofertasArchivadas} ofertas archivadas, USD ${stats.costoUsd.toFixed(4)}`
        );
      })
      .catch((e) => {
        importJobs.fallar(job.id, e);
        console.error("[radar] Import fallido:", e.message);
      });
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

router.get("/api/grupos/importar-export/:jobId", async (req, res) => {
  try {
    const org = await organizations.getDefault();
    const estado = importJobs.estado(req.params.jobId, org?.id);
    if (!estado) return res.status(404).json({ error: "Importacion no encontrada o expirada" });
    res.json({ ok: true, ...estado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar una senal como revisada (o descartada, o de vuelta a pendiente).
//
// Con volumen alto —el 2026-07-29 entraron ~980 senales en un dia— sin una
// marca de "ya lo mire" el asesor relee los mismos pedidos todos los dias y
// los nuevos se pierden entre ellos. NO borra nada: solo cambia el estado.
// Prender o apagar el motor de Radar. Apaga lo que se cobra —clasificar un
// export y mandar el digest—; nunca esconde lo ya detectado.
router.post("/api/grupos/radar", async (req, res) => {
  const { activo } = req.body || {};
  if (typeof activo !== "boolean") {
    return res.status(400).json({ error: "Falta 'activo' (true o false)" });
  }
  try {
    const org = req.body?.orgId
      ? { id: req.body.orgId }
      : await organizations.getDefault();
    const actualizada = await organizations.setRadarActivo(org.id, activo);
    console.log(`[radar] motor ${activo ? "ENCENDIDO" : "APAGADO"} para ${actualizada.name || org.id}`);
    res.json({ ok: true, radar_activo: actualizada.radar_activo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

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
const organizations = require("../data/organizations");
const whatsappGroups = require("../data/whatsapp-groups");
const waha = require("../lib/waha");

// GROUPS_ENABLED tiene que ser un interruptor de verdad.
//
// El 2026-07-30, al desconectar todo despues del baneo, se descubrio que
// apagarlo NO alcanzaba: frenaba el webhook, pero estos endpoints seguian
// respondiendo, asi que un clic en "Vincular linea" desde el CRM podia volver a
// parear el numero — justo lo que no puede pasar mientras Meta revisa una
// cuenta suspendida. Un interruptor que deja una puerta abierta no es un
// interruptor.
//
// Cubre SOLO lo que toca WhatsApp a traves de WAHA (parear, ver estado,
// importar). Leer lo ya guardado y marcar una senal como revisada no tocan la
// linea de nadie y siguen disponibles.
function requiereGruposActivos(req, res, next) {
  if (!config.groups.enabled) {
    return res.status(423).json({
      error:
        "La escucha de grupos esta desactivada (GROUPS_ENABLED=false). " +
        "No se puede vincular ni consultar ninguna linea de WhatsApp.",
    });
  }
  next();
}

// Vincular la linea: crea la sesion en WAHA y la registra. El corte temporal
// (escucha_desde) queda fijado en este instante — nada anterior se procesa.
//
// `rol` deja anotado en la fila que la linea es dedicada. La regla que costo
// una cuenta en julio es que nunca se vincula la de una persona; anotarlo evita
// que la regla viva solo en la cabeza de alguien.
router.post("/api/grupos/sesion", requiereGruposActivos, async (req, res) => {
  const { nombre, advisorId, rol } = req.body || {};
  if (!nombre || !/^[a-z0-9_-]{2,40}$/i.test(nombre)) {
    return res.status(400).json({ error: "Nombre de sesion invalido (letras, numeros, guiones)" });
  }
  if (!config.groups.webhookSecret) {
    return res.status(400).json({ error: "Falta GROUPS_WEBHOOK_SECRET en el bot" });
  }
  if (!config.groups.publicUrl) {
    return res.status(400).json({ error: "Falta BOT_PUBLIC_URL: sin ella WAHA no sabe a donde mandar los mensajes" });
  }
  try {
    const org = await organizations.getDefault();
    const webhookUrl = `${config.groups.publicUrl}/webhook/grupos`;
    const remota = await waha.crearSesion(nombre, { webhookUrl, webhookSecret: config.groups.webhookSecret });
    const local = await whatsappGroups.upsertSession(org.id, {
      nombre,
      advisorId: advisorId || null,
      rol: rol === "asesor" ? "asesor" : "dedicada",
    });
    res.json({ ok: true, sesion: local, waha: { status: remota?.status || null } });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Estado + QR en una sola llamada: es lo que la pantalla de pareo consulta en
// bucle, y el QR caduca en segundos — pedirlo aparte duplicaria el polling.
router.post("/api/grupos/sesion/estado", requiereGruposActivos, async (req, res) => {
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

    // Si ya quedo vinculada se marca activa. El corte temporal NO se toca: se
    // fijo al crear la sesion y reescribirlo abriria la puerta a reprocesar
    // historial.
    if (status === "WORKING") await whatsappGroups.upsertSession(org.id, { nombre, estado: "activa" });

    res.json({
      ok: true, status, qr,
      error: remota?.error || null,
      sesion: locales.find((s) => s.nombre === nombre) || null,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Reintento manual, una sola vez. Es lo primero que se prueba cuando la sesion
// se cae: conserva las credenciales, asi que no obliga a escanear el QR.
//
// No existe ningun programador que llame a esto. Si el reintento no la levanta,
// hay que mirar por que — no volver a apretar. El 2026-07-30 el sistema
// reintento 60 veces en 5 minutos contra un WhatsApp que ya habia dicho que no.
router.post("/api/grupos/sesion/reintentar", requiereGruposActivos, async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: "Falta el nombre de la sesion" });
  try {
    const estado = await waha.reintentarUnaVez(nombre);
    res.json({ ok: true, status: estado?.status || null });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Volver a parear desde cero: descarta las credenciales guardadas y pide un QR
// nuevo. Es la salida cuando WhatsApp deja de aceptar el dispositivo — la
// sesion queda en FAILED y reiniciarla no sirve, porque reintenta con las
// mismas credenciales rechazadas.
router.post("/api/grupos/sesion/revincular", requiereGruposActivos, async (req, res) => {
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

// Importa de una todos los grupos de la linea. Nacen TODOS apagados: importar
// no es escuchar, y escuchar no es responder.
router.post("/api/grupos/importar", requiereGruposActivos, async (req, res) => {
  const { sesion } = req.body || {};
  if (!sesion) return res.status(400).json({ error: "Falta el nombre de la sesion" });
  try {
    const org = await organizations.getDefault();
    let grupos = await waha.listarGrupos(sesion);

    // Si WAHA no devuelve nada, los grupos que YA conocemos igual necesitan
    // nombre: el webhook los descubre con cada mensaje pero de ahi solo sale el
    // jid, y sin nombre no se pueden administrar.
    if (grupos.length === 0) {
      const conocidos = (await whatsappGroups.listGroups(org.id)).filter((g) => !g.nombre);
      if (conocidos.length > 0) {
        const mapa = await waha.nombresPorJid(sesion, conocidos.map((g) => g.jid));
        grupos = [...mapa].map(([jid, nombre]) => ({ jid, nombre }));
      }
    }

    const r = await whatsappGroups.importarGrupos(org.id, grupos);
    console.log(`[grupos] importados ${r.nuevos} nuevos de ${r.total} en la sesion ${sesion}`);
    res.json({ ok: true, ...r, conNombre: grupos.filter((g) => g.nombre).length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Listar los grupos con sus dos permisos. No toca WhatsApp: lee lo guardado.
router.post("/api/grupos/listar", async (req, res) => {
  try {
    const org = await organizations.getDefault();
    res.json({ ok: true, grupos: await whatsappGroups.listGroups(org.id) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Los dos permisos, en dos endpoints distintos a proposito: escuchar un grupo y
// dejar que el bot hable en el son decisiones de riesgo distinto y no se toman
// juntas por accidente.
router.post("/api/grupos/modo", async (req, res) => {
  const { groupId, modo } = req.body || {};
  if (!groupId || !modo) return res.status(400).json({ error: "Faltan groupId o modo" });
  try {
    const org = await organizations.getDefault();
    res.json({ ok: true, grupo: await whatsappGroups.setModo(org.id, groupId, modo) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/api/grupos/responde", async (req, res) => {
  const { groupId, responde } = req.body || {};
  if (!groupId) return res.status(400).json({ error: "Falta groupId" });
  try {
    const org = await organizations.getDefault();
    const grupo = await whatsappGroups.setResponde(org.id, groupId, responde);
    console.warn(`[grupos] ${grupo.nombre || grupo.jid}: responder = ${grupo.responde}`);
    res.json({ ok: true, grupo });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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
const signalEvents = require("../data/signal-events");
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
// Registrar en que termino una oportunidad. Es el ultimo eslabon de la cadena
// de aprendizaje (P14) y el unico que no se puede reconstruir despues: una
// decision real de un asesor, en el momento en que ocurrio, es irrepetible.
//
// Cada llamada AGREGA un evento, nunca corrige el anterior (P15). Si una
// oportunidad va de CONVERSACION a VISITA a PERDIDO, quedan los tres.
router.post("/api/grupos/senal/evento", async (req, res) => {
  const { signalId, tipo, motivo, advisorId } = req.body || {};
  if (!signalId) return res.status(400).json({ error: "Falta signalId" });
  if (!signalEvents.TIPOS.includes(tipo)) {
    return res.status(400).json({ error: `Tipo invalido. Use: ${signalEvents.TIPOS.join(", ")}` });
  }
  try {
    const org = await organizations.getDefault();
    const evento = await signalEvents.registrar(org.id, {
      signalId, tipo, motivo: motivo || null, advisorId: advisorId || null,
    });
    if (!evento) {
      return res.status(503).json({ error: "Falta correr db/migrations/2026-08-02_learning_domain.sql" });
    }
    res.json({ ok: true, evento });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

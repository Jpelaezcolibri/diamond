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
const directorio = require("../groups/directorio");

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

// ¿A cuantos colegas del grupo podriamos escribirle al privado?
//
// SOLO MIDE. No envia nada, no cambia nada, no toca el flujo del radar. Existe
// porque la pregunta "responder por interno" (Juan, 2026-08-22) depende de un
// dato que nadie tenia: WhatsApp oculta el numero de los participantes de un
// grupo y lo reemplaza por un LID, y la doc de WAHA advierte que resolverlo
// falla si el numero no esta en los contactos de la linea o si la linea no es
// admin del grupo — Natalia es miembro, no admin. Sin este numero, disenar el
// flujo de DM seria adivinar.
//
// Los telefonos resueltos salen enmascarados: alcanza para contar, y son datos
// de terceros que no hay razon para volcar completos en una respuesta HTTP.
// Prueba de humo del DM: manda un mensaje directo por la linea del radar, y
// SOLO al numero de RADAR_ALERTA_TO.
//
// POR QUE EXISTE (Juan, 2026-08-24). El DM al privado es la conducta que se
// llevo la cuenta en julio de 2026 (ver la nota de diseno en src/lib/waha.js),
// y WAHA solo es alcanzable desde la red interna de Railway: no hay forma de
// probar `enviarDm` sin desplegar. Estrenarlo directo contra un colega real
// significaria que el primer mensaje mal formado lo lee alguien de afuera.
// Esto deja que lo lea Juan primero, en su propio WhatsApp.
//
// NO acepta destinatario por parametro, a proposito: si la BOT_API_KEY se
// filtrara, un endpoint que manda WhatsApp a cualquier numero convertiria al
// bot en una herramienta de spam. El destino sale de la config del servidor y
// no se puede sobrescribir desde el request.
router.post("/api/grupos/probar-dm", async (req, res) => {
  const destino = (process.env.RADAR_ALERTA_TO || "").split(",")[0].trim();
  if (!destino) return res.status(501).json({ error: "Falta RADAR_ALERTA_TO" });
  if (!waha.configurado()) return res.status(501).json({ error: "WAHA no configurado" });

  try {
    const org = await organizations.getDefault();
    const sesiones = await whatsappGroups.listSessions(org.id);
    if (!sesiones.length) return res.status(404).json({ error: "No hay sesion vinculada" });

    const texto =
      typeof req.body?.texto === "string" && req.body.texto.trim()
        ? req.body.texto.trim()
        : "Prueba del radar: este es un mensaje directo enviado por la linea del radar. " +
          "Si lo estas leyendo, el DM al colega funciona.";

    const envio = await waha.enviarDm(sesiones[0].nombre, destino, texto);
    res.json({ destino: `***${destino.slice(-4)}`, sesion: sesiones[0].nombre, ...envio });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Diagnostico del CAMINO REAL (2026-09-02). El diagnostico-lids de abajo
// resolvio el 80% de los colegas (74 de 93) el mismo dia en que el directorio
// en vivo llevaba 0 telefonos guardados desde el 25-ago (6 de 85 en total).
// Mismo WAHA, misma sesion, mismo codigo de participantes: la diferencia
// tiene que estar en el camino que corre en vivo -- src/groups/directorio.js
// con su indice en memoria, su siembra y su throttle de un refresco por
// grupo cada RADAR_DIRECTORIO_REFRESCO_MIN. Este endpoint corre ESE modulo
// tal cual sobre los ultimos lids que quedaron en `sin_telefono`, y mide
// aparte cuanto tarda la lista de participantes de cada grupo (el timeout de
// waha.js es de 20 s; un grupo de 900 personas bajo una sesion inestable
// puede pasarse, y el throttle convierte un timeout en 10 min de silencio).
// Solo lectura: no escribe en colegas_grupos ni manda nada.
router.get("/api/grupos/diagnostico-directorio", async (req, res) => {
  if (!waha.configurado()) return res.status(501).json({ error: "WAHA no configurado" });
  const limite = Math.min(Number(req.query.limite) || 20, 60);
  try {
    const org = await organizations.getDefault();
    const sesiones = await whatsappGroups.listSessions(org.id);
    if (!sesiones.length) return res.status(404).json({ error: "No hay sesion vinculada" });
    const sesion = sesiones[0].nombre;

    const { data, error } = await supabase
      .from("group_signals")
      .select("autor_nombre, autor_telefono, group_id, created_at")
      .eq("org_id", org.id)
      .eq("origen", "vivo")
      .eq("politica_motivo", "sin_telefono")
      .order("created_at", { ascending: false })
      .limit(limite * 3);
    if (error) throw error;

    const grupos = await whatsappGroups.listGroups(org.id).catch(() => []);
    const porId = new Map(grupos.map((g) => [g.id, g]));

    const vistos = new Set();
    const casos = [];
    for (const s of data) {
      if (!s.autor_telefono || vistos.has(s.autor_telefono)) continue;
      if (casos.length >= limite) break;
      vistos.add(s.autor_telefono);
      const g = porId.get(s.group_id) || null;
      const t0 = Date.now();
      let telefono = null;
      let fallo = null;
      try {
        telefono = await directorio.telefonoDe(org.id, s.autor_telefono, { sesion, jid: g ? g.jid : null });
      } catch (e) {
        fallo = e.message;
      }
      casos.push({
        autor: s.autor_nombre,
        lid: `...${String(s.autor_telefono).slice(-5)}`,
        grupo: g ? g.nombre || g.jid : null,
        senal: s.created_at,
        ms: Date.now() - t0,
        resuelto: Boolean(telefono),
        telefono: telefono ? `***${String(telefono).slice(-4)}` : null,
        error: fallo,
      });
    }

    // La lista de participantes de cada grupo involucrado, medida aparte y
    // directo contra WAHA: cuanto tarda y cuantos traen `pn`.
    const jids = [...new Set(casos.map((c) => c.grupo).filter(Boolean))]
      .map((nombre) => grupos.find((g) => (g.nombre || g.jid) === nombre))
      .filter(Boolean);
    const participantes = [];
    for (const g of jids) {
      const t0 = Date.now();
      try {
        const lista = await waha.participantesDeGrupo(sesion, g.jid);
        participantes.push({
          grupo: g.nombre || g.jid,
          ms: Date.now() - t0,
          participantes: lista.length,
          con_telefono: lista.filter((p) => p.telefono).length,
        });
      } catch (e) {
        participantes.push({ grupo: g.nombre || g.jid, ms: Date.now() - t0, error: e.message });
      }
    }

    res.json({
      sesion,
      refresco_min: directorio.MS_ENTRE_REFRESCOS / 60000,
      casos: casos.length,
      resueltos: casos.filter((c) => c.resuelto).length,
      detalle: casos,
      participantes,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/grupos/diagnostico-lids", async (req, res) => {
  if (!waha.configurado()) return res.status(501).json({ error: "WAHA no configurado" });
  const limite = Math.min(Number(req.query.limite) || 40, 200);
  try {
    const org = await organizations.getDefault();
    const sesiones = await whatsappGroups.listSessions(org.id);
    if (!sesiones.length) return res.status(404).json({ error: "No hay sesion vinculada" });
    const sesion = sesiones[0].nombre;

    // PRIMERO los participantes de los grupos que se escuchan, y no como dato
    // de color: la doc de WAHA dice que llamar a los endpoints de grupos POBLA
    // el mapeo lid→telefono que despues sirve /lids/{lid}. Sin esta pasada, un
    // lid podria dar null por no haberlo preguntado nunca y no porque WhatsApp
    // lo oculte — y ese falso negativo nos haria descartar el camino por nada.
    const grupos = (await whatsappGroups.listGroups(org.id).catch(() => []))
      .filter((g) => g.jid && g.jid.endsWith("@g.us") && g.modo && g.modo !== "ignorar");

    // Quien es "yo" en esta sesion, para saber si la linea es admin de un grupo.
    // La primera version preguntaba si ALGUN participante era admin y daba
    // true en los 12 grupos, que es informacion cero: todo grupo tiene admins.
    const estado = await waha.estadoSesion(sesion).catch(() => null);
    const miId = String(estado?.me?.id || estado?.me?._serialized || "").replace(/\D/g, "") || null;

    // El indice que de verdad importa: lid -> telefono, armado desde la lista de
    // participantes. La Lids API resolvio 0 de 45 en produccion (2026-08-22) y
    // /lids/count no respondio, asi que en esta version de WAHA no sirve. Pero
    // el participante trae `pn` para ~80% de la gente, y de ahi si sale el
    // mapeo. Este es el dato que decide si el DM es viable.
    const indice = new Map();
    const porGrupo = [];
    for (const g of grupos) {
      const participantes = await waha.participantesDeGrupo(sesion, g.jid);
      for (const p of participantes) {
        const lid = String(p.id || "").replace(/\D/g, "");
        if (lid && p.telefono) indice.set(lid, p.telefono);
      }
      const yo = miId ? participantes.find((p) => String(p.id || "").replace(/\D/g, "") === miId) : null;
      porGrupo.push({
        grupo: g.nombre || g.jid,
        // Si la linea es admin, WhatsApp deja ver los telefonos de todos. Es la
        // via que escala y no depende de codigo, sino de que los duenos del
        // grupo la promuevan.
        soy_admin: yo ? yo.rol === "admin" || yo.rol === "superadmin" : null,
        me_encontre_en_la_lista: Boolean(yo),
        participantes: participantes.length,
        con_lid: participantes.filter((p) => p.esLid).length,
        con_telefono_visible: participantes.filter((p) => p.telefono).length,
      });
    }

    const { data, error } = await supabase
      .from("group_signals")
      .select("autor_nombre, autor_telefono")
      .eq("org_id", org.id)
      .eq("origen", "vivo")
      .not("autor_telefono", "is", null)
      .order("created_at", { ascending: false })
      .limit(limite);
    if (error) throw error;

    // Un colega puede haber publicado diez pedidos: lo que se mide es cuantas
    // PERSONAS distintas son alcanzables, no cuantos mensajes.
    const porId = new Map();
    for (const s of data) if (!porId.has(s.autor_telefono)) porId.set(s.autor_telefono, s.autor_nombre);

    const colegas = [];
    for (const [id, nombre] of porId) {
      // 12 digitos = ya venia siendo un telefono de verdad; mas = LID.
      const yaEsTelefono = id.length <= 12;
      // El indice de participantes primero: es el que funciona. La Lids API
      // queda como segundo intento por si una version futura la arregla.
      const porLista = indice.get(id) || null;
      const porApi = porLista || yaEsTelefono ? null : await waha.telefonoDeLid(sesion, id);
      // (la condicion de arriba: si ya lo tengo por la lista, o si nunca fue un
      //  lid, no hay nada que preguntarle a la Lids API)
      const telefono = yaEsTelefono ? id : porLista || porApi;
      colegas.push({
        autor: nombre,
        parece_lid: !yaEsTelefono,
        via: yaEsTelefono ? "ya_era_telefono" : porLista ? "lista_participantes" : porApi ? "lids_api" : null,
        resuelto: Boolean(telefono),
        telefono: telefono ? `***${telefono.slice(-4)}` : null,
      });
    }

    const resueltos = colegas.filter((c) => c.resuelto).length;
    res.json({
      sesion,
      lids_conocidos_por_waha: await waha.contarLids(sesion),
      colegas_distintos: colegas.length,
      resueltos,
      sin_resolver: colegas.length - resueltos,
      cobertura: colegas.length ? `${Math.round((resueltos / colegas.length) * 100)}%` : "n/a",
      lid_telefono_en_el_indice: indice.size,
      grupos: porGrupo,
      colegas,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cambia el modo de respuesta del radar en los grupos (sombra | asistido |
// auto) — org entera, no un grupo puntual. Nombre distinto de
// /api/grupos/modo a proposito: esa ruta ya existe y es el modo de una
// LINEA vinculada (whatsappGroups.setModo), un concepto totalmente
// distinto. El guard de admin vive en el CRM
// (crm/app/api/grupos/respuesta-modo/route.ts) — esta ruta interna confia
// en que ya se verifico ahi, igual que el resto de /api/grupos/*.
router.post("/api/grupos/respuesta-modo", async (req, res) => {
  const { modo } = req.body || {};
  if (!organizations.MODOS_RESPUESTA.includes(modo)) {
    return res.status(400).json({ error: `Modo invalido. Debe ser: ${organizations.MODOS_RESPUESTA.join(", ")}` });
  }
  try {
    const org = req.body?.orgId
      ? { id: req.body.orgId }
      : await organizations.getDefault();
    const actualizada = await organizations.setModoDeRespuesta(org.id, modo);
    console.log(`[radar] modo de respuesta -> ${modo} para ${actualizada.name || org.id}`);
    res.json({ ok: true, grupos_respuesta_modo: actualizada.grupos_respuesta_modo });
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

// DM manual al colega, desde el CRM (Juan, 2026-08-24): dispara
// vivo.js#responderPorDmManual para un pedido que quedo sin responder por DM
// -- ver la nota de diseño grande en ese archivo (dos casos reales: entro en
// otro modo, o quedo fuera de la ventana de antiguedad y un admin decide
// mandarlo igual).
//
// Misma resolucion de sesion que aprobarManual (una sola sesion vinculada por
// org en este piloto, ver la nota de diseño en vivo.js#aprobarManual): sin
// exactamente una activa, falla cerrado en vez de adivinar por cual linea
// salir -- se resuelve ACA y no dentro de vivo.js porque responderPorDmManual
// recibe `sesion` como dato ya averiguado, igual que procesarMensaje.
// `refs` (Juan, 2026-08-24, opcional): la seleccion que el usuario marco en
// el panel del CRM -- ver la nota de diseño grande en
// vivo.js#responderPorDmManual. Se pasa TAL CUAL, sin validar aca: la
// validacion de verdad (cruzar contra los matches reales de la señal) vive
// en vivo.js, no en el endpoint, para no duplicar esa logica de seguridad.
router.post("/api/grupos/senal/responder-dm", async (req, res) => {
  const { signalId, refs } = req.body || {};
  if (!signalId) return res.status(400).json({ error: "Falta signalId" });
  try {
    const org = await organizations.getDefault();
    const sesiones = await whatsappGroups.listSessions(org.id);
    const activas = sesiones.filter((s) => s.estado === "activa");
    if (activas.length !== 1) {
      return res.status(409).json({
        error: "No hay exactamente una sesion de WAHA activa para mandar el DM",
        cantidad: activas.length,
      });
    }
    const vivo = require("../groups/vivo");
    const r = await vivo.responderPorDmManual(org, signalId, { sesion: activas[0].nombre, refs: refs ?? null });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Panel "Posibles ventas" del CRM (Juan, 2026-08-21): confirmar o descartar
// un aviso del cruce diario visitas -> ventas. No es solo de admin — mismo
// criterio que /api/grupos/senal/estado, es trabajo diario de revisar avisos,
// no una decision sobre la privacidad de ninguna linea.
router.post("/api/grupos/venta/estado", async (req, res) => {
  const { id, estado, actualizadoPor } = req.body || {};
  if (!id) return res.status(400).json({ error: "Falta el id del aviso" });
  try {
    const org = await organizations.getDefault();
    const visitas = require("../data/visitas");
    if (!visitas.ESTADOS_ALERTA.includes(estado)) {
      return res.status(400).json({ error: `Estado invalido. Use: ${visitas.ESTADOS_ALERTA.join(", ")}` });
    }
    const alerta = await visitas.setEstadoAlerta(org.id, id, estado, actualizadoPor || null);
    if (!alerta) return res.status(404).json({ error: "Aviso no encontrado" });
    res.json({ ok: true, alerta });
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

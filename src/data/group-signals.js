// Senales detectadas en los grupos: SOLO demanda y oferta.
//
// Lo clasificado como ruido no llega nunca hasta aca — muere en memoria en el
// worker (invariante de privacidad #4 del diseno). Este modulo no tiene forma
// de guardar un mensaje que no sea senal, y eso es a proposito.

const supabase = require("./supabase");
const memory = require("./memory");

const CLASES = ["demanda", "oferta"];
const ORIGENES = ["vivo", "export", "reenvio"];

// Columnas de la migracion 2026-08-01_radar_grupos.sql. Si no corrio todavia,
// el insert las rechaza y se reintenta sin ellas: una senal guardada sin
// `origen` vale mucho mas que una senal perdida. Se avisa una sola vez para
// no llenar los logs.
// `advisor_id` llega con 2026-08-02_learning_domain.sql y va en la misma
// lista: en un entorno sin migrar, una señal guardada sin autor vale mucho mas
// que una señal perdida.
// Las exigencias del pedido (area_min, banos, garajes, estrato,
// flexible_habitaciones) llegan con 2026-08-24_group_signals_exigencias.sql y
// van en la misma lista, por la misma razon.
const COLUMNAS_NUEVAS = [
  "origen", "fecha_mensaje", "advisor_id",
  "area_min", "banos", "garajes", "estrato", "flexible_habitaciones",
];
let faltanColumnas = false;
// Cuales faltan DE VERDAD, no "alguna falta". Hasta el 2026-08-24 esto era un
// solo booleano y el reintento borraba la lista ENTERA: con una migracion
// corrida y la otra no —el estado normal mientras se despliega— una columna
// nueva sin migrar se llevaba puesto tambien `fecha_mensaje`, que ya existia
// y que es de donde sale la antiguedad del pedido para decidir el DM
// (src/groups/politica.js#decidirDm). Se habrian perdido DMs sin un solo
// error visible, que es exactamente el modo de falla que este archivo
// intenta evitar.
const columnasAusentes = new Set();

// PGRST204: PostgREST no encuentra la columna en su cache de esquema.
// 42703: Postgres dice que la columna no existe.
function esColumnaFaltante(error) {
  return error?.code === "PGRST204" || error?.code === "42703";
}

// Los dos codigos citan la columna entre comillas: PostgREST dice "Could not
// find the 'x' column of ...", Postgres dice: column "x" of relation ... Se
// acepta solo si es una de las nuestras — nunca se borra a ciegas un campo
// que el error nombro por otra razon.
function columnaDelError(error) {
  const m = String(error?.message || "").match(/'([a-z_]+)'|"([a-z_]+)"/);
  const nombre = m && (m[1] || m[2]);
  return nombre && COLUMNAS_NUEVAS.includes(nombre) ? nombre : null;
}

// Alta con deduplicacion. El mismo mensaje visto por dos asesores del mismo
// grupo trae el mismo wa_message_id: sin esto se paga la IA dos veces y —en
// Fase 2— el asesor recibe la alerta duplicada.
//
// Devuelve {signal, duplicado}.
async function create(orgId, fields) {
  if (!CLASES.includes(fields.clase)) throw new Error(`Clase invalida: ${fields.clase}`);
  const origen = fields.origen || "vivo";
  if (!ORIGENES.includes(origen)) throw new Error(`Origen invalido: ${origen}`);

  const row = {
    org_id: orgId,
    group_id: fields.group_id,
    wa_message_id: fields.wa_message_id,
    autor_nombre: fields.autor_nombre || null,
    autor_telefono: fields.autor_telefono || null,
    // Quien OBSERVO la señal: el asesor que subio el export o que le reenvio
    // el pedido a Sofi. El grupo gremial es compartido —varios asesores estan
    // en los mismos— pero la interpretacion no lo es. Es lo que permite que
    // cada asesor vea lo suyo, y lo que hace posible preguntar "que vio
    // Natalia" en vez de solo "que aparecio" (P14).
    advisor_id: fields.advisor_id || null,
    clase: fields.clase,
    confianza: fields.confianza ?? null,
    operacion: fields.operacion || null,
    tipo: fields.tipo || null,
    zona: fields.zona || null,
    // Las zonas completas y las excluidas (2026-09-02). Igual que las cinco
    // exigencias de mas abajo: se extraian y se usaban, pero no se guardaban.
    // Ver db/migrations/2026-09-02_group_signals_zonas.sql.
    zonas: fields.zonas || null,
    zonas_excluidas: fields.zonas_excluidas || null,
    ciudad: fields.ciudad || null,
    precio_min: fields.precio_min || null,
    precio_max: fields.precio_max || null,
    habitaciones: fields.habitaciones || null,
    // Las otras cinco exigencias que classify.js extrae y match.js usa para
    // puntuar (Juan, 2026-08-24). Sin ellas guardadas, el panel mostraba un
    // pedido recortado —"Lo que pide" no decia que Edwin habia pedido 98 m²,
    // 2 baños y 2 garajes— y el efecto del castigo por cumplir corto no se
    // podia medir sobre historico. Ver
    // db/migrations/2026-08-24_group_signals_exigencias.sql.
    area_min: fields.area_min || null,
    banos: fields.banos || null,
    garajes: fields.garajes || null,
    estrato: fields.estrato || null,
    // Booleano, no id: `|| null` convertiria false en null y se perderia la
    // diferencia entre "no acepta una menos" y "no se sabe".
    flexible_habitaciones: fields.flexible_habitaciones ?? null,
    contacto: fields.contacto || null,
    texto_original: fields.texto_original || null,
    matches: fields.matches || [],
    estado: "nuevo",
    origen,
    // La fecha REAL del mensaje en el grupo. En un export los mensajes son de
    // hace dias o semanas y created_at diria "hoy" para todos: sin esto no se
    // puede distinguir una demanda de ayer de una de hace un mes, y una
    // demanda vieja no vale — el colega ya consiguio lo que buscaba.
    fecha_mensaje: fields.fecha_mensaje || null,
  };

  if (!supabase) {
    const yaEsta = memory.groupSignals.find(
      (s) => s.org_id === orgId && s.group_id === row.group_id && s.wa_message_id === row.wa_message_id
    );
    if (yaEsta) return { signal: yaEsta, duplicado: true };
    const creada = { id: memory.uid(), created_at: new Date().toISOString(), ...row };
    memory.groupSignals.push(creada);
    return { signal: creada, duplicado: false };
  }

  return insertar(row);
}

async function insertar(row) {
  // Si ya sabemos que la migracion no corrio, ni lo intentamos con las
  // columnas nuevas.
  const fila = faltanColumnas || columnasAusentes.size ? sinColumnasNuevas(row) : row;

  const { data, error } = await supabase.from("group_signals").insert(fila).select().single();
  if (!error) return { signal: data, duplicado: false };

  // 23505 = violacion de indice unico: es el dedup haciendo su trabajo, no
  // un fallo. Cualquier otro error si se propaga.
  if (error.code === "23505") return { signal: null, duplicado: true };

  if (esColumnaFaltante(error)) {
    // Solo la que el error nombro. Si no se pudo identificar, se cae al
    // comportamiento historico (sacar todas) antes que perder la señal.
    const columna = columnaDelError(error);
    if (columna && !columnasAusentes.has(columna)) {
      columnasAusentes.add(columna);
      console.warn(`[grupos] La columna group_signals.${columna} no existe — falta correr su migracion. Las señales se guardan sin ella hasta entonces.`);
      return insertar(row);
    }
    if (!columna && !faltanColumnas) {
      faltanColumnas = true;
      console.warn(
        "[grupos] Falta correr una migracion de group_signals — las señales se " +
        "guardan sin las columnas nuevas hasta entonces."
      );
      return insertar(row);
    }
  }
  throw error;
}

// `faltanColumnas` (no se pudo identificar cual) saca todas, como siempre;
// si SI se identificaron, se sacan solo esas y el resto se sigue guardando.
function sinColumnasNuevas(row) {
  const copia = { ...row };
  const aSacar = faltanColumnas ? COLUMNAS_NUEVAS : columnasAusentes;
  for (const c of aSacar) delete copia[c];
  return copia;
}

async function list(orgId, { clase = null, estado = null, limit = 200 } = {}) {
  if (!supabase) {
    return memory.groupSignals
      .filter((s) => s.org_id === orgId && (!clase || s.clase === clase) && (!estado || s.estado === estado))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, limit);
  }
  let q = supabase.from("group_signals").select("*").eq("org_id", orgId);
  if (clase) q = q.eq("clase", clase);
  if (estado) q = q.eq("estado", estado);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

async function setEstado(orgId, id, estado) {
  if (!["nuevo", "gestionado", "descartado"].includes(estado)) throw new Error(`Estado invalido: ${estado}`);
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.id === id && x.org_id === orgId);
    if (!s) throw new Error("Senal no encontrada");
    s.estado = estado;
    return s;
  }
  const { data, error } = await supabase
    .from("group_signals")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("org_id", orgId).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

// Metricas del modo sombra: lo que Juan mira para decidir si pasar a Fase 2.
async function resumen(orgId, { dias = 14 } = {}) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const filas = !supabase
    ? memory.groupSignals.filter((s) => s.org_id === orgId && s.created_at >= desde)
    : (await supabase.from("group_signals").select("clase, matches, created_at").eq("org_id", orgId).gte("created_at", desde)).data || [];

  const demandas = filas.filter((s) => s.clase === "demanda");
  const ofertas = filas.filter((s) => s.clase === "oferta");
  const conMatch = demandas.filter((s) => (s.matches || []).length > 0).length;

  return {
    dias,
    demandas: demandas.length,
    ofertas: ofertas.length,
    demandasConMatch: conMatch,
    demandasPorDia: demandas.length / dias,
    ofertasPorDia: ofertas.length / dias,
    tasaMatch: demandas.length === 0 ? 0 : conMatch / demandas.length,
  };
}

// Hasta que fecha se leyo este grupo — la marca de agua del import.
//
// Sin esto, re-exportar un grupo vuelve a pagarle a la IA por todo el rango:
// el dedup de señales evita la fila repetida, pero recien DESPUES de
// clasificar. Con dos cargas diarias y corte de 30 dias serian ~60 veces el
// costo necesario.
//
// Es deliberadamente conservadora: se calcula sobre las señales guardadas, y
// el ruido no se guarda. Si los ultimos dias fueron puro ruido, la marca queda
// atras y se reprocesan — barato, y del lado seguro: nunca se salta un mensaje
// que no se haya visto.
async function ultimaFechaImportada(orgId, groupId) {
  if (!supabase) {
    const fechas = memory.groupSignals
      .filter((s) => s.org_id === orgId && s.group_id === groupId && s.fecha_mensaje)
      .map((s) => s.fecha_mensaje);
    return fechas.length ? fechas.sort().at(-1) : null;
  }
  const { data, error } = await supabase
    .from("group_signals")
    .select("fecha_mensaje")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .not("fecha_mensaje", "is", null)
    .order("fecha_mensaje", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Sin la columna todavia: se comporta como un grupo nuevo.
    if (esColumnaFaltante(error)) return null;
    throw error;
  }
  return data?.fecha_mensaje || null;
}

// ── Digest diario ────────────────────────────────────────────────────────

// Lo que todavia no se conto en ningun digest y vale la pena contar.
//
// Filtra en la consulta y no en memoria porque esta tabla crece sin techo:
// el indice parcial `group_signals_digest_pend` existe justo para esto.
//
// "Vale la pena contar" = una demanda que calzo con algo, o una oferta (que
// siempre suma inventario). Una demanda sin match no se cuenta: es la fatiga
// de alertas, que es el riesgo principal de esta direccion.
async function pendientesDigest(orgId, { limit = 200 } = {}) {
  if (!supabase) {
    return memory.groupSignals
      .filter((s) => s.org_id === orgId && !s.digest_enviado_at && !s.digest_omitida)
      .filter((s) => s.clase === "oferta" || (s.matches || []).length > 0)
      .slice(0, limit);
  }
  const { data, error } = await supabase
    .from("group_signals")
    .select("*")
    .eq("org_id", orgId)
    .is("digest_enviado_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (esColumnaFaltante(error)) return null; // el worker se auto-desactiva
    throw error;
  }
  return (data || []).filter((s) => s.clase === "oferta" || (s.matches || []).length > 0);
}

// Se marca ANTES de enviar. Duplicarle el digest a un asesor entrena a
// ignorarlo; perderlo una vez no.
async function marcarDigest(orgId, ids) {
  if (!ids.length) return;
  const ahora = new Date().toISOString();
  if (!supabase) {
    for (const s of memory.groupSignals) if (ids.includes(s.id)) s.digest_enviado_at = ahora;
    return;
  }
  const { error } = await supabase
    .from("group_signals").update({ digest_enviado_at: ahora }).eq("org_id", orgId).in("id", ids);
  if (error) throw error;
}

async function revertirDigest(orgId, ids) {
  if (!ids.length) return;
  if (!supabase) {
    for (const s of memory.groupSignals) if (ids.includes(s.id)) s.digest_enviado_at = null;
    return;
  }
  const { error } = await supabase
    .from("group_signals").update({ digest_enviado_at: null }).eq("org_id", orgId).in("id", ids);
  if (error) console.error("[digest] No se pudo revertir el claim:", error.message);
}

// Deja constancia de que el aviso al asesor SALIO.
//
// Sin esto la pregunta "¿le llego la alerta a la asesora?" no tiene respuesta:
// el envio no dejaba rastro en ningun lado, ni en la tabla ni en los logs, asi
// que un fallo silencioso de Meta era indistinguible de un exito. Se identifica
// por (grupo, wa_message_id) porque es la clave que el flujo ya tiene a mano.
async function marcarEnviada(orgId, groupId, waMessageId) {
  if (!supabase) return;
  const { error } = await supabase
    .from("group_signals")
    .update({ enviado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .eq("wa_message_id", waMessageId);
  if (error) console.error("[grupos] No se pudo marcar la señal como enviada:", error.message);
}

// Guarda el veredicto de Sofi sobre las candidatas de una senal (modo asistido).
//
// Se guarda ENTERO y aunque haya dicho que no sirve: el "no" tambien ensena. Es
// una de las tres piezas con las que se calibra el motor, junto al puntaje y a
// lo que la asesora termino haciendo (signal_events).
//
// Best-effort: si falta la migracion 2026-08-18, se avisa una vez y el flujo
// sigue. Perder el dato de calibracion no puede costar la oportunidad.
async function guardarRevalidacion(orgId, signalId, veredicto) {
  if (!supabase) return true;
  const { error } = await supabase
    .from("group_signals")
    .update({ revalidacion: veredicto, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", signalId);
  if (error) {
    if (esColumnaFaltante(error)) {
      console.error("[grupos] Falta la migracion 2026-08-18_radar_asistido.sql: el veredicto de Sofi no se guarda.");
    } else {
      console.error("[grupos] No se pudo guardar la revalidacion:", error.message);
    }
    return false;
  }
  return true;
}

// Deja constancia de que el aviso a la asesora SALIO.
//
// Si esto no se llama, la senal queda con `enviado_at` en null y sigue en la
// cola. Eso es deliberado: fuera de la ventana de 24 h Meta rechaza el texto
// libre, y una senal pendiente se puede reintentar cuando la asesora escriba.
//
// wamid y advisorId son best-effort (migracion 2026-08-18_radar_aviso_destinatario):
// sin ellos el aviso igual queda marcado como enviado, solo que ni Sofi ni
// trazabilidad_radar van a poder decir A QUIEN se le mando ni matchear una
// respuesta citada con esta señal.
// `refs` (2026-09-02): QUE propiedades llevaba el aviso. Juan: "necesito que
// quede marcado el match en la propiedad que se envio con el bot de manera
// automatica y cuales se avisaron". Es el complemento de respuesta_refs — esas
// son las que salieron solas al privado del colega; estas son las que quedaron
// en manos de la asesora. Best-effort igual que wamid/advisorId: si falta la
// migracion, el aviso igual se marca enviado.
async function marcarAvisoEnviado(orgId, signalId, { wamid = null, advisorId = null, refs = null } = {}) {
  if (!supabase) return true;
  const patch = { enviado_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const conRefs = { ...patch, aviso_wamid: wamid, aviso_advisor_id: advisorId, aviso_refs: refs };
  const conDestinatario = { ...patch, aviso_wamid: wamid, aviso_advisor_id: advisorId };
  let { error } = await supabase.from("group_signals").update(conRefs).eq("org_id", orgId).eq("id", signalId);
  if (error && esColumnaFaltante(error)) {
    console.warn("[grupos] Falta la migracion 2026-09-02_group_signals_aviso_refs.sql: el aviso se marca enviado, pero sin decir que propiedades llevaba.");
    ({ error } = await supabase.from("group_signals").update(conDestinatario).eq("org_id", orgId).eq("id", signalId));
  }
  if (error && esColumnaFaltante(error)) {
    console.error("[grupos] Falta la migracion 2026-08-18_radar_aviso_destinatario.sql: el aviso se marca enviado, pero sin destinatario.");
    ({ error } = await supabase.from("group_signals").update(patch).eq("org_id", orgId).eq("id", signalId));
  }
  if (error) {
    console.error("[grupos] No se pudo marcar el aviso como enviado:", error.message);
    return false;
  }
  return true;
}

// La señal detras de un aviso CITADO (swipe-to-reply): la asesora responde
// tocando el mensaje original, WhatsApp manda su wamid como `context.id`, y
// esto lo resuelve directo a la señal sin que Sofi tenga que preguntar a
// cual pedido se refiere.
async function findByWamid(orgId, wamid) {
  if (!wamid) return null;
  if (!supabase) return memory.groupSignals?.find((s) => s.org_id === orgId && s.aviso_wamid === wamid) || null;
  const { data, error } = await supabase
    .from("group_signals")
    .select("id, matches, texto_original, zona, tipo, operacion")
    .eq("org_id", orgId)
    .eq("aviso_wamid", wamid)
    .maybeSingle();
  if (error) {
    if (esColumnaFaltante(error)) return null;
    console.error("[grupos] No se pudo resolver la señal citada:", error.message);
    return null;
  }
  return data;
}

// Avisos que todavia no tienen un resultado registrado (signal_events) — lo
// que Sofi necesita cuando alguien responde SIN citar el mensaje ("ya llamé
// al de Sabaneta, no servía") y hay que adivinar a cual pedido se refiere.
//
// advisorId acota a los avisos de ESE asesor (Sofi-Cliente, cuando le
// responde a ella misma). Sin advisorId (null) trae los de TODA la org — lo
// que usa Sofi-Comando, porque el admin puede cerrar el ciclo de un pedido
// aunque no sea el destinatario (ver el comentario de advisorId en
// src/data/signal-events.js#registrar).
//
// No hace el join contra signal_events aca: esa tabla es del Learning Domain
// (ver src/data/signal-events.js) y la regla de dependencia es Radar ->
// Learning Domain, nunca al reves. El cruce lo hace quien llama.
async function pendientesDeAviso(orgId, advisorId = null, { limite = 20 } = {}) {
  if (!supabase) {
    return (memory.groupSignals || [])
      .filter((s) => s.org_id === orgId && s.enviado_at && (!advisorId || s.aviso_advisor_id === advisorId))
      .slice(-limite);
  }
  let q = supabase
    .from("group_signals")
    .select("id, texto_original, zona, tipo, operacion, enviado_at, matches, aviso_advisor_id")
    .eq("org_id", orgId)
    .not("enviado_at", "is", null)
    // Un aviso ya publicado (aprobado a mano, Juan 2026-08-20) no es
    // "pendiente" — respondida_at solo lo pisa el camino auto/sombra, asi
    // que en modo asistido esto no cambia nada.
    .is("respondida_at", null);
  if (advisorId) q = q.eq("aviso_advisor_id", advisorId);
  q = q.order("enviado_at", { ascending: false }).limit(limite);
  const { data, error } = await q;
  if (error) {
    if (esColumnaFaltante(error)) return [];
    console.error("[grupos] No se pudieron leer los avisos pendientes:", error.message);
    return [];
  }
  return data || [];
}

// Avisos SALIDOS hace mas de `minutos` a un asesor conocido, sin recordatorio
// todavia — candidatos para src/scheduler/radar-recordatorio.js. El filtro de
// "sin resultado ya registrado" lo aplica el scheduler (cruzando contra
// Pedidos que Sofi ya juzgo y que TODAVIA no se le avisaron a nadie: la cola
// de entrada de la bandeja de salida (src/scheduler/avisos-salida.js).
//
// Trae las que tienen veredicto guardado; si ese veredicto APRUEBA o no lo
// decide revalidar.js#apruebaAviso en quien llama — el criterio vive en un
// solo lugar y no se duplica en una consulta SQL que envejeceria aparte.
//
// `respondida_at` null: un pedido que ya se resolvio por DM automatico no
// tiene nada que avisarle a la asesora.
async function aprobadasSinAvisar(orgId, { desdeIso, limite = 30 } = {}) {
  if (!supabase) {
    return (memory.groupSignals || []).filter(
      (s) => s.org_id === orgId && s.clase === "demanda" && s.revalidacion && !s.enviado_at && !s.respondida_at
    );
  }
  const { data, error } = await supabase
    .from("group_signals")
    .select("*")
    .eq("org_id", orgId)
    .eq("clase", "demanda")
    .not("revalidacion", "is", null)
    .is("enviado_at", null)
    .is("respondida_at", null)
    .gte("created_at", desdeIso)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) {
    if (esColumnaFaltante(error)) return [];
    console.error("[grupos] No se pudieron leer los pedidos aprobados sin avisar:", error.message);
    return [];
  }
  return data || [];
}

// signal_events), por la misma razon de dependencia que pendientesDeAviso.
async function candidatosRecordatorio(orgId, { antesDeIso, limite = 100 } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_signals")
    .select("id, aviso_advisor_id, texto_original, enviado_at")
    .eq("org_id", orgId)
    .not("aviso_advisor_id", "is", null)
    .not("enviado_at", "is", null)
    .is("recordatorio_enviado_at", null)
    .lte("enviado_at", antesDeIso)
    .limit(limite);
  if (error) {
    if (esColumnaFaltante(error)) return [];
    console.error("[grupos] No se pudieron leer los candidatos a recordatorio:", error.message);
    return [];
  }
  return data || [];
}

// Claim atomico ANTES de mandar el recordatorio (mismo patron que
// leads.claimFollowup): si dos ticks corrieran a la vez, solo uno gana.
async function claimRecordatorio(orgId, signalId) {
  if (!supabase) return true;
  const { data, error } = await supabase
    .from("group_signals")
    .update({ recordatorio_enviado_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", signalId)
    .is("recordatorio_enviado_at", null)
    .select("id");
  if (error) {
    console.error("[grupos] No se pudo reclamar el recordatorio:", error.message);
    return false;
  }
  return Boolean(data && data.length);
}

// Avisos SALIDOS hace mas de `minutos` al asesor PRINCIPAL, sin escalar
// todavia por silencio -- candidatos para src/scheduler/radar-silencio.js
// (carril de venta). Mismo criterio de dependencia que candidatosRecordatorio:
// el cruce contra signal_events (¿ya hay resultado?) lo hace el scheduler, no
// este archivo.
async function candidatosEscaladoSilencio(orgId, { antesDeIso, limite = 100 } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_signals")
    .select("id, aviso_advisor_id, aviso_wamid, texto_original, enviado_at")
    .eq("org_id", orgId)
    .not("aviso_advisor_id", "is", null)
    .not("enviado_at", "is", null)
    .is("escalado_silencio_at", null)
    .lte("enviado_at", antesDeIso)
    .limit(limite);
  if (error) {
    if (esColumnaFaltante(error)) return [];
    console.error("[grupos] No se pudieron leer los candidatos a escalado por silencio:", error.message);
    return [];
  }
  return data || [];
}

// Claim atomico ANTES de escalar por silencio (mismo patron que
// claimRecordatorio): si dos ticks corrieran a la vez, solo uno gana.
async function claimEscaladoSilencio(orgId, signalId) {
  if (!supabase) return true;
  const { data, error } = await supabase
    .from("group_signals")
    .update({ escalado_silencio_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", signalId)
    .is("escalado_silencio_at", null)
    .select("id");
  if (error) {
    console.error("[grupos] No se pudo reclamar el escalado por silencio:", error.message);
    return false;
  }
  return Boolean(data && data.length);
}

const MODOS_RESPUESTA = ["sombra", "auto", "humano"];

// Deja constancia de una respuesta publicada en el grupo (o redactada en modo
// sombra). Guarda el TEXTO completo a proposito: si manana un colega reclama
// "ustedes publicaron un precio que no era", la unica respuesta honesta es
// mostrar el mensaje tal como salio. Reconstruirlo desde los matches no sirve
// porque el inventario ya habra cambiado.
//
// Devuelve true si quedo registrado. Un false NO es cosmetico: significa que el
// sistema publico algo que no puede probar, y quien llame decide que hacer.
// `refs` son los refs de las propiedades que quedaron DENTRO de `texto` (no
// todo `matches`: eso incluye lo que la compuerta de calidad descarto). Si la
// migracion de respuesta_refs no corrio todavia, se reintenta sin esa columna
// en vez de perder el resto del registro (texto/wamid/modo) — mismo criterio
// que el resto de este archivo (ver esColumnaFaltante).
async function marcarRespondida(orgId, signalId, { texto, wamid = null, modo = "auto", refs = null } = {}) {
  if (!MODOS_RESPUESTA.includes(modo)) throw new Error(`Modo de respuesta invalido: ${modo}`);
  if (!supabase) return true;
  const patch = {
    respondida_at: new Date().toISOString(),
    respuesta_texto: texto || null,
    respuesta_wamid: wamid,
    respuesta_modo: modo,
    respuesta_refs: refs && refs.length ? refs : null,
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase.from("group_signals").update(patch).eq("org_id", orgId).eq("id", signalId);
  if (error && esColumnaFaltante(error)) {
    delete patch.respuesta_refs;
    ({ error } = await supabase.from("group_signals").update(patch).eq("org_id", orgId).eq("id", signalId));
  }
  if (error) {
    console.error("[grupos] No se pudo registrar la respuesta publicada:", error.message);
    return false;
  }
  return true;
}

// Las respuestas que el bot publico en ESTE grupo desde `desdeIso`. Alimenta a
// la vez el limite diario y el cooldown, en una sola consulta: las dos preguntas
// se hacen siempre juntas, antes de cada publicacion.
//
// Devuelve { cantidad, ultimaIso } o null —no un cero— cuando no se puede saber
// (falta la migracion, o la base fallo). La diferencia importa: la politica
// trata el null como "no verificable" y NO responde. Es la direccion segura:
// ante la duda, callar. Un cero optimista habilitaria a publicar sin limite
// justo en el momento en que el sistema esta a ciegas.
// Una señal por su id, con lo necesario para volver a intentar publicarla
// (aprobacion manual, Juan 2026-08-20 — ver vivo.js#aprobarManual).
async function obtenerPorId(orgId, signalId) {
  if (!supabase) return memory.groupSignals?.find((s) => s.org_id === orgId && s.id === signalId) || null;
  // autor_telefono se agrego (Juan, 2026-08-24) para vivo.js#responderPorDmManual:
  // sin el no hay como resolver el telefono del colega ni contar los DMs que
  // ya salieron hoy por el mismo remitente. aprobarManual (el otro llamador)
  // simplemente no usa esta columna extra.
  //
  // revalidacion se agrego (Juan, 2026-08-24) para el mismo llamador: si esta
  // señal ya paso por modo asistido, ahi quedo guardado el veredicto de Sofi
  // con `sin_confirmar` (ver src/groups/revalidar.js) -- responderPorDmManual
  // lo reusa para que el DM manual tambien lleve la salvedad, sin volver a
  // pagar un llamado a la IA por un pedido que Sofi ya reviso. Una señal que
  // nunca paso por asistido (entro en modo auto/sombra) simplemente no tiene
  // esta columna poblada, y el codigo lo trata como "sin salvedad".
  const { data, error } = await supabase
    .from("group_signals")
    .select(
      "id, group_id, clase, matches, autor_nombre, autor_telefono, texto_original, respondida_at, wa_message_id, revalidacion"
    )
    .eq("org_id", orgId)
    .eq("id", signalId)
    .maybeSingle();
  if (error) {
    console.error("[grupos] No se pudo leer la señal:", error.message);
    return null;
  }
  return data;
}

// Pedidos CALLADOS con al menos una candidata (asi Sofi solo los ofrece para
// aprobar cuando de verdad hay algo que mandar, no cuando el motor no
// encontro nada). Sirve para que el admin diga "aprueba el de Camilo" sin
// tener que darle un id — se desambigua por texto, igual que
// registrar_resultado_radar.
async function calladosPendientes(orgId, { dias = 3, limite = 20 } = {}) {
  if (!supabase) return [];
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const { data, error } = await supabase
    .from("group_signals")
    .select("id, group_id, clase, matches, autor_nombre, texto_original, created_at, politica_motivo")
    .eq("org_id", orgId)
    .eq("origen", "vivo")
    .eq("clase", "demanda")
    .is("respondida_at", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) {
    if (esColumnaFaltante(error)) return [];
    console.error("[grupos] No se pudieron leer los callados pendientes:", error.message);
    return [];
  }
  return (data || []).filter((s) => Array.isArray(s.matches) && s.matches.length > 0);
}

// Deja constancia de POR QUE el radar callo (o publico) en el camino
// deterministico auto/sombra — lo que devolvio src/groups/politica.js#decidir.
//
// Bug real (Juan, 2026-08-20): sin esto, el motivo solo vivia en el feed del
// admin (una serie de mensajes de chat). trazabilidad_radar no lo tenia, asi
// que cuando preguntaban "por que no se envio esto", Sofi no podia leer la
// razon real y terminaba inventando una. Best-effort: si falta la migracion,
// se avisa una vez y el pipeline sigue — perder este dato de auditoria no
// puede costar la oportunidad.
async function guardarPolitica(orgId, signalId, { motivo = null, traza = [] } = {}) {
  if (!supabase) return true;
  const { error } = await supabase
    .from("group_signals")
    .update({ politica_motivo: motivo, politica_traza: traza, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", signalId);
  if (error) {
    if (esColumnaFaltante(error)) {
      console.error("[grupos] Falta la migracion 2026-08-20_radar_politica_motivo.sql: el motivo de la politica no se guarda.");
    } else {
      console.error("[grupos] No se pudo guardar el motivo de la politica:", error.message);
    }
    return false;
  }
  return true;
}

async function respuestasDesde(orgId, groupId, desdeIso) {
  if (!supabase) return { cantidad: 0, ultimaIso: null };
  const { data, error } = await supabase
    .from("group_signals")
    .select("respondida_at")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .eq("respuesta_modo", "auto")
    .gte("respondida_at", desdeIso)
    .order("respondida_at", { ascending: false });
  if (error) {
    if (esColumnaFaltante(error)) {
      console.error("[grupos] Falta la migracion 2026-08-16_radar_vivo.sql: no se puede verificar el limite de frecuencia.");
    } else {
      console.error("[grupos] No se pudo leer las respuestas recientes:", error.message);
    }
    return null;
  }
  return { cantidad: data.length, ultimaIso: data.length ? data[0].respondida_at : null };
}

// ── Limites del DM directo al colega (ver src/groups/politica.js#decidirDm) ──
//
// Las dos consultas de abajo alimentan ese freno. Comparten un criterio con
// respuestasDesde: cuentan filas con respuesta_modo='auto' — el mismo valor
// que ya usa el camino que publica DENTRO del grupo. No se agrega un valor
// nuevo a la columna (evita otra migracion sobre el check existente,
// db/migrations/2026-08-16_radar_vivo.sql) porque las dos vias nunca
// coexisten para la misma org: una org esta en modo 'asistido' (el UNICO que
// manda DMs) o en modo 'auto'/'sombra' (el que publica en el grupo), nunca
// los dos al mismo tiempo — ver organizations.js#modoDeRespuesta. Si algun
// dia coexistieran, el peor caso de esta reutilizacion es contar de mas y
// desviar un pedido de mas a la asesora — nunca al reves, y ningun limite de
// este radar descarta un pedido.
//
// Devuelven null (no un cero) cuando no se puede contar — la migracion no
// corrio, o la consulta fallo — para que decidirDm trate la duda como "no
// enviar" en vez de asumir que hay cupo.

// Cuantos DMs se le mandaron a ESTE colega hoy. Se identifica por
// `autor_telefono`, el mismo valor crudo que trae el mensaje del grupo (el
// @lid, o en el ~33% que ya llega resuelto, el telefono real) — es estable
// por colega dentro de la señal, que es lo unico que hace falta para "cuantas
// veces le escribimos hoy a esta persona", sin depender del telefono YA
// RESUELTO que solo existe en el momento del envio.
async function dmsHoyPorColega(orgId, autorTelefono, desdeIso) {
  if (!autorTelefono) return null;
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("group_signals")
    .select("id")
    .eq("org_id", orgId)
    .eq("autor_telefono", autorTelefono)
    .eq("respuesta_modo", "auto")
    .gte("respondida_at", desdeIso);
  if (error) {
    if (esColumnaFaltante(error)) {
      console.error("[grupos] Falta la migracion 2026-08-16_radar_vivo.sql: no se puede verificar el limite de DMs por colega.");
    } else {
      console.error("[grupos] No se pudo contar los DMs recientes al colega:", error.message);
    }
    return null;
  }
  return data.length;
}

// Cuantos DMs mando la linea HOY en total (cortacircuitos de volumen, ver
// politica.js#LIMITES_DM_DEFAULT). Filtrado por org_id como el resto del
// modulo: en este piloto una linea vinculada sirve a una sola organizacion
// (ver la nota de "Una sola sesion vinculada por org" en vivo.js#aprobarManual),
// asi que el conteo por org ES el conteo de la linea.
async function dmsHoyLinea(orgId, desdeIso) {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("group_signals")
    .select("id")
    .eq("org_id", orgId)
    .eq("respuesta_modo", "auto")
    .gte("respondida_at", desdeIso);
  if (error) {
    if (esColumnaFaltante(error)) {
      console.error("[grupos] Falta la migracion 2026-08-16_radar_vivo.sql: no se puede verificar el tope diario de DMs de la linea.");
    } else {
      console.error("[grupos] No se pudo contar los DMs de hoy:", error.message);
    }
    return null;
  }
  return data.length;
}

// El pedido de grupo MAS RECIENTE de este remitente, si lo hay — el cruce que
// necesita el inbox de DM (Juan, 2026-08-21: "hacer un cruce de datos de
// cuales mensajes respondio el bot y cuales el colega de regreso le
// respondio al numero de natalia"). Ver src/groups/dm.js.
async function buscarPorTelefono(orgId, telefono) {
  if (!telefono) return null;
  if (!supabase) {
    return (
      memory.groupSignals
        .filter((s) => s.org_id === orgId && s.autor_telefono === telefono && s.clase === "demanda")
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null
    );
  }
  const { data, error } = await supabase
    .from("group_signals")
    .select("id, texto_original, zona, tipo, operacion, created_at, matches, respuesta_refs, respondida_at")
    .eq("org_id", orgId)
    .eq("autor_telefono", telefono)
    .eq("clase", "demanda")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[grupos] No se pudo buscar la señal por telefono:", error.message);
    return null;
  }
  return data;
}

module.exports = {
  create, list, setEstado, resumen, marcarEnviada, ultimaFechaImportada,
  pendientesDigest, marcarDigest, revertirDigest,
  marcarRespondida, respuestasDesde, guardarRevalidacion, marcarAvisoEnviado,
  guardarPolitica, obtenerPorId, calladosPendientes, buscarPorTelefono, aprobadasSinAvisar,
  findByWamid, pendientesDeAviso, candidatosRecordatorio, claimRecordatorio,
  candidatosEscaladoSilencio, claimEscaladoSilencio,
  dmsHoyPorColega, dmsHoyLinea,
  CLASES, ORIGENES, MODOS_RESPUESTA, _resetBlindaje,
};

// Solo para tests: el flag de "falta la migracion" es de proceso.
function _resetBlindaje() {
  faltanColumnas = false;
  columnasAusentes.clear();
}

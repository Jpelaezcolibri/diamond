// Import de exports nativos de WhatsApp — la via segura para leer los grupos.
//
// El asesor exporta el chat desde su telefono (⋮ → Exportar chat → Sin
// archivos) y sube el .txt al CRM. Es una funcion nativa de WhatsApp: no hay
// cliente no oficial, no hay dispositivo vinculado, no hay nada que WhatsApp
// pueda sancionar. Despues del baneo del 2026-07-30 esa es toda la diferencia
// que importa.
//
// El embudo es exactamente el mismo que corria en vivo — parse → corte →
// dedup → prefiltro → clasificacion → cruce — porque el valor nunca estuvo en
// el transporte.
//
// DOS DECISIONES QUE LO DEFINEN:
//
// 1. EL IMPORT NO AVISA A NADIE. Persiste señales y archiva ofertas; punto.
//    Un export de 30 dias trae decenas de demandas, y avisarlas todas de golpe
//    le vuela el WhatsApp al asesor con avisos de cosas que pasaron hace tres
//    semanas. Quien notifica es el digest diario, que agrupa.
//
// 2. LA FRESCURA ES LA DEL MENSAJE, NO LA DE LA SUBIDA. Una oferta que el
//    colega publico hace 20 dias entra con esa fecha, no con la de hoy: si
//    entrara como fresca, `ally_properties` se la recomendaria a un cliente
//    real durante una semana mas. Es el mismo dano de reputacion que la
//    caducidad de 7 dias existe para evitar.

const crypto = require("node:crypto");

const { parseExport, rangoDeFechas } = require("./parse-export");
const { prefilter } = require("./prefilter");
const { classify } = require("./classify");
const { cruzar } = require("./match");
const { guardarOferta } = require("./recomendar");
const { plano } = require("./texto");
const groupSignals = require("../data/group-signals");
const whatsappGroups = require("../data/whatsapp-groups");

// Corte temporal por defecto. Un export trae TODO el historial del grupo —
// pueden ser anios. Nada de eso sirve: una demanda de hace seis meses ya se
// resolvio y una oferta de hace seis meses ya se vendio. Solo cuesta tokens.
const DIAS_DEFAULT = Number(process.env.GROUPS_IMPORT_DIAS_DEFAULT || 30);

// Tope duro de mensajes crudos por corrida, despues del corte. Es la unica
// defensa real contra un costo sorpresa: sin el, subir la linea completa de un
// asesor (1.600 mensajes/dia x 3 meses) son ~150.000 mensajes y decenas de
// dolares en una sola tarde.
const MAX_MENSAJES = Number(process.env.GROUPS_IMPORT_MAX_MENSAJES || 20000);

// WhatsApp nombra los exports "Chat de WhatsApp con <grupo>.txt".
function nombreDeArchivo(nombre) {
  return String(nombre || "")
    .replace(/\.txt$/i, "")
    .replace(/^Chat de WhatsApp con /i, "")
    .replace(/^WhatsApp Chat with /i, "")
    .trim() || "Grupo sin nombre";
}

// Id estable y determinista del mensaje dentro de un grupo.
//
// `group_signals` tiene un indice unico (org_id, group_id, wa_message_id), y
// un .txt no trae ningun id de WhatsApp. Derivarlo del contenido hace que
// re-subir el mismo export —o uno mas largo que lo contenga— no duplique ni
// una fila ni un centavo de IA: el insert choca contra el indice y `create()`
// lo reporta como duplicado, que es el comportamiento que ya existia.
function idDeMensaje(m) {
  const semilla = `${m.grupo}|${m.fechaIso || ""}|${m.autor || ""}|${plano(m.texto)}`;
  return "export:" + crypto.createHash("sha256").update(semilla).digest("hex").slice(0, 40);
}

// Huella de CONTENIDO, sin el grupo: los colegas difunden el mismo aviso en
// diez grupos a la vez. En la captura en vivo esto era un buffer con TTL; en
// un lote es un Set y sale gratis. De 494 señales medidas en vivo, 312 eran
// repeticiones — es el mayor ahorro de IA del pipeline despues del prefiltro.
function huella(m) {
  return crypto.createHash("sha256")
    .update(`${plano(m.autor)}|${plano(m.texto)}`)
    .digest("hex");
}

function deduplicar(mensajes) {
  const vistos = new Set();
  const unicos = [];
  for (const m of mensajes) {
    const h = huella(m);
    if (vistos.has(h)) continue;
    vistos.add(h);
    unicos.push(m);
  }
  return { unicos, repetidos: mensajes.length - unicos.length };
}

function aplicarCorte(mensajes, dias) {
  if (!dias) return { dentro: mensajes, fuera: 0 };
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  // Un mensaje sin fecha no se puede fechar y por lo tanto no se puede
  // garantizar que sea reciente: se descarta. Mismo criterio que el corte
  // temporal del pareo en vivo.
  const dentro = mensajes.filter((m) => m.fechaIso && m.fechaIso >= desde);
  return { dentro, fuera: mensajes.length - dentro.length };
}

// archivos: [{ nombre, contenido }]. Devuelve las metricas del embudo.
async function importar(org, archivos, { dias = DIAS_DEFAULT, onProgreso = () => {} } = {}) {
  const stats = {
    archivos: archivos.length,
    crudos: 0, fueraDeCorte: 0, repetidos: 0,
    prefiltrados: 0, aClasificar: 0,
    demandas: 0, ofertas: 0, ruido: 0,
    señales: 0, duplicadas: 0, ofertasArchivadas: 0,
    demandasConMatch: 0,
    lotesFallidos: 0, reintentos: 0, costoUsd: 0,
    grupos: [], rango: null,
  };

  // ── Parseo. Cada archivo es un grupo; el grupo se crea (o se reusa) como
  // grupo virtual para poder colgarle las señales.
  onProgreso({ fase: "leyendo", procesados: 0, total: archivos.length });
  let mensajes = [];
  for (const [i, archivo] of archivos.entries()) {
    const nombreGrupo = archivo.grupo || nombreDeArchivo(archivo.nombre);
    const grupo = await whatsappGroups.asegurarGrupoVirtual(org.id, {
      prefijo: "export",
      nombre: nombreGrupo,
    });
    const delArchivo = parseExport(archivo.contenido, { grupo: nombreGrupo });
    for (const m of delArchivo) m.groupId = grupo.id;
    mensajes.push(...delArchivo);
    stats.grupos.push({ nombre: nombreGrupo, id: grupo.id, mensajes: delArchivo.length });
    onProgreso({ fase: "leyendo", procesados: i + 1, total: archivos.length });
  }
  stats.crudos = mensajes.length;
  stats.rango = rangoDeFechas(mensajes);

  // ── Corte temporal
  const corte = aplicarCorte(mensajes, dias);
  mensajes = corte.dentro;
  stats.fueraDeCorte = corte.fuera;

  if (mensajes.length > MAX_MENSAJES) {
    const e = new Error(
      `El export tiene ${mensajes.length.toLocaleString("es-CO")} mensajes dentro del corte de ${dias} días ` +
      `(el máximo por corrida es ${MAX_MENSAJES.toLocaleString("es-CO")}). Acortá el rango de días o subí menos grupos a la vez.`
    );
    e.code = "DEMASIADOS_MENSAJES";
    throw e;
  }

  // ── Dedup de contenido
  const dedup = deduplicar(mensajes);
  mensajes = dedup.unicos;
  stats.repetidos = dedup.repetidos;

  // ── Prefiltro (gratis: lexico, precio, zona)
  onProgreso({ fase: "filtrando", procesados: 0, total: mensajes.length });
  const { pasan, stats: pre } = prefilter(mensajes);
  stats.prefiltrados = pre.descartados;
  stats.aClasificar = pasan.length;

  if (pasan.length === 0) return stats;

  // ── Clasificacion con IA
  onProgreso({ fase: "clasificando", procesados: 0, total: pasan.length });
  const clas = await classify(pasan, {
    onProgreso: (lote, total) =>
      onProgreso({ fase: "clasificando", procesados: lote, total, lotes: true }),
  });
  stats.lotesFallidos = clas.lotesFallidos;
  stats.reintentos = clas.reintentos || 0;
  stats.costoUsd = clas.uso.costoUsd;

  // ── Cruce contra el inventario
  onProgreso({ fase: "cruzando", procesados: 0, total: clas.clasificados.length });
  const { demandas, ofertas, ruido } = await cruzar(clas.clasificados, { org });
  stats.demandas = demandas.length;
  stats.ofertas = ofertas.length;
  stats.ruido = ruido;
  stats.demandasConMatch = demandas.filter((d) => (d.matches || []).length > 0).length;

  // ── Persistencia
  onProgreso({ fase: "guardando", procesados: 0, total: demandas.length + ofertas.length });
  let guardados = 0;
  for (const señal of [...demandas, ...ofertas]) {
    try {
      const { duplicado } = await persistirSeñal(org, señal);
      if (duplicado) stats.duplicadas++;
      else stats.señales++;
    } catch (e) {
      console.error("[radar] No se pudo guardar una señal:", e.message);
    }
    onProgreso({ fase: "guardando", procesados: ++guardados, total: demandas.length + ofertas.length });
  }

  // ── Ofertas utilizables → red de aliados, con la fecha REAL del mensaje
  for (const o of ofertas) {
    if (!o.utilizable) continue;
    try {
      await guardarOferta(org, o, { vistoEn: o.mensaje?.fechaIso || null });
      stats.ofertasArchivadas++;
    } catch (e) {
      console.error("[radar] No se pudo archivar una oferta:", e.message);
    }
  }

  return stats;
}

async function persistirSeñal(org, c) {
  const m = c.mensaje;
  return groupSignals.create(org.id, {
    group_id: m.groupId,
    wa_message_id: idDeMensaje(m),
    autor_nombre: m.autor || null,
    // Un .txt trae el nombre con el que el asesor tiene agendado al colega,
    // nunca el numero. Se asume y se declara: el contacto se resuelve por
    // nombre + grupo, y la pantalla del CRM ya sabe no ofrecer un boton de
    // marcar cuando no hay telefono utilizable.
    autor_telefono: null,
    clase: c.clase,
    confianza: c.confianza,
    operacion: c.operacion || null,
    tipo: c.tipo || null,
    zona: c.zona || null,
    ciudad: c.ciudad || null,
    precio_min: c.precio_min || null,
    precio_max: c.precio_max || null,
    habitaciones: c.habitaciones || null,
    contacto: c.contacto || null,
    texto_original: m.texto || null,
    matches: c.matches || [],
    origen: "export",
    fecha_mensaje: m.fechaIso || null,
  });
}

module.exports = {
  importar, idDeMensaje, huella, deduplicar, aplicarCorte, nombreDeArchivo,
  DIAS_DEFAULT, MAX_MENSAJES,
};

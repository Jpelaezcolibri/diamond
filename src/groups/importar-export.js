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


const { parseExport, rangoDeFechas } = require("./parse-export");
const epe = require("../../epe/core");
const { aplicarCorte } = epe;
const { idDeMensaje, huella } = require("../../epe/core/hash");
const { classify } = require("./classify");
const { cruzar } = require("./match");
const { guardarOferta } = require("./ofertas");
const groupSignals = require("../data/group-signals");
const whatsappGroups = require("../data/whatsapp-groups");
const organizations = require("../data/organizations");

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

// archivos: [{ nombre, contenido }]. Devuelve las metricas del embudo.
//
// `incremental` (default) hace que cada grupo arranque donde quedo la vez
// anterior. Es lo que vuelve viable exportar dos veces al dia: sin esto, cada
// carga reclasifica —y vuelve a pagar— todo el rango elegido.
async function importar(org, archivos, { dias = DIAS_DEFAULT, incremental = true, onProgreso = () => {} } = {}) {
  // El interruptor se consulta ACA y no en el endpoint: clasificar es la parte
  // cara del embudo, y la garantia tiene que valer venga la llamada de donde
  // venga —la pantalla, un script, un worker futuro—. Se relee de la base en
  // vez de confiar en el `org` recibido, que a veces es solo `{ id }`.
  if (!(await organizations.radarActivo(org.id))) {
    const err = new Error(
      "El motor de Radar está apagado. Prendelo en la pantalla de Grupos para volver a procesar."
    );
    err.code = "RADAR_APAGADO";
    throw err;
  }

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

  // ── Parseo y corte, archivo por archivo.
  //
  // El corte se aplica POR GRUPO y no sobre la pila junta, porque la marca de
  // agua es de cada grupo: uno puede estar leido hasta esta mañana y otro ser
  // la primera vez que se sube.
  onProgreso({ fase: "leyendo", procesados: 0, total: archivos.length });
  let mensajes = [];
  let crudos = 0;
  let fuera = 0;
  const todosLosCrudos = [];

  for (const [i, archivo] of archivos.entries()) {
    const nombreGrupo = archivo.grupo || nombreDeArchivo(archivo.nombre);
    const grupo = await whatsappGroups.asegurarGrupoVirtual(org.id, {
      prefijo: "export",
      nombre: nombreGrupo,
    });
    const delArchivo = parseExport(archivo.contenido, { grupo: nombreGrupo });
    for (const m of delArchivo) m.groupId = grupo.id;
    crudos += delArchivo.length;
    todosLosCrudos.push(...delArchivo);

    // Hasta donde se leyo este grupo la vez pasada. Sin esto, re-exportar
    // vuelve a pagarle a la IA por todo el rango: el dedup de señales evita la
    // fila repetida, pero recien despues de clasificar.
    const yaLeido = incremental
      ? await groupSignals.ultimaFechaImportada(org.id, grupo.id).catch(() => null)
      : null;

    const corte = aplicarCorte(delArchivo, dias, yaLeido);
    mensajes.push(...corte.dentro);
    fuera += corte.fuera;

    stats.grupos.push({
      nombre: nombreGrupo,
      id: grupo.id,
      mensajes: delArchivo.length,
      nuevos: corte.dentro.length,
      leidoHasta: yaLeido,
    });
    onProgreso({ fase: "leyendo", procesados: i + 1, total: archivos.length });
  }

  stats.crudos = crudos;
  stats.fueraDeCorte = fuera;
  stats.rango = rangoDeFechas(todosLosCrudos);

  // ── Nivel local (EPE): tope, dedup y prefiltro.
  //
  // Es exactamente el mismo codigo que corre —o correra— en el navegador del
  // asesor. No hay dos copias: el bundle de la extension se genera de este
  // mismo modulo, asi que el servidor y el sensor no pueden divergir.
  onProgreso({ fase: "filtrando", procesados: 0, total: mensajes.length });

  let local;
  try {
    local = await epe.procesar(mensajes, { maxMensajes: MAX_MENSAJES });
  } catch (e) {
    if (e.codigo === "DEMASIADOS_MENSAJES") {
      // Se re-lanza con el texto que espera el CRM: el nucleo no sabe de
      // "dias" ni de "grupos", que son conceptos de esta pantalla.
      const err = new Error(
        `El export tiene ${e.cuantos.toLocaleString("es-CO")} mensajes dentro del corte de ${dias} días ` +
        `(el máximo por corrida es ${MAX_MENSAJES.toLocaleString("es-CO")}). Acortá el rango de días o subí menos grupos a la vez.`
      );
      err.code = "DEMASIADOS_MENSAJES";
      throw err;
    }
    throw e;
  }

  const pasan = local.aEnviar;
  stats.repetidos = local.metricas.repetidos;
  stats.prefiltrados = local.metricas.prefiltrados;
  stats.aClasificar = pasan.length;
  // La proporcion de lo que NUNCA salio del dispositivo. Es la metrica que
  // vuelve medible el principio de minimizacion de datos.
  stats.tasaDescarteLocal = local.metricas.tasaDescarte;

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
  // Solo el CONTEO. `cruzar` devuelve los mensajes de ruido enteros, y estas
  // stats viajan al CRM: mandar el array meteria el texto crudo de mensajes
  // privados de terceros en una respuesta HTTP. El ruido muere en memoria.
  stats.ruido = ruido.length;
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
      await guardarOferta(org, o, { vistoEn: o.mensaje?.instanteIso || null });
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
    // `await` obligatorio: idDeMensaje es async desde que el hash pasa por
    // WebCrypto. Sin el, aca viajaba una Promise como wa_message_id y TODAS las
    // señales de una corrida colisionaban entre si como duplicadas — sin error,
    // solo con señales que desaparecian.
    wa_message_id: await idDeMensaje(m),
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
    fecha_mensaje: m.instanteIso || null,
  });
}

module.exports = {
  importar, idDeMensaje, huella, aplicarCorte, nombreDeArchivo,
  DIAS_DEFAULT, MAX_MENSAJES,
};

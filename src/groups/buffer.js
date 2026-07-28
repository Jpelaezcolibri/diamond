// Buffer de mensajes en vuelo, entre el webhook y la IA.
//
// POR QUE EXISTE: en vivo los mensajes llegan de a uno. Clasificar uno por uno
// destruye la economia del diseno — el prompt de sistema se paga una vez por
// mensaje y el mes pasa de centavos a decenas de dolares. El buffer acumula y
// clasifica de a 20, igual que el banco de pruebas offline.
//
// POR QUE ES EN MEMORIA Y NO UNA TABLA DE PENDIENTES: la invariante de
// privacidad #4 dice que lo que no es senal no se persiste. Si guardaramos los
// mensajes crudos esperando clasificacion, el contenido privado tocaria disco
// aunque despues lo borraramos. El costo de esta decision es que un reinicio
// pierde lo que haya en el buffer: unos minutos de mensajes. Es el lado
// correcto del intercambio — la promesa que le hicimos al asesor vale mas que
// unos mensajes sueltos en modo sombra.

// Se importan los MODULOS, no las funciones sueltas: destructurar congela la
// referencia original y deja los tests sin forma de mockear (mismo motivo que
// documenta test/ally-tool.test.js).
const clasificador = require("./classify");
const cruce = require("./match");
const groupSignals = require("../data/group-signals");

const { TAMANO_LOTE } = clasificador;

const EDAD_MAX_MS = Number(process.env.GROUPS_FLUSH_MIN || 5) * 60 * 1000;
const TICK_MS = 60 * 1000;

// orgId -> { items: [], primeroAt: number, org }
const buffers = new Map();
let flushing = false;
let timer = null;

const metricas = { recibidos: 0, prefiltrados: 0, clasificados: 0, senales: 0, duplicados: 0, ruido: 0, costoUsd: 0, lotesFallidos: 0 };

function estado() {
  const pendientes = [...buffers.values()].reduce((n, b) => n + b.items.length, 0);
  return { ...metricas, pendientes };
}

// Contadores del canal. Solo cuentan: nunca reciben ni guardan el texto de un
// mensaje descartado.
function contar(clave, n = 1) {
  if (clave in metricas) metricas[clave] += n;
}

// item: { id, grupo, groupId, autor, autorTelefono, texto, waMessageId }
function push(org, item) {
  let b = buffers.get(org.id);
  if (!b) {
    b = { items: [], primeroAt: Date.now(), org };
    buffers.set(org.id, b);
  }
  b.items.push(item);
  if (b.items.length >= TAMANO_LOTE) {
    flush().catch((e) => console.error("[grupos] flush:", e.message));
  }
}

function vencido(b) {
  return b.items.length > 0 && Date.now() - b.primeroAt >= EDAD_MAX_MS;
}

// Vacia los buffers que alcanzaron tamaño o edad. `forzar` los vacia todos
// (util en tests y en el apagado).
async function flush({ forzar = false } = {}) {
  if (flushing) return { procesados: 0 };
  flushing = true;
  let procesados = 0;

  try {
    for (const [orgId, b] of [...buffers.entries()]) {
      if (!forzar && b.items.length < TAMANO_LOTE && !vencido(b)) continue;

      const lote = b.items;
      buffers.delete(orgId); // se saca YA: lo que entre mientras corre la IA va al buffer siguiente
      if (lote.length === 0) continue;

      procesados += await procesarLote(b.org, lote);
    }
  } finally {
    flushing = false;
  }
  return { procesados };
}

async function procesarLote(org, lote) {
  const { clasificados, uso, lotesFallidos } = await clasificador.classify(lote);
  metricas.clasificados += clasificados.length;
  metricas.costoUsd += uso.costoUsd || 0;
  metricas.lotesFallidos += lotesFallidos;

  // El ruido muere aca. No se persiste, no se registra su texto: solo se cuenta.
  const senales = clasificados.filter((c) => c.clase === "demanda" || c.clase === "oferta");
  metricas.ruido += clasificados.length - senales.length;
  if (senales.length === 0) return 0;

  const { demandas, ofertas } = await cruce.cruzar(senales, { org });

  let guardadas = 0;
  for (const s of [...demandas, ...ofertas]) {
    try {
      const { duplicado } = await groupSignals.create(org.id, {
        group_id: s.mensaje.groupId,
        wa_message_id: s.mensaje.waMessageId,
        autor_nombre: s.mensaje.autor,
        autor_telefono: s.mensaje.autorTelefono,
        clase: s.clase,
        confianza: s.confianza,
        operacion: s.operacion,
        tipo: s.tipo,
        zona: s.zona,
        ciudad: s.ciudad,
        precio_min: s.precio_min,
        precio_max: s.precio_max,
        habitaciones: s.habitaciones,
        contacto: s.contacto,
        texto_original: s.mensaje.texto,
        matches: s.matches || [],
      });
      if (duplicado) metricas.duplicados++;
      else { guardadas++; metricas.senales++; }
    } catch (e) {
      console.error("[grupos] No se pudo guardar la señal:", e.message);
    }
  }

  console.log(`[grupos] lote de ${lote.length}: ${demandas.length} demanda(s), ${ofertas.length} oferta(s), ${guardadas} guardada(s)`);
  return guardadas;
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    flush().catch((e) => console.error("[grupos] flush periódico:", e.message));
  }, TICK_MS);
  if (timer.unref) timer.unref();
  console.log(`[grupos] buffer activo — lotes de ${TAMANO_LOTE} o ${EDAD_MAX_MS / 60000} min`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// Solo para tests.
function _reset() {
  buffers.clear();
  flushing = false;
  for (const k of Object.keys(metricas)) metricas[k] = 0;
}

module.exports = { push, flush, start, stop, estado, contar, _reset, EDAD_MAX_MS };

// La bandeja de salida del radar: junta lo pendiente y lo manda de a un
// mensaje por asesora.
//
// POR QUE EXISTE (Juan, 2026-09-02). Hasta hoy cada oportunidad y cada oferta
// se enviaban EN LINEA, en el mismo instante en que se detectaban. Con el
// volumen real eso se volvio ruido y, peor, empezo a costar entregas: ese dia,
// en menos de tres horas, salieron 23 mensajes a Natalia y 14 a Catherine, y
// WhatsApp rechazo cuatro con `(#131056) pair rate limit hit` — el limite de
// frecuencia entre un numero de negocio y una persona. Tres ofertas del mismo
// mandato salieron en el mismo minuto.
//
// COMO FUNCIONA. Corre cada minuto. Para cada asesora con algo pendiente:
//
//   · Si se le mando algo hace menos de VENTANA_MIN, espera. Lo acumulado
//     sale junto en la proxima pasada.
//   · Un solo pendiente -> el mensaje completo de siempre, sin cambios. Con
//     trafico bajo el aviso sale en menos de un minuto y se ve igual que
//     antes; la demora solo aparece cuando hay rafaga, que es cuando molesta.
//   · Dos o mas -> un digest agrupado por colega y por mandato
//     (src/groups/digest-avisos.js).
//
// LO QUE NO TOCA: el DM automatico al colega. Ese sigue saliendo uno por uno,
// inmediato, desde vivo.js#asistir, con sus reglas de validacion intactas.
//
// POR QUE NO HAY TABLA NUEVA. El estado "pendiente de avisar" ya vivia en la
// base: una señal aprobada por Sofi con `enviado_at` en null, y una alerta de
// mandato con `entregado = false`. Lo unico que cambio es que ahora esos dos
// pasos —registrar y enviar— ocurren en momentos distintos. Si el bot se
// reinicia, la cola sobrevive porque nunca estuvo en memoria.
//
// SI EL ENVIO FALLA no se marca nada: el pendiente queda y se reintenta en la
// corrida siguiente. Es la diferencia con el envio en linea, donde un fallo se
// perdia salvo por el escalado.

const config = require("../config");
const organizations = require("../data/organizations");
const advisors = require("../data/advisors");
const groupSignals = require("../data/group-signals");
const mandatosData = require("../data/mandatos");
const whatsappGroups = require("../data/whatsapp-groups");
const revalidar = require("../groups/revalidar");
const alertaAsesor = require("../groups/alerta-asesor");
const digest = require("../groups/digest-avisos");
const directorio = require("../groups/directorio");
const { entregarConRespaldo } = require("../lib/entrega-asesor");
const ritmo = require("../lib/ritmo-avisos");

const INTERVALO_MS = 60 * 1000;
// Cuanto se espera antes de volver a escribirle a la MISMA asesora. No es un
// tope de volumen: es el tiempo durante el cual lo que llegue se acumula para
// salir junto.
const VENTANA_MIN = ritmo.VENTANA_MIN;
// Una señal mas vieja que esto ya no se avisa: el colega consiguio lo que
// buscaba y un aviso tardio solo gasta la ventana de WhatsApp.
const VIGENCIA_HORAS = Number(process.env.AVISOS_VIGENCIA_HORAS || 12);

let timer = null;
let corriendo = false;

// Reconstruye el aviso completo de UN pedido, con las mismas piezas que usaba
// vivo.js#asistir: el veredicto y los matches estan guardados en la señal, y
// el telefono se vuelve a resolver contra el directorio (que desde el
// calentamiento de las 20 s ya esta en memoria, asi que no cuesta una llamada).
async function textoDePedido(org, senal, grupos, sesion) {
  const grupo = grupos.get(senal.group_id) || {};
  const telefono = await directorio
    .telefonoDe(org.id, senal.autor_telefono, { sesion, jid: grupo.jid })
    .catch(() => null);
  return alertaAsesor.construir(
    {
      grupo_nombre: grupo.nombre || grupo.jid || null,
      autor_nombre: senal.autor_nombre,
      autor_telefono: senal.autor_telefono,
      texto_original: senal.texto_original,
      operacion: senal.operacion,
      tipo: senal.tipo,
      zona: senal.zona,
      zonas: senal.zonas,
      precio_max: senal.precio_max,
      habitaciones: senal.habitaciones,
      flexible_habitaciones: senal.flexible_habitaciones,
      area_min: senal.area_min,
      banos: senal.banos,
      garajes: senal.garajes,
      estrato: senal.estrato,
    },
    senal.revalidacion,
    senal.matches || [],
    telefono,
    org,
    senal.politica_motivo
  );
}

// Los reparos que ya trae el texto del aviso de mandato, en corto: es lo que
// distingue "cumple todo" de "apenas se acerca" dentro del digest.
function reparosDe(texto) {
  const linea = String(texto || "").split("\n").find((l) => l.trim().startsWith("Ojo:"));
  if (!linea) return [];
  return linea
    .split("Ojo:")
    .map((t) => t.replace(/Sin verificar:.*$/, "").trim().replace(/\.$/, ""))
    .filter(Boolean)
    .slice(0, 2);
}

async function procesarOrg(org, ahora) {
  const asesor = await advisors.findAsesorPrincipalRadar(org).catch(() => null);
  if (!asesor || !asesor.phone) return null;
  if (!ritmo.puedeEnviar(asesor.id, ahora)) return null;

  const desdeIso = new Date(ahora - VIGENCIA_HORAS * 3600 * 1000).toISOString();
  const [senales, alertas] = await Promise.all([
    groupSignals.aprobadasSinAvisar(org.id, { desdeIso }).catch((e) => {
      console.warn("[avisos] no se pudieron leer los pedidos pendientes:", e.message);
      return [];
    }),
    mandatosData.pendientes(org.id).catch((e) => {
      console.warn("[avisos] no se pudieron leer las alertas de mandato pendientes:", e.message);
      return [];
    }),
  ]);
  // Solo las que el veredicto de Sofi aprueba. La consulta trae todas las que
  // tienen veredicto; el criterio de aprobacion vive en revalidar.js y no se
  // duplica aca.
  const pedidos = senales.filter((s) => revalidar.apruebaAviso(s.revalidacion));
  if (pedidos.length === 0 && alertas.length === 0) return null;

  const grupos = new Map((await whatsappGroups.listGroups(org.id).catch(() => [])).map((g) => [g.id, g]));
  const sesiones = await whatsappGroups.listSessions(org.id).catch(() => []);
  const sesion = (sesiones.find((s) => s.estado === "activa") || sesiones[0] || {}).nombre || null;

  const total = pedidos.length + alertas.length;
  let texto;

  if (total === 1) {
    // Sin cambios respecto de antes: un solo pendiente sale con su mensaje
    // completo. La agrupacion existe para la rafaga, no para el goteo.
    texto = pedidos.length
      ? await textoDePedido(org, pedidos[0], grupos, sesion)
      : alertas[0].texto;
  } else {
    const mandatos = new Map(
      (await mandatosData.listarActivos(org.id).catch(() => [])).map((m) => [m.id, m.cliente_nombre])
    );
    texto = digest.construir(
      String(asesor.name || "").split(" ")[0],
      pedidos.map((s) => ({
        id: s.id,
        colega: s.autor_nombre,
        operacion: s.operacion,
        tipo: s.tipo,
        zona: Array.isArray(s.zonas) && s.zonas.length ? s.zonas.join(", ") : s.zona,
        precioMax: s.precio_max,
        utiles: (s.revalidacion && s.revalidacion.refs_utiles ? s.revalidacion.refs_utiles.length : 0),
        dudosas: (s.revalidacion && s.revalidacion.refs_dudosas ? s.revalidacion.refs_dudosas.length : 0),
      })),
      alertas.map((a) => ({
        id: a.id,
        mandato: mandatos.get(a.mandato_id) || "un cliente",
        zona: (String(a.texto || "").match(/—\s*([^\n$]+)/) || [])[1]?.trim() || null,
        precio: (String(a.texto || "").match(/\$[\d.]+/) || [])[0] || null,
        habitaciones: Number((String(a.texto || "").match(/(\d+)\s*alcobas?/) || [])[1]) || null,
        reparos: reparosDe(a.texto),
        cumpleTodo: !/Ojo:/.test(String(a.texto || "")),
      }))
    );
  }

  if (!texto) return null;

  // Con respaldo (Juan, 2026-09-02: "si la ventana de una esta cerrada enviar
  // a la ventana de la otra... que nunca se pierda ninguna posibilidad de
  // hacer negocios"). Si la ventana de la asesora esta cerrada, el aviso se
  // entrega a otra del equipo en vez de perderse.
  const envio = await entregarConRespaldo(org, asesor, texto);
  if (!envio.ok) {
    // No se marca nada: queda pendiente y se reintenta en la proxima pasada.
    console.warn(`[avisos] no se pudo entregar el aviso a ${asesor.name}: ${envio.error}`);
    return { ok: false, total };
  }

  // El ritmo se le cuenta a QUIEN LO RECIBIO: si lo tomo una suplente, la
  // asesora original no gasto su turno y su proximo aviso puede salir ya.
  ritmo.registrarEnvio(envio.advisor.id, ahora);
  for (const s of pedidos) {
    await groupSignals
      // El destinatario REAL, no a quien le tocaba: si respondio una suplente,
      // el recordatorio y el escalado tienen que ir a ella.
      .marcarAvisoEnviado(org.id, s.id, { wamid: envio.wamid || null, advisorId: envio.advisor.id })
      .catch((e) => console.warn("[avisos] no se pudo marcar la señal como avisada:", e.message));
  }
  for (const a of alertas) {
    await mandatosData
      .marcarEntrega(org.id, a.id, { entregado: true, via: "digest", error: null, texto: a.texto })
      .catch((e) => console.warn("[avisos] no se pudo marcar la alerta como entregada:", e.message));
  }
  console.log(
    `[avisos] ${envio.advisor.name}${envio.suplente ? ` (suplente de ${asesor.name})` : ""}: ` +
      `1 mensaje con ${total} pendiente(s) (${pedidos.length} pedidos, ${alertas.length} ofertas).`
  );
  return { ok: true, total };
}

async function runOnce(ahora = Date.now()) {
  const orgs = await organizations.listActive();
  const salidas = [];
  for (const org of orgs) {
    const r = await procesarOrg(org, ahora).catch((e) => {
      console.error(`[avisos] fallo la salida de ${org.id}:`, e.message);
      return null;
    });
    if (r) salidas.push(r);
  }
  return salidas;
}

function start() {
  if (!config.supabaseUrl) return null;
  if (timer) return timer;
  timer = setInterval(async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await runOnce();
    } finally {
      corriendo = false;
    }
  }, INTERVALO_MS);
  console.log(`[avisos] bandeja de salida activa — como maximo 1 mensaje por asesora cada ${VENTANA_MIN} min`);
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, runOnce, procesarOrg, VENTANA_MIN, VIGENCIA_HORAS };

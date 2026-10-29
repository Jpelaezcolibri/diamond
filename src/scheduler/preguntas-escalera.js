// La escalera de las preguntas al asesor (spec 2026-10-25 §5.3). Cada tick
// mira las pendientes: sin asesor -> se asigna; 15 min sin respuesta -> se le
// repite; 60 min -> pasa al siguiente del ciclo. Con el ultimo aviso del tope
// (PREGUNTA_MAX_AVISOS) se avisa por la campana a todo el ciclo y la escalera
// calla: la pregunta sigue en "Para atender" del CRM. Pausa de noche y domingo.
// Solo rota entre las asesoras con la ventana de 24 h abierta (caso 2026-10-29:
// 2 de cada 3 avisos fallaban con 131047 en Claudia y Catherine); si ninguna la
// tiene abierta, va a todo el ciclo solo por campana + aviso_app. El tope no
// cuenta los avisos que WhatsApp rechazo.
const { pasoDePregunta } = require("../lib/preguntas-escalera");
const pa = require("../lib/pregunta-asesor");

const INTERVALO_MIN = Number(process.env.PREGUNTA_INTERVALO_MIN || 5);
const MAX_ACCIONES = 20;

function canal(deps) {
  return {
    datos: deps.datos || require("../data/preguntas-asesor"),
    org: deps.org || ((id) => require("../data/organizations").findById(id)),
    ciclo: deps.ciclo || ((orgId) => require("../data/rotacion-citas").asesoresDelCiclo(orgId)),
    lead: deps.lead || ((orgId, id) => require("../data/leads").findById(orgId, id)),
    avisar: deps.avisar || ((args) => pa.avisar(args)),
    notificar: deps.notificar || ((...a) => require("../notifications/notificar").notificar(...a)),
    ventanaAbierta: deps.ventanaAbierta || ventanaAbierta,
  };
}

// ¿Le escribio la asesora a Sofi en las ultimas 24 h? Mismo camino que
// scheduler/ventana-asesora.js: su lead "asesor" -> su conversacion.
async function ventanaAbierta(org, advisor, ahora = new Date()) {
  const tel = String((advisor && advisor.phone) || "").replace(/D/g, "");
  if (!tel) return false;
  const lead = await require("../data/leads").findOrCreate(org.id, tel, "asesor");
  const conversations = require("../data/conversations");
  const conv = await conversations.findOrCreate(org.id, lead.id, null);
  return conversations.hayMensajeEntranteDespues(conv.id, new Date(ahora.getTime() - 24 * 3600 * 1000).toISOString());
}

// Ultimo aviso del tope: una sola nota por la campana a cada asesor del ciclo.
// Despues la escalera no vuelve a escribir por esta pregunta.
async function cerrarEscalera(c, org, ciclo, p, res) {
  res.agotadas++;
  for (const advisor of ciclo) {
    await c.notificar({
      orgId: org.id, advisor, tipo: "pregunta_asesor",
      titulo: "Pregunta de un colega sin respuesta: no se va a repetir más",
      cuerpo: `${p.pregunta}\nRespóndela o descártala en "Para atender" del CRM.`, leadId: p.lead_id,
    }).catch(() => {});
  }
}

let corriendo = false;
async function runOnce({ ahora = new Date(), deps = {} } = {}) {
  const res = { asignadas: 0, rotadas: 0, reavisadas: 0, agotadas: 0 };
  if (corriendo) return res;
  corriendo = true;
  const c = canal(deps);
  try {
    const pendientes = await c.datos.pendientes().catch((e) => {
      console.error("[preguntas-escalera] no se pudieron leer las preguntas:", e.message);
      return [];
    });
    const porOrg = new Map();
    let acciones = 0;
    for (const p of pendientes) {
      if (acciones >= MAX_ACCIONES) break;
      try {
        if (!porOrg.has(p.org_id)) {
          const org = await c.org(p.org_id).catch(() => null);
          const ciclo = org ? await c.ciclo(org.id).catch(() => []) : [];
          const abiertas = [];
          for (const a of ciclo) if (await c.ventanaAbierta(org, a, ahora).catch(() => false)) abiertas.push(a);
          porOrg.set(p.org_id, { org, ciclo, turno: abiertas.length ? abiertas : ciclo, sinTexto: abiertas.length === 0 });
        }
        const { org, ciclo, turno, sinTexto } = porOrg.get(p.org_id);
        if (!org) continue;
        const fallidos = await Promise.resolve().then(() => c.datos.avisosFallidos(p.wamids_aviso)).catch(() => 0);
        const enviados = (p.wamids_aviso || []).length - fallidos;
        const paso = pasoDePregunta({ pregunta: p, ciclo: turno, ahora, enviados });
        if (paso.accion === "nada") continue;
        acciones++;
        const lead = await c.lead(org.id, p.lead_id).catch(() => null);
        if (paso.accion === "reaviso") {
          // Condicional a "pendiente": si alguien la respondio a mitad del tick, no se reavisa.
          if (!(await c.datos.actualizarSiPendiente(p.id, { reaviso_at: ahora.toISOString() }))) continue;
          p.reaviso_at = ahora.toISOString();
          const actual = turno.find((a) => a.id === p.asesor_id);
          await c.avisar({ org, pregunta: p, lead, advisor: actual, reaviso: true, sinTexto });
          res.reavisadas++;
          if (paso.ultimo) await cerrarEscalera(c, org, ciclo, p, res);
          continue;
        }
        const anterior = ciclo.find((a) => a.id === p.asesor_id) || null;
        // Los wamids de aviso se conservan: el asesor puede citar un aviso viejo.
        const patch = { asesor_id: paso.nuevo.id, asignada_at: ahora.toISOString(), reaviso_at: null };
        if (!(await c.datos.actualizarSiPendiente(p.id, patch))) continue;
        Object.assign(p, patch);
        await c.avisar({ org, pregunta: p, lead, advisor: paso.nuevo, reaviso: false, sinTexto });
        if (paso.accion === "asignar") res.asignadas++;
        else res.rotadas++;
        if (anterior && anterior.id !== paso.nuevo.id) {
          await c.notificar({
            orgId: org.id, advisor: anterior, tipo: "pregunta_asesor",
            titulo: `La pregunta pasó a ${paso.nuevo.name}`, cuerpo: p.pregunta, leadId: p.lead_id,
          }).catch(() => {});
        }
        if (paso.ultimo) await cerrarEscalera(c, org, ciclo, p, res);
      } catch (e) {
        console.error("[preguntas-escalera] error con pregunta", p.id, e.message);
      }
    }
    return res;
  } finally {
    corriendo = false;
  }
}

let timer = null;
function start() {
  if (!pa.activo()) {
    console.log("[preguntas-escalera] apagada (SOFI_PREGUNTA_ASESOR)");
    return null;
  }
  const tick = () => runOnce().catch((e) => console.error("[preguntas-escalera] runOnce:", e.message));
  setTimeout(tick, 60 * 1000);
  timer = setInterval(tick, INTERVALO_MIN * 60 * 1000);
  console.log(`[preguntas-escalera] activa — cada ${INTERVALO_MIN} min`);
  return timer;
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runOnce, start, stop };

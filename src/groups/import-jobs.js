// Registro de importaciones en curso.
//
// Un export grande tarda minutos: si el endpoint respondiera al final, el
// navegador cortaria la conexion mucho antes. Se responde 202 con un id y el
// CRM pregunta por el estado cada dos segundos.
//
// En memoria, sin tabla y sin SSE, a proposito:
//
//   · El resultado que importa NO vive aca — vive en `group_signals`. Esto es
//     solo la barra de progreso.
//   · Si el proceso se reinicia a mitad, se vuelve a subir el archivo. El id
//     de mensaje es un hash del contenido, asi que reimportar no duplica nada
//     ni paga la IA dos veces. Perder un job cuesta un clic.
//
// Una tabla y un stream serian mas prolijos y no comprarian nada de eso.

const crypto = require("node:crypto");

// Cuanto sobrevive un job terminado antes de olvidarse. Suficiente para que el
// CRM lea el resultado final con margen; sin esto el mapa crece sin techo en
// un proceso que no se reinicia nunca.
const TTL_MS = 30 * 60 * 1000;

const jobs = new Map();

function limpiar() {
  const corte = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.terminadoEn && job.terminadoEn < corte) jobs.delete(id);
  }
}

function crear(orgId, { archivos = 0, dias = null } = {}) {
  limpiar();
  const id = crypto.randomUUID();
  jobs.set(id, {
    id,
    orgId,
    estado: "en_curso",
    fase: "leyendo",
    procesados: 0,
    total: archivos,
    archivos,
    dias,
    resultado: null,
    error: null,
    iniciadoEn: Date.now(),
    terminadoEn: null,
  });
  return jobs.get(id);
}

function progreso(id, { fase, procesados, total }) {
  const job = jobs.get(id);
  if (!job) return;
  if (fase) job.fase = fase;
  if (typeof procesados === "number") job.procesados = procesados;
  if (typeof total === "number") job.total = total;
}

function terminar(id, resultado) {
  const job = jobs.get(id);
  if (!job) return;
  job.estado = "listo";
  job.fase = "listo";
  job.resultado = resultado;
  job.terminadoEn = Date.now();
}

function fallar(id, error) {
  const job = jobs.get(id);
  if (!job) return;
  job.estado = "error";
  job.fase = "error";
  job.error = error?.message || String(error);
  job.codigo = error?.code || null;
  job.terminadoEn = Date.now();
}

// El orgId se compara para que un tenant no pueda leer el progreso de otro
// pasando un id ajeno.
function estado(id, orgId) {
  const job = jobs.get(id);
  if (!job) return null;
  if (orgId && job.orgId !== orgId) return null;
  const { orgId: _omitido, ...publico } = job;
  return publico;
}

function _reset() {
  jobs.clear();
}

module.exports = { crear, progreso, terminar, fallar, estado, _reset, TTL_MS };

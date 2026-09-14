// Dispara UNA sincronizacion de Wasi en el DMAP DESPLEGADO, con las variables
// del servicio (railway run). Es lo mismo que el boton "Sincronizar ahora" del
// CRM: POST /api/v1/sync/run con la clave del API.
//
//   railway run --service dmap npx tsx scripts/run-sync-once.ts [orgId]
//
// POR QUE NO CORRE EL SYNC ACA (2026-09-13). La primera version llamaba a
// runSync() en esta maquina. Funciona mientras ninguna propiedad cambie: en
// cuanto una cambia, el sync encola su Property Context en Redis
// (applyCognitiveInvalidation), y el REDIS_URL que inyecta `railway run` es la
// direccion INTERNA de Railway, que desde afuera no existe. El proceso se queda
// esperando para siempre y deja su fila de sync_runs en "running". Paso el
// 2026-09-13. Adentro de Railway, Redis si esta.
//
// La clave se lee del entorno que inyecta `railway run`; nunca se imprime.

const orgId = process.argv[2] || "1f502f7c-8465-4d7c-be05-ebf353a1c035";
const base = process.env.DMAP_PUBLIC_URL || "https://dmap-production.up.railway.app";
const clave = process.env.DMAP_API_KEY;

async function main() {
  if (!clave) throw new Error("Falta DMAP_API_KEY: correlo con `railway run --service dmap`.");
  const r = await fetch(`${base}/api/v1/sync/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": clave },
    body: JSON.stringify({ orgId }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const cuerpo = await r.text();
  console.log(`HTTP ${r.status}`);
  console.log(cuerpo);
  if (!r.ok) process.exit(1);
}

main().catch((e) => {
  console.error("Fallo el sync:", e.message);
  process.exit(1);
});

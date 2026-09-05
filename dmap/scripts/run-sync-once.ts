// Corre UNA sincronizacion de Wasi para una org, con las variables del
// servicio (railway run). Es el mismo runSync que dispara POST
// /api/v1/sync/run; existe para poder correrlo desde afuera sin la clave del
// API (x-api-key) y ver el resultado completo en la terminal.
//
//   railway run --service dmap npx tsx scripts/run-sync-once.ts [orgId]
//
import { runSync } from "../src/services/sync.service.js";

const orgId = process.argv[2] || "1f502f7c-8465-4d7c-be05-ebf353a1c035";

runSync(orgId)
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error("Fallo el sync:", e.message);
    process.exit(1);
  });

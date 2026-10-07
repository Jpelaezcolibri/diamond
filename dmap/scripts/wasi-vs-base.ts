// Compara lo que expone la API de Wasi con lo que la base tiene disponible.
// SOLO LECTURA: no escribe en la base ni encola nada.
//
//   railway run --service dmap npx tsx scripts/wasi-vs-base.ts [orgId]
//
// Imprime las refs disponibles en la base que Wasi ya no expone (candidatas a
// retiro) y las que Wasi expone y la base no tiene.

import { WasiApiSource } from "../src/sync/wasi-api.source";
import { listPropertiesByOrg } from "../src/repositories/properties.repo";

const orgId = process.argv[2] || "1f502f7c-8465-4d7c-be05-ebf353a1c035";

async function main() {
  const candidates = await new WasiApiSource().fetchCandidates(orgId);
  const enWasi = new Set(candidates.filter((c) => !c.gone && c.data).map((c) => c.data!.ref));
  const base = await listPropertiesByOrg(orgId);
  const disponibles = base.filter((p) => p.disponible);

  console.log(`Wasi expone ${enWasi.size} · la base tiene ${disponibles.length} disponibles`);
  const sobran = disponibles.filter((p) => !enWasi.has(p.ref));
  console.log(`Disponibles en la base que Wasi YA NO expone (${sobran.length}):`);
  for (const p of sobran) console.log(`  ${p.ref} | ${p.titulo} | ${p.link}`);
  const refsBase = new Set(disponibles.map((p) => p.ref));
  const faltan = [...enWasi].filter((r) => !refsBase.has(r));
  console.log(`En Wasi y no disponibles en la base (${faltan.length}): ${faltan.join(", ")}`);

  // Campo por campo: lo que dice Wasi hoy contra lo que tiene la base.
  const campos = ["titulo", "tipo", "operacion", "precio", "zona", "habitaciones", "area", "link"] as const;
  const porRef = new Map(base.map((p) => [p.ref, p as unknown as Record<string, unknown>]));
  // El link se compara por la ref al final de la ruta: Wasi cambio el dominio
  // (inmo.co -> diamondinmobiliaria.com) y el slug, pero apunta a la misma ficha.
  const norm = (v: unknown) => {
    const s = String(v ?? "").trim().toLowerCase();
    return /^https?:\/\//.test(s) ? s.replace(/\/+$/, "").split("/").pop()! : s;
  };
  const igual = (a: unknown, b: unknown) => norm(a) === norm(b);
  let distintas = 0;
  for (const c of candidates) {
    if (c.gone || !c.data) continue;
    const fila = porRef.get(c.data.ref);
    if (!fila) continue;
    const difs = campos.filter((k) => !igual((c.data as unknown as Record<string, unknown>)[k], fila[k]));
    if (difs.length) {
      distintas += 1;
      console.log(`  DIFERENTE ${c.data.ref}: ` + difs.map((k) => `${k} wasi="${(c.data as unknown as Record<string, unknown>)[k]}" base="${fila[k]}"`).join(" · "));
    }
  }
  console.log(`Propiedades con algún campo distinto a Wasi: ${distintas} de ${enWasi.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

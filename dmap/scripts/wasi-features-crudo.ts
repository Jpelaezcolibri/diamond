// Que caracteristicas manda Wasi en `features` (internal/external) y con que
// frecuencia. Solo lee. Auditoria 2026-09-05: si "Unidad cerrada", "Terraza"
// o "Parqueadero" vienen aca, dejan de ser datos que "no registramos".
//   railway run --service dmap npx tsx scripts/wasi-features-crudo.ts
import { getOrgMarketingSettings } from "../src/repositories/settings.repo.js";
import { decryptSecret } from "../src/security/crypto.js";
const orgId = process.argv[2] || "1f502f7c-8465-4d7c-be05-ebf353a1c035";
type Crudo = Record<string, unknown>;
const entries = (b: unknown): Crudo[] => Object.entries((b || {}) as Crudo).filter(([k, v]) => /^\d+$/.test(k) && v && typeof v === "object").map(([, v]) => v as Crudo);
async function main() {
  const s = await getOrgMarketingSettings(orgId);
  const idCompany = decryptSecret(s.wasi_id_company_enc!); const token = decryptSecret(s.wasi_token_enc!);
  const q = async (p: Record<string, string>) => { const u = new URL("https://api.wasi.co/v1/property/search"); u.searchParams.set("id_company", idCompany); u.searchParams.set("wasi_token", token); for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v); const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r.json(); };
  const todas: Crudo[] = [];
  for (const pass of [{ for_sale: "true" }, { for_rent: "true" }]) for (let skip = 0; ; skip += 100) { const l = entries(await q({ take: "100", skip: String(skip), ...pass })); todas.push(...l); if (l.length < 100) break; }
  const cnt = new Map<string, number>(); let conFeatures = 0;
  for (const p of todas) {
    const f = p.features as Crudo | undefined; if (!f) continue; let alguna = false;
    for (const grupo of ["internal", "external"]) for (const it of ((f[grupo] as Crudo[]) || [])) { const n = String(it.nombre || it.name || "").trim(); if (!n) continue; alguna = true; const k = `${grupo}:${n}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
    if (alguna) conFeatures++;
  }
  console.log(`propiedades: ${todas.length}; con alguna feature: ${conFeatures}`);
  for (const [k, v] of [...cnt.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v.toString().padStart(3)}  ${k}`);
  const ej = todas.find((p) => p.features); if (ej) console.log("\nclaves de una propiedad:", Object.keys(ej).join(", "));
}
main().catch((e) => { console.error("Fallo:", e.message); process.exit(1); });

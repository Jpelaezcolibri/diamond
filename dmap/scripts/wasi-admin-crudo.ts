// Que campos de Wasi hablan de administracion / cuota de mantenimiento, y con
// que frecuencia vienen cargados. Solo lee.
//   railway run --service dmap npx tsx scripts/wasi-admin-crudo.ts
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
  const claves = new Set<string>(); for (const p of todas) for (const k of Object.keys(p)) claves.add(k);
  const candidatas = [...claves].filter((k) => /admin|mainten|fee|cuota|expens|condo/i.test(k));
  console.log(`propiedades: ${todas.length}`);
  console.log("todas las claves:", [...claves].sort().join(", "));
  for (const k of candidatas) {
    const vals = todas.map((p) => p[k]);
    const cargados = vals.filter((v) => v !== null && v !== undefined && v !== "" && String(v) !== "0" && String(v) !== "$0");
    console.log(`\n${k}: cargado en ${cargados.length}/${todas.length}; ejemplos: ${cargados.slice(0, 5).map((v) => JSON.stringify(v)).join(" | ")}`);
  }
}
main().catch((e) => { console.error("Fallo:", e.message); process.exit(1); });

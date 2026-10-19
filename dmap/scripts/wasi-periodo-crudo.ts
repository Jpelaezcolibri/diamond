// Que campo de Wasi dice si el arriendo es Mensual o Diario. Solo lee.
//   railway run --service dmap npx tsx scripts/wasi-periodo-crudo.ts
import { getOrgMarketingSettings } from "../src/repositories/settings.repo.js";
import { decryptSecret } from "../src/security/crypto.js";
const orgId = process.argv[2] || "1f502f7c-8465-4d7c-be05-ebf353a1c035";
type Crudo = Record<string, unknown>;
const entries = (b: unknown): Crudo[] => Object.entries((b || {}) as Crudo).filter(([k, v]) => /^\d+$/.test(k) && v && typeof v === "object").map(([, v]) => v as Crudo);
async function main() {
  const s = await getOrgMarketingSettings(orgId);
  const idCompany = decryptSecret(s.wasi_id_company_enc!); const token = decryptSecret(s.wasi_token_enc!);
  const u = new URL("https://api.wasi.co/v1/property/search");
  u.searchParams.set("id_company", idCompany); u.searchParams.set("wasi_token", token); u.searchParams.set("for_rent", "true"); u.searchParams.set("take", "100");
  const todas = entries(await (await fetch(u)).json());
  console.log(`arriendos: ${todas.length}`);
  const claves = [...new Set(todas.flatMap((p) => Object.keys(p)))].sort();
  console.log("claves:", claves.join(", "));
  for (const p of todas) {
    const ref = p.id_property;
    const pistas = Object.entries(p).filter(([k]) => /rent|period|type|label|price/i.test(k) && !/sale/i.test(k)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    console.log(ref, "|", pistas.slice(0, 400));
  }
}
main().catch((e) => { console.error("Fallo:", e.message); process.exit(1); });

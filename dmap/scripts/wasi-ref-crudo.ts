// Campos de operacion y precio de unas refs en la API de Wasi. Solo lee.
//   railway run --service dmap npx tsx scripts/wasi-ref-crudo.ts 10505542 10505566
import { getOrgMarketingSettings } from "../src/repositories/settings.repo.js";
import { decryptSecret } from "../src/security/crypto.js";
const orgId = "1f502f7c-8465-4d7c-be05-ebf353a1c035";
async function main() {
  const s = await getOrgMarketingSettings(orgId);
  const idCompany = decryptSecret(s.wasi_id_company_enc!); const token = decryptSecret(s.wasi_token_enc!);
  for (const ref of process.argv.slice(2)) {
    const u = new URL(`https://api.wasi.co/v1/property/get/${ref}`);
    u.searchParams.set("id_company", idCompany); u.searchParams.set("wasi_token", token);
    const p = (await (await fetch(u)).json()) as Record<string, unknown>;
    const k = ["title", "built_area", "area", "private_area", "for_sale", "for_rent", "for_temporary_rent", "sale_price", "sale_price_label", "rent_price", "rent_price_label", "rents_type_label", "zone_label", "city_label"];
    console.log(ref, k.map((x) => `${x}=${JSON.stringify(p[x])}`).join(" "));
  }
}
main().catch((e) => { console.error("Fallo:", e.message); process.exit(1); });

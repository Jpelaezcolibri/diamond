// ¿Que manda Wasi cuando el garaje NO esta cargado? (auditoria del motor de
// match, 2026-09-05, H4). Medido en la base: garaje = 0 en 39 de 114
// disponibles, null en CERO. Si la API omite `garages` cuando no esta cargado,
// el 0 lo estamos fabricando nosotros y se arregla en el sync; si la API manda
// "0" literal, el dato es inverificable en origen y el bot hace bien en leer
// 0 como "sin dato".
//
// Solo lee. No escribe en la base ni en Wasi.
//
//   railway run --service dmap npx tsx scripts/wasi-garages-crudo.ts [orgId]
//
import { getOrgMarketingSettings } from "../src/repositories/settings.repo.js";
import { decryptSecret } from "../src/security/crypto.js";

const ORG_DIAMOND = "1f502f7c-8465-4d7c-be05-ebf353a1c035";
const orgId = process.argv[2] || ORG_DIAMOND;
const BASE = "https://api.wasi.co/v1";

type Crudo = Record<string, unknown>;

function entries(body: unknown): Crudo[] {
  if (!body || typeof body !== "object") return [];
  const out: Crudo[] = [];
  for (const [k, v] of Object.entries(body as Crudo)) {
    if (/^\d+$/.test(k) && v && typeof v === "object") out.push(v as Crudo);
  }
  return out;
}

async function main() {
  const settings = await getOrgMarketingSettings(orgId);
  if (!settings.wasi_id_company_enc || !settings.wasi_token_enc) throw new Error("La org no tiene credenciales de la API de Wasi");
  const idCompany = decryptSecret(settings.wasi_id_company_enc);
  const token = decryptSecret(settings.wasi_token_enc);

  const query = async (params: Record<string, string>) => {
    const url = new URL(`${BASE}/property/search`);
    url.searchParams.set("id_company", idCompany);
    url.searchParams.set("wasi_token", token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Wasi respondio ${r.status}`);
    return r.json();
  };

  const todas: Crudo[] = [];
  for (const pass of [{ for_sale: "true" }, { for_rent: "true" }]) {
    for (let skip = 0; ; skip += 100) {
      const lote = entries(await query({ take: "100", skip: String(skip), ...pass }));
      todas.push(...lote);
      if (lote.length < 100) break;
    }
  }

  const dist = (campo: string) => {
    const c = { ausente: 0, null: 0, cero: 0, positivo: 0, otro: 0 } as Record<string, number>;
    const tipos = new Map<string, number>();
    for (const p of todas) {
      if (!(campo in p)) { c.ausente++; continue; }
      const v = p[campo];
      tipos.set(typeof v, (tipos.get(typeof v) || 0) + 1);
      if (v === null) c.null++;
      else if (Number(v) === 0) c.cero++;
      else if (Number(v) > 0) c.positivo++;
      else c.otro++;
    }
    return { ...c, tipos: Object.fromEntries(tipos) };
  };

  console.log(`Wasi devolvio ${todas.length} propiedades para la org ${orgId}`);
  for (const campo of ["garages", "bathrooms", "stratum", "bedrooms"]) {
    console.log(`  ${campo}:`, JSON.stringify(dist(campo)));
  }

  const muestra = ["10316178", "10077063", "10013129", "9953055", "9861538", "9307551"];
  console.log("\nMuestra (ref -> garages / bathrooms / stratum, tal cual llegan):");
  for (const p of todas) {
    const ref = String(p.reference ?? "").trim();
    if (!muestra.includes(ref)) continue;
    console.log(`  ${ref}: garages=${JSON.stringify(p.garages)} bathrooms=${JSON.stringify(p.bathrooms)} stratum=${JSON.stringify(p.stratum)} bedrooms=${JSON.stringify(p.bedrooms)}`);
  }
  // Un ejemplo crudo entero de una con garages "0", por si el dato vive en otro campo.
  const cero = todas.find((p) => Number(p.garages) === 0);
  if (cero) {
    const claves = Object.keys(cero).filter((k) => /gar|park|feature|caract/i.test(k));
    console.log("\nClaves que huelen a parqueadero en una propiedad con garages=0:", claves.length ? claves.map((k) => `${k}=${JSON.stringify(cero[k]).slice(0, 80)}`).join(" | ") : "ninguna");
  }
}

main().catch((e) => { console.error("Fallo:", e.message); process.exit(1); });

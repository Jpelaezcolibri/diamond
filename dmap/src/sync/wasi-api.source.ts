import { z } from "zod";
import { decryptSecret } from "../security/crypto.js";
import { getOrgMarketingSettings } from "../repositories/settings.repo.js";
import { listPropertiesByOrg } from "../repositories/properties.repo.js";
import type { CanonicalProperty, SyncCandidate, WasiSource } from "./wasi-source.js";

const WASI_API_BASE = "https://api.wasi.co/v1";
const PAGE_SIZE = 100;

/**
 * Forma real de api.wasi.co/v1/property/search, verificada contra la cuenta
 * de produccion de Diamond (2026-07-05) — ver dmap/ARCHITECTURE.md #15.
 * El endpoint devuelve un objeto con las propiedades en llaves numericas
 * ("0","1",...) mas `total`/`status` como hermanos, NO un array envuelto en
 * `{data: [...]}` como se asumio originalmente antes de tener credenciales
 * reales. `.passthrough()` en cada propiedad para no reventar si Wasi
 * agrega/renombra campos que aun no mapeamos.
 */
const wasiImageSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    filename: z.string().optional(),
    position: z.number().optional(),
    url: z.string().optional(),
    url_big: z.string().optional(),
    url_original: z.string().optional()
  })
  .passthrough();

type WasiImage = z.infer<typeof wasiImageSchema>;

export const wasiApiPropertySchema = z
  .object({
    id_property: z.union([z.number(), z.string()]),
    id_property_type: z.union([z.number(), z.string()]).nullable().optional(),
    title: z.string().nullable().optional(),
    reference: z.string().nullable().optional(),
    for_sale: z.union([z.string(), z.boolean()]).optional(),
    for_rent: z.union([z.string(), z.boolean()]).optional(),
    sale_price: z.union([z.string(), z.number()]).nullable().optional(),
    sale_price_label: z.string().nullable().optional(),
    rent_price: z.union([z.string(), z.number()]).nullable().optional(),
    rent_price_label: z.string().nullable().optional(),
    observations: z.string().nullable().optional(),
    area: z.union([z.string(), z.number()]).nullable().optional(),
    built_area: z.union([z.string(), z.number()]).nullable().optional(),
    private_area: z.union([z.string(), z.number()]).nullable().optional(),
    unit_area_label: z.string().nullable().optional(),
    bedrooms: z.union([z.string(), z.number()]).nullable().optional(),
    bathrooms: z.union([z.string(), z.number()]).nullable().optional(),
    // Nombres segun la documentacion de la API v1 de Wasi. El esquema es
    // passthrough, asi que si esta version los manda con otro nombre no se
    // rompe nada: simplemente llegan null y el aviso de abajo lo delata.
    garages: z.union([z.string(), z.number()]).nullable().optional(),
    stratum: z.union([z.string(), z.number()]).nullable().optional(),
    zone_label: z.string().nullable().optional(),
    city_label: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
    // Wasi manda `main_image` como objeto casi siempre, pero el 2026-09-09
    // aparecio como array (vacio, o con la foto adentro) en al menos una
    // propiedad de la cuenta. Declararlo solo objeto tumbo las 5 corridas del
    // dia con `seen: 0` y dejo el radar mudo 37 h. La forma real se resuelve
    // en mainImageDe().
    main_image: z.union([wasiImageSchema, z.array(z.unknown())]).nullable().optional(),
    // Peculiaridad de la API (verificada contra produccion): `galleries` es un
    // array con UN solo elemento, que es un objeto con las fotos en llaves
    // numericas ("0","1",...) MEZCLADAS con metadata del album (`id`, etc.).
    // Por eso el valor es z.unknown(): la extraccion real (solo llaves
    // numericas) vive en extractImages().
    galleries: z.array(z.record(z.string(), z.unknown())).optional(),
    // `features` (verificado contra produccion el 2026-09-05): objeto con
    // `internal` y `external`, cada uno un array de {id, nombre, name, own}.
    // z.unknown() por la misma razon que galleries: la forma real se
    // desarma en extractFeatures(), con tolerancia a que cambie.
    features: z.unknown().optional()
  })
  .passthrough();

export type WasiApiProperty = z.infer<typeof wasiApiPropertySchema>;

/** Extrae las entradas con llave numerica ("0","1",...) de una respuesta estilo Wasi (ignora total/status/metadata). */
export function extractPropertyEntries(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([key]) => /^\d+$/.test(key))
    .map(([, value]) => value);
}

/** Una entrada de Wasi que no se pudo parsear, con lo poco que se le pudo leer. */
export type DescarteWasi = { ref: string | null; motivo: string };

/**
 * Cuantas entradas irreparables se toleran antes de dar la corrida por
 * invalida. Bajo a proposito: por encima de esto ya no es "una propiedad
 * rara", es que la API cambio de forma, y sincronizar el resto seria
 * publicar un inventario mutilado sin que nada avise.
 */
const MAX_RATIO_DESCARTES = 0.05;

/**
 * Piso absoluto de descartes tolerados, pase lo que pase con el porcentaje.
 * Sin el, una cuenta chica (Paraiso tiene 2 propiedades en alquiler) abortaria
 * la corrida ante una sola rareza y el aislamiento no serviria de nada: el
 * ratio solo empieza a mandar cuando el inventario es grande. Una descartada
 * no se borra ni se marca vendida — solo no se actualiza, y queda en el log.
 */
const MIN_DESCARTES_TOLERADOS = 2;

/**
 * La ref que tendria la entrada si hubiera parseado — misma regla que
 * toCanonicalProperty. Se lee a mano, sin zod, porque justamente lo que falla
 * es el parse. Sirve para NO marcar como retirada una propiedad que sigue en
 * Wasi y solo llego con un campo raro.
 */
function refDeEntradaCruda(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const reference = typeof e.reference === "string" ? e.reference.trim() : "";
  if (reference) return reference;
  const id = e.id_property;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

/**
 * Parsea una pagina de /property/search AISLANDO cada entrada.
 *
 * POR QUE (incidente del 2026-09-09): esto era
 * `entries.map((e) => wasiApiPropertySchema.parse(e))` — un `.parse()` que
 * lanza dentro de un `.map()`. Wasi mando `main_image` como array en UNA
 * propiedad y se perdio el inventario COMPLETO de la cuenta: 5 corridas
 * fallidas con `seen: 0`, 37 h sin sync y el radar callado ante cuatro
 * pedidos con match. La proxima sorpresa de Wasi no sabemos cual va a ser;
 * lo que si sabemos es que no puede costar el inventario entero.
 *
 * No se traga el fallo: cada descarte se cuenta y verificarDescartes() tumba
 * la corrida si son demasiados.
 */
export function parseSearchPage(raw: unknown): { properties: WasiApiProperty[]; descartes: DescarteWasi[] } {
  const properties: WasiApiProperty[] = [];
  const descartes: DescarteWasi[] = [];
  for (const entry of extractPropertyEntries(raw)) {
    const parsed = wasiApiPropertySchema.safeParse(entry);
    if (parsed.success) {
      properties.push(parsed.data);
      continue;
    }
    const motivo = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join(" | ");
    descartes.push({ ref: refDeEntradaCruda(entry), motivo });
  }
  return { properties, descartes };
}

/**
 * Decide si una corrida con descartes sigue siendo confiable. Lanza si no.
 *
 * Aislar la entrada rota evita perder el inventario por una propiedad; este
 * umbral evita el fallo contrario, que es peor: dar por buena una corrida a
 * la que le falta medio inventario y dejar que el resto del sistema lo trate
 * como la verdad. Cero descartes es el caso normal y no dice nada.
 */
export function verificarDescartes(parseadas: number, descartadas: number): void {
  if (descartadas === 0) return;
  const total = parseadas + descartadas;
  const ratio = descartadas / total;
  const tope = Math.max(MIN_DESCARTES_TOLERADOS, Math.floor(total * MAX_RATIO_DESCARTES));
  if (parseadas === 0 || descartadas > tope) {
    throw new Error(
      `Wasi devolvio ${total} propiedades y ${descartadas} no se pudieron parsear ` +
        `(${Math.round(ratio * 100)}%, tope ${tope}). ` +
        "Se aborta la corrida: sincronizar el resto seria publicar un inventario mutilado. " +
        "Revisa wasiApiPropertySchema contra la forma actual de la API."
    );
  }
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isTrue(value: string | boolean | undefined): boolean {
  return value === true || value === "true";
}

export function normalizeOperacionYPrecio(p: WasiApiProperty): { operacion: "Venta" | "Arriendo" | null; precio: string | null } {
  if (isTrue(p.for_sale)) {
    return { operacion: "Venta", precio: p.sale_price_label ?? (p.sale_price != null ? String(p.sale_price) : null) };
  }
  if (isTrue(p.for_rent)) {
    return { operacion: "Arriendo", precio: p.rent_price_label ?? (p.rent_price != null ? String(p.rent_price) : null) };
  }
  return { operacion: null, precio: null };
}

/**
 * Wasi trae tres campos de area y cualquiera puede venir vacio o con un typo
 * ("" o "2" con built_area correcto — casos reales de esta cuenta). Se toma
 * el primero >= 10 m2; si ninguno alcanza, el primero > 0; si no hay nada,
 * null. Verificado 2026-07-05: id=9861538 tiene area="" y built_area="160".
 */
export function normalizeArea(p: WasiApiProperty): string | null {
  const candidates = [p.area, p.built_area, p.private_area]
    .map(toNumberOrNull)
    .filter((n): n is number => n !== null && n > 0);
  if (candidates.length === 0) return null;
  const value = candidates.find((n) => n >= 10) ?? candidates[0]!;
  const unit = (p.unit_area_label ?? "M2").toLowerCase();
  return `${value}${unit}`;
}

function parseWasiImage(raw: unknown): WasiImage | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = wasiImageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * `main_image` en su forma util. Wasi lo manda como objeto, pero tambien como
 * array —vacio cuando no hay foto principal, o con la foto adentro— y un `[]`
 * es truthy en JS: sin esto, `images = [[]]` se colaba y salia una foto
 * fantasma sin url. Devuelve la primera imagen valida, o null.
 */
export function mainImageDe(p: WasiApiProperty): WasiImage | null {
  const raw = p.main_image;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const img = parseWasiImage(item);
      if (img) return img;
    }
    return null;
  }
  return raw ? parseWasiImage(raw) : null;
}

/**
 * `galleries[0]` mezcla las fotos (llaves numericas "0","1",...) con metadata
 * del album (`id` del gallery, etc.) — descubierto en produccion: el primer
 * intento asumio que un `id` directo significaba "una sola foto" y dejo las
 * 61 propiedades nuevas sin imagenes. Solo se toman las llaves numericas,
 * ordenadas por `position`, usando `url_original` (CDN directo, sin proxy).
 */
export function extractImages(p: WasiApiProperty): { imageKeys: string[]; imageUrls: string[] } {
  const container = p.galleries?.[0] as Record<string, unknown> | undefined;
  let images: WasiImage[] = [];

  if (container) {
    images = Object.entries(container)
      .filter(([key]) => /^\d+$/.test(key))
      .map(([, value]) => parseWasiImage(value))
      .filter((img): img is WasiImage => img !== null);
  }
  const principal = mainImageDe(p);
  if (images.length === 0 && principal) {
    images = [principal];
  }

  const sorted = [...images].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const imageKeys = sorted.map((img) => (img.id != null ? String(img.id) : img.filename)).filter((k): k is string => Boolean(k));
  const imageUrls = sorted.map((img) => img.url_original).filter((u): u is string => Boolean(u));
  return { imageKeys, imageUrls };
}

export type PropertyTypeMap = Map<number, string>;

/**
 * Aplana `features.internal` + `features.external` a un texto "A, B, C".
 * Dedupe sin distinguir mayusculas, colapsa los dobles espacios que Wasi trae
 * ("Urbanización  cerrada") y conserva el orden: primero internas, despues
 * externas. null si no hay ninguna con nombre.
 */
export function extractFeatures(p: WasiApiProperty): string | null {
  const features = (p as Record<string, unknown>).features;
  if (!features || typeof features !== "object") return null;
  const vistas = new Set<string>();
  const nombres: string[] = [];
  for (const grupo of ["internal", "external"]) {
    const lista = (features as Record<string, unknown>)[grupo];
    if (!Array.isArray(lista)) continue;
    for (const item of lista) {
      if (!item || typeof item !== "object") continue;
      const it = item as Record<string, unknown>;
      // `nombre` puede venir vacio con `name` lleno (y al reves): se toma el
      // primero no vacio. Los dobles espacios de Wasi se colapsan.
      const nombre = String(it.nombre || it.name || "").replace(/\s+/g, " ").trim();
      if (!nombre) continue;
      const clave = nombre.toLowerCase();
      if (vistas.has(clave)) continue;
      vistas.add(clave);
      nombres.push(nombre);
    }
  }
  return nombres.length > 0 ? nombres.join(", ") : null;
}

export function toCanonicalProperty(raw: WasiApiProperty, propertyTypes: PropertyTypeMap = new Map()): CanonicalProperty {
  const { operacion, precio } = normalizeOperacionYPrecio(raw);
  const { imageKeys, imageUrls } = extractImages(raw);
  const typeId = toNumberOrNull(raw.id_property_type);

  return {
    ref: raw.reference?.trim() || String(raw.id_property),
    titulo: raw.title ?? null,
    tipo: (typeId !== null ? propertyTypes.get(typeId) : null) ?? null,
    operacion,
    precio,
    descripcion: raw.observations ?? null,
    area: normalizeArea(raw),
    habitaciones: toNumberOrNull(raw.bedrooms),
    banos: toNumberOrNull(raw.bathrooms),
    garaje: toNumberOrNull(raw.garages),
    estrato: toNumberOrNull(raw.stratum),
    caracteristicas: extractFeatures(raw),
    zona: raw.zone_label ?? null,
    ciudad: raw.city_label ?? null,
    link: raw.link ?? null,
    imageKeys,
    imageUrls
  };
}

const wasiPropertyTypeSchema = z
  .object({
    id_property_type: z.union([z.number(), z.string()]),
    nombre: z.string().optional(),
    name: z.string().optional()
  })
  .passthrough();

/** Un link de propiedad gestionada por Wasi (pagina publica vieja o sitio inmo.co nuevo). */
function isWasiManagedLink(link: string | null): boolean {
  return Boolean(link && /info\.wasi\.co|\.inmo\.co/.test(link));
}

/**
 * Fuente oficial (api.wasi.co) — a diferencia de wasi-public, puede
 * DESCUBRIR propiedades nuevas (propertyId null -> evento 'created' real) y
 * DETECTAR retiros: como ve el inventario completo, toda propiedad Wasi de
 * la org que ya no aparezca en el listado se reporta `gone` (vendida o
 * despublicada) para que sync.service la marque no disponible. Se activa
 * cambiando org_marketing_settings.sync_source a 'wasi_api', sin tocar codigo.
 */
export class WasiApiSource implements WasiSource {
  readonly kind = "wasi_api" as const;

  async fetchCandidates(orgId: string): Promise<SyncCandidate[]> {
    const settings = await getOrgMarketingSettings(orgId);
    if (!settings.wasi_id_company_enc || !settings.wasi_token_enc) {
      throw new Error(
        `Organizacion ${orgId}: faltan credenciales de la API oficial de Wasi (org_marketing_settings.wasi_id_company_enc / wasi_token_enc)`
      );
    }
    const idCompany = decryptSecret(settings.wasi_id_company_enc);
    const wasiToken = decryptSecret(settings.wasi_token_enc);

    const query = async (path: string, params: Record<string, string>): Promise<unknown> => {
      const url = new URL(`${WASI_API_BASE}${path}`);
      url.searchParams.set("id_company", idCompany);
      url.searchParams.set("wasi_token", wasiToken);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Wasi API respondio ${response.status} en ${path}`);
      }
      return response.json();
    };

    // Catalogo de tipos (id -> "Apartamento", "Casa", ...) para poblar properties.tipo.
    const propertyTypes: PropertyTypeMap = new Map();
    try {
      const typesBody = await query("/property-type/all", {});
      for (const entry of extractPropertyEntries(typesBody)) {
        const parsed = wasiPropertyTypeSchema.safeParse(entry);
        if (!parsed.success) continue;
        const id = toNumberOrNull(parsed.data.id_property_type);
        const nombre = parsed.data.nombre ?? parsed.data.name;
        if (id !== null && nombre) propertyTypes.set(id, nombre);
      }
    } catch {
      // El catalogo es un enriquecimiento: si falla, el sync sigue sin tipo.
    }

    const descartes: DescarteWasi[] = [];
    const fetchPaginated = async (extraParams: Record<string, string>): Promise<WasiApiProperty[]> => {
      const results: WasiApiProperty[] = [];
      let skip = 0;
      for (;;) {
        const body = await query("/property/search", { take: String(PAGE_SIZE), skip: String(skip), ...extraParams });
        const pagina = parseSearchPage(body);
        // La paginacion se corta por ENTRADAS de la pagina, no por las que
        // parsearon: si una se descarta, `properties.length < PAGE_SIZE` haria
        // creer que esta fue la ultima pagina y truncaria el inventario en
        // silencio — el mismo tipo de fallo callado que este arreglo combate.
        const enLaPagina = pagina.properties.length + pagina.descartes.length;
        if (enLaPagina === 0) break;
        results.push(...pagina.properties);
        descartes.push(...pagina.descartes);
        skip += PAGE_SIZE;
        if (enLaPagina < PAGE_SIZE) break;
      }
      return results;
    };

    // Dos pasadas (venta y arriendo) unidas por id: verificado en produccion
    // que la busqueda con for_sale=true trae solo ventas; los arriendos que
    // el cliente cargue despues llegan por la pasada for_rent=true.
    const seenIds = new Set<string>();
    // Termometro de los campos nuevos (2026-09-02): si la API los manda con
    // otro nombre, TODAS quedarian en null y el sintoma seria identico a "en
    // Wasi no estan cargados". Este contador distingue las dos cosas en el
    // log, sin agregar una sola llamada.
    let conGaraje = 0;
    let conEstrato = 0;
    const allProperties: WasiApiProperty[] = [];
    const passes: Record<string, string>[] = [{ for_sale: "true" }, { for_rent: "true" }];
    for (const pass of passes) {
      for (const property of await fetchPaginated(pass)) {
        const id = String(property.id_property);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        allProperties.push(property);
      }
    }

    // Cada descarte se nombra en el log ANTES de decidir si la corrida vale:
    // si el umbral la tumba, el log ya dice cual propiedad y que campo.
    for (const d of descartes) {
      console.warn(`[sync] Propiedad de Wasi descartada (ref ${d.ref ?? "desconocida"}): ${d.motivo}`);
    }
    verificarDescartes(allProperties.length, descartes.length);

    const existing = await listPropertiesByOrg(orgId);
    const existingByRef = new Map(existing.map((p) => [p.ref, p.id]));

    const candidates: SyncCandidate[] = allProperties.map((raw) => {
      const data = toCanonicalProperty(raw, propertyTypes);
      if (data.garaje !== null) conGaraje += 1;
      if (data.estrato !== null) conEstrato += 1;
      return {
        propertyId: existingByRef.get(data.ref) ?? null,
        wasiId: String(raw.id_property),
        gone: false,
        data
      };
    });

    // Si NINGUNA trajo el dato, lo mas probable es que esta version de la API
    // los mande con otro nombre — el sintoma seria identico a "en Wasi no
    // estan cargados" y nos costaria semanas notarlo. Se dice en el log.
    if (allProperties.length > 0 && conGaraje === 0 && conEstrato === 0) {
      console.warn(
        `[sync] Wasi devolvio ${allProperties.length} propiedades y NINGUNA trae garages ni stratum. ` +
          "O el inventario no los tiene cargados, o esta version de la API usa otro nombre de campo " +
          "(ver wasiApiPropertySchema en wasi-api.source.ts)."
      );
    } else {
      console.log(`[sync] Wasi: ${conGaraje}/${allProperties.length} con garaje, ${conEstrato}/${allProperties.length} con estrato.`);
    }

    // Retiros: propiedades Wasi de la org, aun disponibles, que ya no estan
    // en el inventario de la API (vendidas o despublicadas en Wasi).
    // Las descartadas van al set: siguen estando en Wasi, solo llegaron con un
    // campo que no supimos leer. Marcarlas `gone` seria decirle al resto del
    // sistema que se vendieron — un dato falso salido de un bug nuestro.
    const fetchedRefs = new Set(candidates.map((c) => c.data!.ref));
    for (const d of descartes) if (d.ref) fetchedRefs.add(d.ref);
    for (const property of existing) {
      if (!property.disponible) continue;
      if (fetchedRefs.has(property.ref)) continue;
      if (!isWasiManagedLink(property.link)) continue;
      candidates.push({ propertyId: property.id, wasiId: null, gone: true, data: null });
    }

    return candidates;
  }
}

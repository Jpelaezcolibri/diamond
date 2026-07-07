import { unstable_cache } from "next/cache";
import { getSupabase } from "@/lib/supabase";
import type { PropertyContextRow, PropertyMarketingContext } from "@/types/property-context";

// ---------------------------------------------------------------------------
// Contexto DCE (Diamond Cognitive Engine) para UNA propiedad — complemento
// opcional a Property (services/properties.ts). Query separada (no se mete
// en fetchAll): el contexto es mas pesado y solo hace falta en el detalle,
// no en listados/cards. Si no hay Supabase, o la propiedad no tiene DCE
// listo, o la politica de lectura publica aun no existe (rol anon), esto
// devuelve null y la pagina sigue mostrando los campos crudos — nunca
// bloquea el render.
// ---------------------------------------------------------------------------

async function fetchContext(ref: string): Promise<PropertyMarketingContext | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("property_contexts")
    .select("property_ref, status, context")
    .ilike("property_ref", ref)
    .eq("status", "ready")
    .maybeSingle<PropertyContextRow>();

  if (error) {
    // No es fatal: la landing sigue con los campos crudos de siempre.
    console.warn("[REF] No se pudo leer el DCE (RLS pendiente o error transitorio):", error.message);
    return null;
  }
  if (!data) return null;

  const { narrative, emotional, recommendations } = data.context;
  return {
    heroMessage: narrative?.heroMessage ?? null,
    heroSubtitle: narrative?.heroSubtitle ?? null,
    storyAngle: narrative?.storyAngle ?? null,
    benefits: (emotional?.benefits ?? []).slice(0, 4).map((b) => b.beneficio),
    seoTitle: recommendations?.seoTitle ?? null,
    seoDescription: recommendations?.seoDescription ?? null,
  };
}

/** Contexto DCE de una propiedad por ref, cacheado (ISR 5min, mismo ritmo que el catalogo). */
export async function getPropertyContext(ref: string): Promise<PropertyMarketingContext | null> {
  const cached = unstable_cache(fetchContext, ["ref-property-context", ref.toLowerCase()], {
    revalidate: 300,
    tags: [`property-context:${ref.toLowerCase()}`],
  });
  return cached(ref);
}

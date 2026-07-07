/** Fila cruda de `property_contexts` (DCE) relevante para la landing — ver db/migrations/2026-07-06_dce_property_contexts.sql. */
export interface PropertyContextRow {
  property_ref: string;
  status: "pending" | "ready" | "stale" | "failed";
  context: {
    narrative?: {
      heroMessage?: string;
      heroSubtitle?: string;
      storyAngle?: string;
    };
    emotional?: {
      benefits?: Array<{ beneficio: string }>;
    };
    recommendations?: {
      seoTitle?: string;
      seoDescription?: string;
    };
  };
}

/** DCE ya normalizado para la UI de la landing. Solo lo que se muestra al visitante. */
export interface PropertyMarketingContext {
  heroMessage: string | null;
  heroSubtitle: string | null;
  storyAngle: string | null;
  benefits: string[];
  seoTitle: string | null;
  seoDescription: string | null;
}

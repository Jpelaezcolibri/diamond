import { z } from "zod";
import { FatalError } from "../lib/errors.js";
import { callClaude, type ClaudeCallResult } from "./claude.js";
import { tryParseJSON } from "./json-utils.js";
import {
  buildCreativeDesignerPrompt,
  CREATIVE_DESIGNER_PROMPT_VERSION,
  type CreativeDesignerInput
} from "./prompts/creative-designer.v1.js";

/**
 * Agente — Disenador Creativo (Claude) para los motores "designer" e
 * "hybrid": produce el design spec que la plantilla satori renderiza
 * (layouts/designer.ts). Mismo patron de agente que creative-director.ts
 * (caller inyectable, retry-una-vez si el JSON no parsea, FatalError al
 * final — el fallback a plantilla clasica vive en generation.service).
 */

const MAX_HEADLINE_WORDS = 6;
const MAX_CTA_WORDS = 5;

export const designSpecSchema = z.object({
  // Limites por truncado (no tumban la corrida): un headline de 7 palabras
  // no amerita perder la generacion — mismo criterio que el director.
  headline: z
    .string()
    .min(1)
    .transform((h) => h.split(/\s+/).slice(0, MAX_HEADLINE_WORDS).join(" ")),
  price_text: z.string().nullable(),
  specs: z.array(z.string().min(1)).max(3).catch([]),
  location_text: z.string().nullable(),
  cta_text: z
    .string()
    .min(1)
    .transform((c) => c.split(/\s+/).slice(0, MAX_CTA_WORDS).join(" ")),
  panel: z.enum(["light", "graphite"]).catch("light"),
  text_zone: z.enum(["bottom_strip", "bottom_card"]).catch("bottom_strip"),
  // Encuadre de la foto real (objectPosition): el disenador SI puede corregir
  // una foto donde el area relevante (cocina, cama, sala) queda relegada a
  // una esquina — sin esto, la unica palanca contra una foto mal compuesta
  // era pedirle al humano una foto distinta, aunque el problema fuera
  // resoluble con un simple cambio de encuadre.
  photo_focus: z.enum(["top", "center", "bottom"]).catch("center"),
  photo_prompt: z.string().min(20),
  rationale: z.string().min(1)
});

export type DesignSpec = z.infer<typeof designSpecSchema>;

export interface GenerateDesignSpecResult {
  output: DesignSpec;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
}

type ClaudeCaller = (prompt: string) => Promise<ClaudeCallResult>;

const defaultCaller: ClaudeCaller = (prompt) => callClaude({ messages: [{ role: "user", content: prompt }], maxTokens: 2000 });

/** Primer numero (con separadores de miles/decimales) que aparece en un texto, o null. */
function extractNumericToken(raw: string): string | null {
  return raw.match(/[\d]+(?:[.,]\d+)*/)?.[0] ?? null;
}

function sameNumber(a: string, b: string): boolean {
  return a.replace(/[.,]/g, "") === b.replace(/[.,]/g, "");
}

/**
 * Corrige numeros de "specs" que el disenador transcribio distinto al dato
 * real — hallazgo real: el disenador escribio "650 m²" cuando el area real
 * de la propiedad era "2.950 m²" (78% de error, riesgo legal/comercial) y el
 * critico lo detecto una ronda entera despues. area/habitaciones/banos YA
 * son datos estructurados y exactos — no hay razon para confiar en que un
 * LLM los transcriba bien en texto libre cuando el codigo puede verificarlos
 * con cero costo y cero variabilidad. Preserva el formato/label que eligio
 * el disenador (ej. "2.000 m² terreno"), solo corrige el numero.
 */
export function reconcileSpecsWithRealData(
  specs: string[],
  property: Pick<CreativeDesignerInput["property"], "area" | "habitaciones" | "banos">
): string[] {
  return specs.map((spec) => {
    if (property.area && /m[²2]/i.test(spec)) {
      const real = extractNumericToken(property.area);
      const written = extractNumericToken(spec);
      if (real && written && !sameNumber(real, written)) {
        return spec.replace(written, real);
      }
    }
    if (property.habitaciones != null && /hab/i.test(spec)) {
      const written = extractNumericToken(spec);
      if (written && !sameNumber(written, String(property.habitaciones))) {
        return spec.replace(written, String(property.habitaciones));
      }
    }
    if (property.banos != null && /ba[ñn]o/i.test(spec)) {
      const written = extractNumericToken(spec);
      if (written && !sameNumber(written, String(property.banos))) {
        return spec.replace(written, String(property.banos));
      }
    }
    return spec;
  });
}

export async function generateDesignSpec(
  input: CreativeDesignerInput,
  caller: ClaudeCaller = defaultCaller
): Promise<GenerateDesignSpecResult> {
  const prompt = buildCreativeDesignerPrompt(input);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await caller(prompt);
    try {
      const json = tryParseJSON(result.text);
      const parsed = designSpecSchema.parse(json);
      const output: DesignSpec = { ...parsed, specs: reconcileSpecsWithRealData(parsed.specs, input.property) };
      return { output, promptVersion: CREATIVE_DESIGNER_PROMPT_VERSION, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
    } catch (err) {
      lastError = err;
    }
  }

  throw new FatalError(
    `Disenador creativo no produjo un spec valido para ${input.property.ref} tras 2 intentos: ${(lastError as Error)?.message}`,
    lastError
  );
}

import { getSupabase } from "./supabase.js";

export interface RecordContentGenerationInput {
  org_id: string;
  property_id?: string | null;
  publication_id?: string | null;
  kind: "copy" | "image_analysis" | "image_generation" | "property_context";
  style_variant?: string | null;
  model?: string;
  prompt_version?: string;
  input?: unknown;
  output?: unknown;
  tokens_in?: number;
  tokens_out?: number;
}

export async function recordContentGeneration(input: RecordContentGenerationInput): Promise<void> {
  const { error } = await getSupabase().from("content_generations").insert(input);
  if (error) throw new Error(`recordContentGeneration: ${error.message}`);
}

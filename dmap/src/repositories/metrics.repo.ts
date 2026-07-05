import { getSupabase } from "./supabase.js";

export interface MetricsSnapshotInput {
  org_id: string;
  publication_target_id: string;
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  saved?: number;
  raw?: Record<string, unknown>;
}

export async function recordMetricsSnapshot(input: MetricsSnapshotInput): Promise<void> {
  const { error } = await getSupabase().from("post_metrics").insert(input);
  if (error) throw new Error(`recordMetricsSnapshot: ${error.message}`);
}

export async function listLatestMetricsByTarget(publicationTargetId: string) {
  const { data, error } = await getSupabase()
    .from("post_metrics")
    .select()
    .eq("publication_target_id", publicationTargetId)
    .order("collected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`listLatestMetricsByTarget: ${error.message}`);
  return data;
}

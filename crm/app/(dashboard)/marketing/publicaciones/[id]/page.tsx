import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTeamRoster } from "@/lib/team";
import type { PublicationAssetRow, PublicationEventRow, PublicationRow, PublicationTargetRow, SocialConnectionRow } from "@/lib/marketing";
import ContentStudio from "@/components/marketing/content-studio";

export const dynamic = "force-dynamic";

export default async function PublicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: publicationData } = await supabase
    .from("publications")
    .select("*, properties(ref,titulo,zona,ciudad,operacion,precio,link)")
    .eq("id", id)
    .maybeSingle();

  if (!publicationData) notFound();

  const publication = publicationData as PublicationRow & {
    properties: { ref: string; titulo: string; zona: string | null; ciudad: string | null; operacion: string | null; precio: string | null; link: string | null } | null;
  };

  const [{ data: assets }, { data: events }, { data: connections }, { data: targets }] = await Promise.all([
    supabase.from("publication_assets").select("*").eq("publication_id", id).order("position", { ascending: true }),
    supabase.from("publication_events").select("*").eq("publication_id", id).order("created_at", { ascending: true }),
    supabase
      .from("social_connections")
      .select("id,org_id,platform,external_account_id,external_account_name,linked_page_id,status,last_validated_at,last_error")
      .eq("org_id", publication.org_id)
      .eq("status", "connected"),
    supabase.from("publication_targets").select("*").eq("publication_id", id),
  ]);

  const roster = publication.approved_by ? await getTeamRoster() : null;
  const approvedByName = publication.approved_by ? roster?.[publication.approved_by]?.nombre || null : null;

  return (
    <ContentStudio
      publication={publication}
      assets={(assets || []) as PublicationAssetRow[]}
      events={(events || []) as PublicationEventRow[]}
      connections={(connections || []) as SocialConnectionRow[]}
      targets={(targets || []) as PublicationTargetRow[]}
      approvedByName={approvedByName}
    />
  );
}

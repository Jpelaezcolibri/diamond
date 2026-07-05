import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { leadIdForConversation, assertOwnsLead } from "@/lib/lead-access";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { conversationId, modo } = await request.json();
  if (!conversationId || !["bot", "humano"].includes(modo)) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const admin = createAdminClient();
  const leadId = await leadIdForConversation(admin, conversationId);
  if (!leadId) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
  const denied = await assertOwnsLead(admin, user, leadId);
  if (denied) return denied;

  const res = await fetch(
    `${process.env.BOT_API_URL}/api/conversations/${conversationId}/modo`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.BOT_API_KEY!,
      },
      body: JSON.stringify({ modo }),
    }
  ).catch(() => null);

  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    return NextResponse.json(
      { error: body.error || "El bot no respondió" },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const form = await request.formData();
  const conversationId = form.get("conversationId") as string;
  if (!conversationId || !form.get("file")) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const forward = new FormData();
  forward.append("file", form.get("file") as Blob, (form.get("filename") as string) || "archivo");
  if (form.get("caption")) forward.append("caption", form.get("caption") as string);
  if (form.get("replyToId")) forward.append("replyToId", form.get("replyToId") as string);

  const res = await fetch(
    `${process.env.BOT_API_URL}/api/conversations/${conversationId}/media`,
    {
      method: "POST",
      headers: { "x-api-key": process.env.BOT_API_KEY! },
      body: forward,
    }
  ).catch(() => null);

  if (!res || !res.ok) {
    const body = res ? await res.json().catch(() => ({})) : {};
    return NextResponse.json({ error: body.error || "El bot no respondió" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

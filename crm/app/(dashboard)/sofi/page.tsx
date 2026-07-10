import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { userRole, userNombre } from "@/lib/auth";
import { callBot } from "@/lib/bot";
import SofiCommandChat, { type CommandMessage } from "@/components/sofi-command-chat";

export const dynamic = "force-dynamic";

// Centro de Comando (SOFI). Abre la sesion del dia contra el bot y renderiza el
// chat con el briefing ya como primer mensaje.
export default async function SofiPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const r = await callBot<{ sessionId: string; messages: CommandMessage[] }>("/api/assistant/session", {
    viewerUid: user.id,
    role: userRole(user),
    userName: userNombre(user),
  });

  return (
    <SofiCommandChat
      sessionId={r.ok ? r.data.sessionId : null}
      initialMessages={r.ok ? r.data.messages : []}
      initialError={r.ok ? null : r.error}
    />
  );
}

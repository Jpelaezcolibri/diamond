import { callBot } from "@/lib/bot";
import AvisoCelular, { type DatosAviso } from "@/components/aviso-celular";

export const dynamic = "force-dynamic";

// Lo que abre la asesora desde el aviso de WhatsApp (Juan, 2026-09-02, opción
// D). Sin login: el token es la autorización (ver crm/middleware.ts, que deja
// pasar /aviso). Es un renderer fino: el bot arma los datos con las mismas
// piezas del DM manual y marca "visto" al responder.
export default async function AvisoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await callBot<DatosAviso>("/api/grupos/aviso/ver", { token });
  if (!r.ok) {
    return (
      <main className="mx-auto min-h-dvh max-w-md bg-white px-6 py-16 text-center">
        <p className="text-4xl">🔗</p>
        <h1 className="font-display mt-3 text-xl font-extrabold text-slate-900">Este link no existe o venció</h1>
        <p className="mt-2 text-sm text-slate-600">
          Abrí el aviso desde el CRM, en Grupos, o pedile a Sofi que te lo mande de nuevo.
        </p>
      </main>
    );
  }
  return <AvisoCelular datos={r.data as DatosAviso} token={token} />;
}

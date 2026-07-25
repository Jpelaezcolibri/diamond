import { NextResponse } from "next/server";
import { getTenantConfig } from "@/config/tenant";
import { propertyWhatsAppUrl } from "@/lib/whatsapp";

// Link corto para WhatsApp de una propiedad (ej. diamondinmobiliaria.com/wa/9730226),
// pensado para captions de Meta: el wa.me con el mensaje precargado trae texto
// URL-encoded largo (%20, %2C...) que se ve poco profesional pegado en un post,
// y en Instagram ademas no es clicable — un link corto de nuestro propio dominio
// se lee limpio y sigue resolviendo al mismo deep link con la ref precargada
// (Sofi la sigue detectando igual en engine.js).
export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const config = getTenantConfig();
  // ?lang=en → prellenado en ingles (para captions/campañas dirigidas a
  // angloparlantes; Sofi detecta el idioma por el prellenado).
  const lang = new URL(req.url).searchParams.get("lang") === "en" ? "en" : "es";
  return NextResponse.redirect(propertyWhatsAppUrl(config, ref, lang), { status: 302 });
}

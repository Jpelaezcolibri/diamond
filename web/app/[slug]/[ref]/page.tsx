import { notFound, permanentRedirect } from "next/navigation";
import { getPropertyByRef } from "@/services/properties";

// RESCATE DE LOS LINKS DE WASI QUE YA CIRCULAN (2026-09-18).
//
// Wasi arma los links de sus fichas con el dominio configurado en la cuenta, y
// ahi esta configurado diamondinmobiliaria.com — que sirve ESTA landing, no el
// sitio de Wasi. Asi que todo lo que el equipo compartio desde el panel de
// Wasi quedo apuntando a rutas que aca no existen:
//
//   /apartamento-alquiler-envigado-medellin/10416693?shared=whatsapp
//
// Esos mensajes ya se enviaron: estan en el WhatsApp de cada cliente y en cada
// post, y no se pueden corregir. El dia que Wasi mueva su sitio a
// info.diamondinmobiliaria.com los links NUEVOS van a abrir solos, pero los
// viejos van a seguir cayendo aca para siempre. Por eso el rescate vive en la
// landing y no en el bot.
//
// La FORMA identifica al link: dos segmentos y el ultimo todos digitos. La
// ficha propia es /propiedades/<titulo>-<ref>, y "propiedades" es un segmento
// estatico, que en el enrutador de Next le gana a este dinamico: esta ruta no
// la pisa.
//
// Redireccion PERMANENTE (permanentRedirect, que en Next responde 308) y no
// temporal: la propiedad vive de verdad en la ficha canonica, y Google ya
// indexo algunas de estas URLs con nuestro dominio.

const SOLO_DIGITOS = /^\d{4,}$/;

export default async function WasiLinkRescue({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { ref } = await params;

  // No tiene forma de link de Wasi: no es de este camino.
  if (!SOLO_DIGITOS.test(ref)) notFound();

  const property = await getPropertyByRef(ref);

  // Sin propiedad no se inventa un destino. La pagina de "no existe" ya dice
  // lo correcto —puede que se haya vendido o arrendado— y ofrece el inventario.
  if (!property) notFound();

  permanentRedirect(`/propiedades/${property.slug}`);
}

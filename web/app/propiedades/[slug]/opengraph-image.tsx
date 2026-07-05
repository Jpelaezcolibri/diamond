import { ImageResponse } from "next/og";
import { getTenantConfig } from "@/config/tenant";
import { getPropertyByRef } from "@/services/properties";
import { refFromSlug } from "@/lib/slug";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Ficha de la propiedad";

/** OG image por propiedad: foto + precio + marca. Para compartir en WhatsApp. */
export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const config = getTenantConfig();
  const property = await getPropertyByRef(refFromSlug(slug));

  const colors = config.theme.colors;
  const bg = colors.background.light;
  const ink = colors.foreground.light;
  const accent = colors.accent.light;

  if (!property) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: bg, color: ink, fontSize: 56 }}>
          {config.brand.name}
        </div>
      ),
      size
    );
  }

  const location = [property.zona, property.ciudad].filter(Boolean).join(", ");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: bg }}>
        {property.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={property.images[0]}
            alt=""
            width={640}
            height={630}
            style={{ width: 640, height: 630, objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: 640, height: 630, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: ink, color: accent, fontSize: 200 }}>
            {config.brand.monogram}
          </div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: 48, color: ink }}>
          <div style={{ fontSize: 22, letterSpacing: 4, textTransform: "uppercase", color: accent }}>
            {config.brand.name}
          </div>
          <div style={{ fontSize: 34, marginTop: 20, lineHeight: 1.25, display: "flex" }}>
            {property.tipo} en {property.operacion.toLowerCase()}
          </div>
          {location ? <div style={{ fontSize: 26, marginTop: 10, opacity: 0.7, display: "flex" }}>{location}</div> : null}
          <div style={{ fontSize: 54, marginTop: 28, fontWeight: 700, display: "flex" }}>{property.precio.formatted}</div>
          <div style={{ fontSize: 20, marginTop: 24, opacity: 0.6, display: "flex" }}>Ref. {property.ref}</div>
        </div>
      </div>
    ),
    size
  );
}

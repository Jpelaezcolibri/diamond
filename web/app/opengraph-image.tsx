import { ImageResponse } from "next/og";
import { getTenantConfig } from "@/config/tenant";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Portada";

/** OG image de marca para home y paginas sin imagen propia. */
export default function OgImage() {
  const config = getTenantConfig();
  const colors = config.theme.colors;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.foreground.light,
          color: colors.background.light,
          padding: 80,
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `3px solid ${colors.accent.light}`,
            color: colors.accent.light,
            fontSize: 44,
          }}
        >
          {config.brand.monogram}
        </div>
        <div style={{ fontSize: 58, marginTop: 36, textAlign: "center", display: "flex" }}>
          {config.brand.name}
        </div>
        <div style={{ fontSize: 28, marginTop: 18, opacity: 0.75, textAlign: "center", display: "flex" }}>
          {config.brand.tagline}
        </div>
      </div>
    ),
    size
  );
}

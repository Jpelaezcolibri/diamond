import { ImageResponse } from "next/og";
import { getTenantConfig } from "@/config/tenant";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Favicon dinámico por tenant: monograma sobre los colores de marca.
export default function Icon() {
  const config = getTenantConfig();
  const { colors } = config.theme;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.foreground.light,
          color: colors.accent.light,
          fontSize: 40,
          fontWeight: 700,
          borderRadius: 12,
        }}
      >
        {config.brand.monogram}
      </div>
    ),
    size
  );
}

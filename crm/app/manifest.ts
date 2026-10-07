import type { MetadataRoute } from "next";

// App instalable en el celular (App de asesores F1, 2026-10-07).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Diamond — Asesores",
    short_name: "Diamond",
    description: "Tus pendientes, leads, agenda y avisos de Sofi.",
    start_url: "/pendientes",
    display: "standalone",
    background_color: "#0b1526",
    theme_color: "#0b1526",
    icons: [
      { src: "/icon.png", sizes: "1254x1254", type: "image/png", purpose: "any" },
    ],
  };
}

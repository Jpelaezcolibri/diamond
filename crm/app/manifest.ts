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
      // El emblema de Diamond (sin el texto, que no se lee a tamaño de icono).
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android lo recorta en círculo: este trae margen de zona segura.
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

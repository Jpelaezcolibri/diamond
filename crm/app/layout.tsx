import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diamond CRM",
  description: "Inbox y leads del agente Sofi",
  // Icono de la app instalada en iPhone (App de asesores, 2026-10-07): el
  // emblema de Diamond, sin el texto, para que se lea a tamaño de icono.
  icons: { apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Diamond", statusBarStyle: "black-translucent" },
};

// Tipografía de títulos (rediseño de /grupos, 2026-09-02). Se expone como
// variable CSS y la utilidad `font-display` de globals.css la usa: la fuente
// del cuerpo del CRM no cambia.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}

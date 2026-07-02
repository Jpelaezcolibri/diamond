import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Diamond CRM",
  description: "Inbox y leads del agente Sofi",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { getTenantConfig } from "@/config/tenant";
import { getFontPreset } from "@/config/fonts";
import { buildThemeCss } from "@/lib/theme";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { ThemeProvider } from "@/components/shared/theme-provider";
import { Header } from "@/components/navigation/header";
import { Footer } from "@/components/layout/footer";
import { WhatsAppFab } from "@/components/navigation/whatsapp-fab";
import { MetaPixel } from "@/components/shared/meta-pixel";
import { generalWhatsAppUrl } from "@/lib/whatsapp";
import { organizationJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/shared/json-ld";
import "@/styles/globals.css";

const config = getTenantConfig();
const fonts = getFontPreset(config.theme.fontPreset);

export const metadata: Metadata = {
  metadataBase: new URL(config.seo.baseUrl),
  title: {
    default: config.seo.defaultTitle,
    template: config.seo.titleTemplate,
  },
  description: config.seo.description,
  keywords: config.seo.keywords,
  openGraph: {
    siteName: config.brand.name,
    locale: "es_CO",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO" className={fonts.className} suppressHydrationWarning>
      <head>
        {/* Theme del tenant server-rendered: cero FOUC, cero JS de theming */}
        <style id="ref-theme" dangerouslySetInnerHTML={{ __html: fonts.css + buildThemeCss(config.theme) }} />
      </head>
      <body className="flex min-h-svh flex-col">
        {config.integrations.metaPixelId ? <MetaPixel pixelId={config.integrations.metaPixelId} /> : null}
        <JsonLd data={organizationJsonLd(config)} />
        <NuqsAdapter>
          <ThemeProvider mode={config.theme.darkMode}>
            <Header />
            <div className="flex-1">{children}</div>
            <Footer />
            <WhatsAppFab href={generalWhatsAppUrl(config)} />
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}

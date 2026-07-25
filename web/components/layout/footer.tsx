import Link from "next/link";
import { Instagram, Facebook, Youtube, MessageCircle } from "lucide-react";
import { getTenantConfig } from "@/config/tenant";
import { T } from "@/components/shared/t";
import { LT } from "@/components/shared/lt";
import { WaLink } from "@/components/shared/wa-link";
import { Container } from "./container";

export function Footer() {
  const config = getTenantConfig();
  const year = new Date().getFullYear();
  const { socials } = config.contact;

  return (
    <footer className="border-t border-line bg-surface">
      <Container className="py-14 md:py-16">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <p className="font-heading text-xl">{config.brand.name}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted"><LT v={config.brand.tagline} /></p>
            {config.contact.address ? (
              <p className="mt-3 text-sm text-muted">{config.contact.address}</p>
            ) : null}
          </div>

          <nav aria-label="Footer" className="flex flex-col gap-2 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-muted"><T k="footer.explore" /></p>
            <Link href="/propiedades" className="text-foreground/80 hover:text-foreground">
              <T k="nav.properties" />
            </Link>
            <Link href="/propiedades?operacion=Venta" className="text-foreground/80 hover:text-foreground">
              <T k="footer.forSale" />
            </Link>
            <Link href="/propiedades?operacion=Arriendo" className="text-foreground/80 hover:text-foreground">
              <T k="footer.forRent" />
            </Link>
            <Link href="/vende-tu-propiedad" className="text-foreground/80 hover:text-foreground">
              <T k="nav.sell" />
            </Link>
          </nav>

          <div className="flex flex-col gap-2 text-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-muted"><T k="footer.contact" /></p>
            <WaLink
              number={config.contact.whatsapp.number}
              message={config.contact.whatsapp.generalMessage}
              className="inline-flex items-center gap-2 text-foreground/80 hover:text-foreground"
            >
              <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp
            </WaLink>
            {config.contact.email ? (
              <a href={`mailto:${config.contact.email}`} className="text-foreground/80 hover:text-foreground">
                {config.contact.email}
              </a>
            ) : null}
            <div className="mt-2 flex gap-3">
              {socials.instagram ? (
                <a href={socials.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-muted hover:text-foreground">
                  <Instagram className="size-5" aria-hidden="true" />
                </a>
              ) : null}
              {socials.facebook ? (
                <a href={socials.facebook} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="text-muted hover:text-foreground">
                  <Facebook className="size-5" aria-hidden="true" />
                </a>
              ) : null}
              {socials.youtube ? (
                <a href={socials.youtube} target="_blank" rel="noopener noreferrer" aria-label="YouTube" className="text-muted hover:text-foreground">
                  <Youtube className="size-5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-muted md:flex-row md:items-center md:justify-between">
          <p>
            © {year} {config.brand.legalName ?? config.brand.name}. <T k="footer.rights" />
          </p>
          <p>
            {config.brand.city}, {config.brand.country}
          </p>
        </div>
      </Container>
    </footer>
  );
}

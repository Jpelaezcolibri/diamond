import Link from "next/link";
import Image from "next/image";
import { MessageCircle } from "lucide-react";
import { getTenantConfig } from "@/config/tenant";
import { generalWhatsAppUrl } from "@/lib/whatsapp";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/design-system/button";
import { MobileNav } from "./mobile-nav";

const NAV_LINKS = [
  { href: "/propiedades", label: "Propiedades" },
  { href: "/vende-tu-propiedad", label: "Vende tu propiedad" },
] as const;

export function Header() {
  const config = getTenantConfig();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur-md">
      <Container width="wide" className="flex h-16 items-center justify-between gap-4 md:h-20">
        <Link href="/" className="flex items-center gap-3" aria-label={`${config.brand.name} — inicio`}>
          {config.brand.logo ? (
            <Image
              src={config.brand.logo.light}
              alt={config.brand.logo.alt}
              width={40}
              height={40}
              className="h-9 w-9 rounded-full object-cover md:h-10 md:w-10"
              priority
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-heading text-lg text-primary-foreground">
              {config.brand.monogram}
            </span>
          )}
          <span className="font-heading text-lg tracking-tight md:text-xl">{config.brand.name}</span>
        </Link>

        <nav aria-label="Principal" className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Button asChild variant="whatsapp" size="sm">
            <a href={generalWhatsAppUrl(config)} target="_blank" rel="noopener noreferrer">
              <MessageCircle aria-hidden="true" />
              WhatsApp
            </a>
          </Button>
        </nav>

        <MobileNav
          links={[...NAV_LINKS]}
          whatsappUrl={generalWhatsAppUrl(config)}
          brandName={config.brand.name}
        />
      </Container>
    </header>
  );
}

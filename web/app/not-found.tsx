import Link from "next/link";
import { getTenantConfig } from "@/config/tenant";
import { generalWhatsAppUrl } from "@/lib/whatsapp";
import { EmptyState } from "@/components/shared/empty-state";
import { Container } from "@/components/layout/container";

export default function NotFound() {
  const config = getTenantConfig();
  return (
    <main>
      <Container className="py-section">
        <EmptyState
          title="Esta página no existe (o la propiedad ya no está disponible)"
          description="Puede que el inmueble se haya vendido o arrendado. Nuestro inventario cambia todos los días — mira lo que hay disponible o cuéntanos qué buscas."
          whatsappUrl={generalWhatsAppUrl(config)}
          clearHref="/propiedades"
        />
        <p className="sr-only">
          <Link href="/">Volver al inicio</Link>
        </p>
      </Container>
    </main>
  );
}

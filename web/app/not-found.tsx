import Link from "next/link";
import { getTenantConfig } from "@/config/tenant";
import { generalWhatsAppUrl } from "@/lib/whatsapp";
import { EmptyState } from "@/components/shared/empty-state";
import { Container } from "@/components/layout/container";
import { T } from "@/components/shared/t";

export default function NotFound() {
  const config = getTenantConfig();
  return (
    <main>
      <Container className="py-section">
        <EmptyState
          title={<T k="emptyState.notFoundTitle" />}
          description={<T k="emptyState.notFoundDescription" />}
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

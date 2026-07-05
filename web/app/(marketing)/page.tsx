import { getTenantConfig } from "@/config/tenant";
import { RenderSections } from "@/components/sections/registry";

// La home ES la config: orden, on/off y contenido de cada seccion viven en
// config/tenants/<tenant>.ts. Esta pagina no se toca para re-brandear.
export default function HomePage() {
  const config = getTenantConfig();
  return <main>{<RenderSections sections={config.home.sections} />}</main>;
}

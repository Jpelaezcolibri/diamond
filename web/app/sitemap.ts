import type { MetadataRoute } from "next";
import { getTenantConfig } from "@/config/tenant";
import { getProperties } from "@/services/properties";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = getTenantConfig();
  const base = config.seo.baseUrl;
  const properties = await getProperties();

  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/propiedades`, changeFrequency: "daily", priority: 0.9 },
    ...(config.sellPage.enabled
      ? [{ url: `${base}/vende-tu-propiedad`, changeFrequency: "monthly" as const, priority: 0.7 }]
      : []),
    ...properties.map((p) => ({
      url: `${base}/propiedades/${p.slug}`,
      lastModified: p.createdAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}

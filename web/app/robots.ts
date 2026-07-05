import type { MetadataRoute } from "next";
import { getTenantConfig } from "@/config/tenant";

export default function robots(): MetadataRoute.Robots {
  const config = getTenantConfig();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${config.seo.baseUrl}/sitemap.xml`,
  };
}

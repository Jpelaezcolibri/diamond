import type { NextConfig } from "next";
import path from "node:path";

// Content Security Policy. Pragmática para un sitio de marketing Next.js:
// 'unsafe-inline' en script/style es necesario sin infraestructura de nonces
// (Next inyecta el bootstrap de hidratación inline; el theme del tenant y
// framer-motion inyectan estilos inline). Aun así bloquea scripts externos,
// framing y exfiltración. Upgrade futuro: CSP basada en nonces.
// Meta Pixel: script desde connect.facebook.net; el evento viaja como imagen
// (facebook.com/tr) o beacon/XHR, por eso va en img-src Y connect-src.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.wasi.co https://images.unsplash.com https://www.facebook.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://www.facebook.com https://connect.facebook.net",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd()),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "statics.wasi.co" },
      { protocol: "https", hostname: "**.wasi.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

# DMAP — Diamond Growth Engine

Microservicio de automatización de marketing inmobiliario. Ver [ARCHITECTURE.md](ARCHITECTURE.md) para el diseño completo (flujos, modelo de datos, seguridad, plan de work packages).

## Comandos

```bash
npm install
npm run dev         # tsx watch, puerto PORT (.env, por defecto 3010)
npm run build       # compila a dist/
npm start           # producción (requiere build previo)
npm test            # vitest
npm run typecheck
```

## Variables de entorno

Ver [.env.example](.env.example). Todas son requeridas (falla al arrancar si falta alguna): `DMAP_API_KEY`, `DMAP_ENCRYPTION_KEY` (32 bytes base64: `openssl rand -base64 32`), `REDIS_URL`, `SUPABASE_URL`+`SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `META_APP_ID`+`META_APP_SECRET`, `DMAP_PUBLIC_URL`, `CRM_URL`.

## Estado

En construcción por work packages (WP0–WP9, ver ARCHITECTURE.md §15). WP0 (esqueleto: Fastify+TS, auth por API key, health/metrics) completo.

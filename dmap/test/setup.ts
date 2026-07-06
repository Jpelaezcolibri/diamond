// Se carga antes de cualquier test (ver vitest.config.ts -> setupFiles).
// env.ts valida process.env al importarse; sin esto, cualquier modulo que
// dependa (directa o transitivamente) de src/config/env.ts fallaria al
// arrancar los tests con process.exit(1).
process.env.DMAP_API_KEY ??= "test-api-key-0123456789";
process.env.DMAP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ??= "service-key";
process.env.ANTHROPIC_API_KEY ??= "sk-ant-test";
process.env.META_APP_ID ??= "123456";
process.env.META_APP_SECRET ??= "secret";
process.env.DMAP_PUBLIC_URL ??= "http://localhost:3010";
process.env.CRM_URL ??= "http://localhost:3000";
process.env.CONTACT_WHATSAPP_NUMBER ??= "573044653609";

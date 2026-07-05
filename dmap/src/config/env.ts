import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3010),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DMAP_API_KEY: z.string().min(16, "DMAP_API_KEY debe tener al menos 16 caracteres"),
  DMAP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "DMAP_ENCRYPTION_KEY debe ser 32 bytes en base64"
    }),

  REDIS_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-5"),

  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),

  DMAP_PUBLIC_URL: z.string().url(),
  CRM_URL: z.string().url()
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Configuracion invalida en dmap:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

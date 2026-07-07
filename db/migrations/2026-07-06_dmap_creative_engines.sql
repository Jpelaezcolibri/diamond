-- Migracion: motores de creativos de bajo costo "hybrid" y "designer".
-- Ejecutar en Supabase SQL Editor.
--
-- Contexto (2026-07-06): el motor "ai" (GPT Image high) gastaba ~USD 5/dia.
-- Nuevos motores:
--   - designer: Disenador (Claude) produce un design spec y la plantilla
--     satori lo renderiza sobre la foto real. Costo por imagen: $0.
--   - hybrid: igual, pero Gemini (Nano Banana, ~$0.039/imagen) embellece la
--     foto SIN texto antes de que satori ponga el texto encima. Sin
--     GEMINI_API_KEY degrada solo a designer.
--
-- El CHECK inline de la migracion 2026-07-06_dmap_ai_engine.sql genero un
-- constraint con nombre por defecto sobre la columna creative_engine: se
-- elimina y se recrea con los cuatro valores.

alter table org_marketing_settings
  drop constraint if exists org_marketing_settings_creative_engine_check;

alter table org_marketing_settings
  add constraint org_marketing_settings_creative_engine_check
  check (creative_engine in ('ai', 'template', 'hybrid', 'designer'));

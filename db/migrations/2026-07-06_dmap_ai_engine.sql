-- Migracion: motor multiagente de creativos IA ("Diamond AI Creative Director").
-- Ejecutar en Supabase SQL Editor.
--
-- Flujo: Director Creativo (Claude) construye el prompt maestro -> GPT Image
-- (OpenAI gpt-image-1, /v1/images/edits con la foto real de la propiedad)
-- genera el creativo -> Critico Creativo (Claude vision) lo evalua contra la
-- rubrica Diamond y puede pedir 1 regeneracion (max 2 rondas). Fallback
-- automatico a la plantilla satori ante cualquier fallo de OpenAI.

-- content_generations registra tambien las generaciones de imagen (el
-- historial de rondas/score del critico va dentro de `output`, no como
-- kind aparte).
alter table content_generations drop constraint if exists content_generations_kind_check;
alter table content_generations add constraint content_generations_kind_check
  check (kind in ('copy', 'image_analysis', 'image_generation'));

-- Motor de creativos por organizacion: "ai" (multiagente GPT Image, default)
-- o "template" (plantilla satori clasica). Sin OPENAI_API_KEY configurada en
-- el servicio, "ai" degrada solo a template sin error.
alter table org_marketing_settings
  add column if not exists creative_engine text not null default 'ai'
  check (creative_engine in ('ai', 'template'));

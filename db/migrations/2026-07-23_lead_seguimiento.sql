-- Migracion: seguimiento automatico de Sofi al cliente (Capa B Fase 1).
-- Correr a mano en el SQL Editor de Supabase. Idempotente.
--
-- leads.seguimiento (jsonb): registro de los toques de seguimiento enviados.
-- Fase 1 usa { "t24_sent_at": "<iso>" } — un unico toque dentro de la ventana
-- de 24h de WhatsApp. Fases futuras (72h/7d con plantilla) agregan sus claves
-- aqui mismo sin nueva migracion.
alter table leads add column if not exists seguimiento jsonb;

-- Migracion: estado real de entrega de mensajes salientes.
-- Correr a mano en el SQL Editor de Supabase. Idempotente.
--
-- messages.delivery ('sent' | 'failed', null = mensaje legado o entrante del
-- cliente): antes sendWhatsApp devolvia el wamid o null y ningun consumidor
-- distinguia el null de un envio exitoso — el CRM mostraba como "enviado" un
-- mensaje de Sofi (o del asesor) que Meta nunca le entrego al cliente (token
-- vencido, numero invalido, timeout). delivery_error guarda el motivo, solo
-- para diagnostico interno (no se muestra al cliente).
alter table messages add column if not exists delivery text;
alter table messages add column if not exists delivery_error text;

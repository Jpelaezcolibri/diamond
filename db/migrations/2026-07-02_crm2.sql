-- Migracion CRM v2 — chat multimedia + kanban. Ejecutar en el SQL Editor de Supabase
-- (requiere 2026-07-02_crm.sql aplicada antes)

-- 1. Mensajes multimedia y respuestas citadas
alter table messages add column if not exists type text not null default 'text'; -- text | image | audio | document | video
alter table messages add column if not exists media_url text;
alter table messages add column if not exists media_mime text;
alter table messages add column if not exists wa_message_id text;   -- id de Meta (wamid) para citar
alter table messages add column if not exists reply_to_id uuid references messages(id);
create index if not exists idx_messages_wa_id on messages(wa_message_id) where wa_message_id is not null;

-- 2. Categoria del lead para los tableros: compra | alquiler | otros
alter table leads add column if not exists categoria text not null default 'otros';
update leads set categoria = 'alquiler' where categoria = 'otros' and (tipo_interes ilike '%arriendo%' or tipo_interes ilike '%alquil%');
update leads set categoria = 'compra'  where categoria = 'otros' and (forma_pago is not null or tipo_interes ilike '%venta%' or tipo_interes ilike '%compra%' or property_ref_origen is not null);

-- 3. Bucket de storage para fotos y audios del chat (lectura publica, escritura solo service_role)
insert into storage.buckets (id, name, public) values ('media', 'media', true)
on conflict (id) do nothing;

-- Publicador mixto y acorde al grupo (spec 2026-10-26-publicador-mixto).
-- 1. Override manual del perfil del grupo: {"zonas":[...],"operacion":"venta|arriendo","tipos":[...]}.
alter table whatsapp_groups add column if not exists perfil jsonb;
-- 2. Categoria nueva: arriendo mensual con o sin amoblar.
alter table whatsapp_groups drop constraint if exists whatsapp_groups_publica_check;
alter table whatsapp_groups add constraint whatsapp_groups_publica_check
  check (publica is null or publica in ('amoblados', 'fincas', 'ofertas', 'arriendos'));
-- 3. ARRIENDOS 7AM 8PM (717 miembros) pasa a arriendos (Juan, 2026-10-26).
update whatsapp_groups set publica = 'arriendos' where jid = '573003371490-1496864741@g.us';

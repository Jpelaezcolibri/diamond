-- Migracion CRM — ejecutar en el SQL Editor de Supabase
-- (la base ya debe tener db/schema.sql aplicado)

-- 1. Modo de atencion por conversacion: 'bot' (Sofi) | 'humano' (asesor via CRM)
alter table conversations add column if not exists modo text not null default 'bot';

-- 2. Seguridad para el CRM: el equipo autenticado puede LEER;
--    las escrituras pasan solo por el bot (service_role, que ignora RLS)
alter table organizations enable row level security;
alter table advisors enable row level security;
alter table properties enable row level security;
alter table leads enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

drop policy if exists "team read" on organizations;
create policy "team read" on organizations for select to authenticated using (true);
drop policy if exists "team read" on advisors;
create policy "team read" on advisors for select to authenticated using (true);
drop policy if exists "team read" on properties;
create policy "team read" on properties for select to authenticated using (true);
drop policy if exists "team read" on leads;
create policy "team read" on leads for select to authenticated using (true);
drop policy if exists "team read" on conversations;
create policy "team read" on conversations for select to authenticated using (true);
drop policy if exists "team read" on messages;
create policy "team read" on messages for select to authenticated using (true);

-- 3. Realtime para el inbox (mensajes y conversaciones en vivo)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conversations') then
    alter publication supabase_realtime add table conversations;
  end if;
end $$;

-- Notificaciones y suscripciones push de la App de asesores (Fase 1).
--
-- POR QUE (2026-10-07): Juan pidio que el asesor tenga "algun aviso efectivo
-- no solo en el crm si no tambien en el whatsapp" cuando le piden un asesor,
-- le agendan una visita o se la confirman. La campana del CRM y el push del
-- celular leen de aca; WhatsApp sigue saliendo por su camino.
-- Spec: docs/superpowers/specs/2026-10-07-app-diamond-asesores-design.md §4.
--
-- Solo crea tablas, indices, politicas y publicacion. Idempotente. No toca
-- datos existentes.

create table if not exists notificaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  advisor_id uuid not null references advisors(id) on delete cascade,
  tipo text not null,
  titulo text not null,
  cuerpo text,
  link text,
  lead_id uuid,
  leida_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notificaciones_asesor on notificaciones (advisor_id, created_at desc);
create index if not exists idx_notificaciones_no_leidas on notificaciones (advisor_id) where leida_at is null;

create table if not exists push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  advisor_id uuid not null references advisors(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_suscripciones_asesor on push_suscripciones (advisor_id);

alter table notificaciones enable row level security;
alter table push_suscripciones enable row level security;

-- Cada asesor ve y marca SOLO las suyas (las escribe el bot con la service key).
drop policy if exists "propias select" on notificaciones;
create policy "propias select" on notificaciones for select to authenticated
  using (advisor_id in (select id from advisors where auth_user_id = auth.uid()));
drop policy if exists "propias update" on notificaciones;
create policy "propias update" on notificaciones for update to authenticated
  using (advisor_id in (select id from advisors where auth_user_id = auth.uid()));

drop policy if exists "propias select" on push_suscripciones;
create policy "propias select" on push_suscripciones for select to authenticated
  using (advisor_id in (select id from advisors where auth_user_id = auth.uid()));
drop policy if exists "propias insert" on push_suscripciones;
create policy "propias insert" on push_suscripciones for insert to authenticated
  with check (advisor_id in (select id from advisors where auth_user_id = auth.uid()));
drop policy if exists "propias delete" on push_suscripciones;
create policy "propias delete" on push_suscripciones for delete to authenticated
  using (advisor_id in (select id from advisors where auth_user_id = auth.uid()));

-- La campana escucha los INSERT en vivo.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table notificaciones;
  end if;
end $$;

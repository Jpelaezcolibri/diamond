-- Migracion: propiedades de aliados con dueno (asesor que las registro) +
-- dedup de avisos inmediatos al cliente. Ejecutar en Supabase SQL Editor.
--
-- registrado_por: el asesor (login del CRM) que registro la propiedad del
-- colega desde Sofi-Comando. Nullable: las filas del flujo viejo (colega
-- escribiendole directo al bot publico) quedan sin dueno y siguen el
-- comportamiento actual (nota en la alerta de transferencia, asesor de la
-- especialidad) — no se migran datos existentes.
alter table ally_properties add column if not exists registrado_por uuid references auth.users(id) on delete set null;

-- Dedup + auditoria: evita mandarle varios WhatsApp al mismo asesor si el
-- mismo cliente insiste varias veces en la conversacion sobre el mismo match.
create table if not exists ally_property_alerts (
  id uuid primary key default gen_random_uuid(),
  ally_property_id uuid not null references ally_properties(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (ally_property_id, lead_id)
);

create index if not exists idx_ally_property_alerts_org on ally_property_alerts(org_id);

-- RLS: mismo patron que ally_properties — solo lectura para el equipo
-- autenticado; las escrituras (bot) pasan por el service_role.
alter table ally_property_alerts enable row level security;

drop policy if exists "team read" on ally_property_alerts;
create policy "team read" on ally_property_alerts for select to authenticated using (true);

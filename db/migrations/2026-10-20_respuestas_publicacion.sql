-- Respuestas de colegas a nuestras publicaciones en grupos (spec
-- docs/superpowers/specs/2026-10-20-publicaciones-y-respuestas-design.md).
-- Solo agrega.

create table if not exists respuestas_publicacion (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  property_ref text not null,
  publicacion_id uuid references grupo_publicaciones(id) on delete set null,
  group_id uuid references whatsapp_groups(id) on delete set null,
  via text not null check (via in ('sofi', 'linea', 'grupo')),
  colega_lid text,
  colega_telefono text,
  colega_nombre text,
  colega_clave text not null, -- coalesce(colega_lid, colega_telefono)
  primer_texto text,
  primer_at timestamptz not null default now(),
  ultimo_entrante_at timestamptz not null default now(),
  mensajes integer not null default 1,
  atendida_at timestamptz,
  atendida_por text check (atendida_por is null or atendida_por in ('sofi', 'linea', 'manual')),
  recordatorio_at timestamptz,
  puente_at timestamptz,
  seguimiento_at timestamptz,
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, property_ref, colega_clave)
);
create index if not exists respuestas_publicacion_abiertas_idx
  on respuestas_publicacion (org_id, atendida_at, ultimo_entrante_at);
alter table respuestas_publicacion enable row level security;
drop policy if exists "team read" on respuestas_publicacion;
create policy "team read" on respuestas_publicacion for select to authenticated using (true);

-- El CRM lee las publicaciones (hoy sin politica: no las veria).
drop policy if exists "team read" on grupo_publicaciones;
create policy "team read" on grupo_publicaciones for select to authenticated using (true);

-- Lo que la linea le escribe a un colega (salida humana) para saber si atendio.
alter table linea_dm add column if not exists direccion text not null default 'entrada'
  check (direccion in ('entrada', 'salida'));

-- Automatico o a mano.
alter table grupo_publicaciones add column if not exists origen text not null default 'auto'
  check (origen in ('auto', 'manual'));
update grupo_publicaciones set origen = 'manual'
where property_ref = '10505566' and created_at >= '2026-10-20T20:00:00Z';
update grupo_publicaciones set origen = 'manual'
where created_at < '2026-10-19T21:00:00Z';

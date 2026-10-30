-- Pendientes de contactar por la asesora (spec 2026-10-30-pendientes-excel-asesoras).
-- Los crea scheduler/sin-respuesta.js; los manda scheduler/excel-pendientes.js
-- en un Excel a las 8 a. m. y 2 p. m.; los cierra la devolucion del Excel.
create sequence if not exists contactos_pendientes_seq;
create table if not exists contactos_pendientes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('C-' || lpad(nextval('contactos_pendientes_seq')::text, 4, '0')),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  asesor_id uuid references advisors(id) on delete set null,
  motivo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','enviado','resuelto','cerrado')),
  intentos int not null default 0,
  lote_id text,
  enviado_at timestamptz,
  resultado text,
  nota text,
  resuelto_at timestamptz,
  resuelto_por text,
  archivo_url text,
  created_at timestamptz not null default now()
);
create unique index if not exists contactos_pendientes_uno_abierto on contactos_pendientes (lead_id) where estado in ('pendiente','enviado');
create index if not exists contactos_pendientes_org_estado on contactos_pendientes (org_id, estado);
alter table contactos_pendientes enable row level security;
drop policy if exists "team read" on contactos_pendientes;
create policy "team read" on contactos_pendientes for select to authenticated using (true);

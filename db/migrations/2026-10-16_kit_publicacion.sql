-- Migracion: kit de publicacion en grupos + captacion de duenos para arriendo
-- (spec docs/superpowers/specs/2026-10-16-kit-publicacion-y-duenos-arriendo-design.md).
-- Solo AGREGA: no borra ni cambia nada existente. Ejecutar en Supabase SQL Editor.
-- El bot y el CRM funcionan sin ella (escritura best-effort); sin ella el kit
-- no muestra "compartida hace N dias" ni el KPI de clientes, y la ficha del
-- dueno no se guarda en la base (si viaja en la alerta).

-- 1. Cada vez que una asesora comparte/copia/descarga un post del kit.
create table if not exists kit_publicaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  property_ref text not null,
  user_id uuid references auth.users(id) on delete set null,
  accion text not null, -- compartir | copiar | descargar
  created_at timestamptz not null default now()
);
create index if not exists kit_publicaciones_org_ref_idx
  on kit_publicaciones (org_id, property_ref, created_at desc);
alter table kit_publicaciones enable row level security;

-- 2. Lead que llego por un post del kit ("Hola, vi en un grupo la Ref N").
alter table leads add column if not exists kit_ref text;
alter table leads add column if not exists kit_at timestamptz;

-- 3. Ficha del inmueble de un dueno que quiere arrendar:
--    { zona, tipo, habitaciones, canon, amoblado, periodo: mensual|corta, rnt, ph_permite }
alter table leads add column if not exists inmueble_ofrecido jsonb;

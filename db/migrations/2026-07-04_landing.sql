-- Migracion: soporte para la landing publica (web/) — REF Framework
-- Ejecutar en Supabase SQL Editor.

-- 1. Imagenes de propiedades (URLs, pobladas por scripts/sync_wasi_public.py).
--    jsonb array de strings; el sync reemplaza el set completo por propiedad.
alter table properties add column if not exists images jsonb not null default '[]'::jsonb;

-- 2. Lectura publica del catalogo para la landing (rol anon).
--    Solo propiedades disponibles. organizations, leads, conversations y
--    messages permanecen cerradas al rol anon.
drop policy if exists "public catalog read" on properties;
create policy "public catalog read" on properties
  for select to anon
  using (disponible = true);

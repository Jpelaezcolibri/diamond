-- Migracion: politicas RLS para las tablas de DMAP.
-- Ejecutar en Supabase SQL Editor.
--
-- Sintoma que corrige: el CRM (rol authenticated, via sesion de Supabase
-- Auth) recibia 0 filas de sync_runs / property_change_events / publications
-- aunque los datos existian — el Dashboard de Marketing decia "Todavia no se
-- ha ejecutado ninguna sincronizacion" con syncs exitosos en la tabla.
--
-- Modelo (igual que el resto del CRM): el equipo completo ve todo (whitelist
-- de Supabase Auth); DMAP y el bot escriben con service key (bypassa RLS).
-- Las tablas con secretos cifrados (org_marketing_settings, meta_user_tokens)
-- y las internas de IA quedan SIN politica de lectura: cerradas para
-- authenticated/anon, solo service key.

-- RLS explicito en TODAS las tablas de DMAP (idempotente).
alter table social_connections      enable row level security;
alter table meta_user_tokens        enable row level security;
alter table publications            enable row level security;
alter table publication_targets     enable row level security;
alter table publication_assets      enable row level security;
alter table publication_events      enable row level security;
alter table content_generations     enable row level security;
alter table image_analysis_cache    enable row level security;
alter table sync_runs               enable row level security;
alter table property_sync_state     enable row level security;
alter table property_change_events  enable row level security;
alter table content_templates       enable row level security;
alter table brand_profiles          enable row level security;
alter table post_metrics            enable row level security;
alter table dmap_audit_log          enable row level security;
alter table org_marketing_settings  enable row level security;

-- Lectura para el equipo (rol authenticated) SOLO en lo que el CRM muestra.
drop policy if exists "team read" on publications;
create policy "team read" on publications for select to authenticated using (true);

drop policy if exists "team read" on publication_targets;
create policy "team read" on publication_targets for select to authenticated using (true);

drop policy if exists "team read" on publication_assets;
create policy "team read" on publication_assets for select to authenticated using (true);

drop policy if exists "team read" on publication_events;
create policy "team read" on publication_events for select to authenticated using (true);

drop policy if exists "team read" on sync_runs;
create policy "team read" on sync_runs for select to authenticated using (true);

drop policy if exists "team read" on property_change_events;
create policy "team read" on property_change_events for select to authenticated using (true);

drop policy if exists "team read" on social_connections;
create policy "team read" on social_connections for select to authenticated using (true);

drop policy if exists "team read" on content_templates;
create policy "team read" on content_templates for select to authenticated using (true);

drop policy if exists "team read" on brand_profiles;
create policy "team read" on brand_profiles for select to authenticated using (true);

drop policy if exists "team read" on post_metrics;
create policy "team read" on post_metrics for select to authenticated using (true);

-- Realtime para la Cola del CRM (/marketing/cola escucha INSERTs en
-- publication_events). Si la publicacion ya incluye la tabla, no falla.
do $$
begin
  alter publication supabase_realtime add table publication_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

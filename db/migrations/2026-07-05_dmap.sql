-- Migracion: DMAP (Diamond Growth Engine) — plataforma de marketing automation.
-- Ejecutar en Supabase SQL Editor.
-- Ver dmap/ARCHITECTURE.md para el diseno completo (flujos, seguridad, API).
--
-- Todas las tablas nuevas cuelgan de organizations.id (raiz multi-tenant),
-- igual que el resto del schema. No se modifica la semantica de ninguna
-- tabla existente del bot: DMAP solo hace upsert de `properties` (mismos
-- campos que ya actualiza scripts/sync_wasi_public.py).

-- ── 1. Conexiones sociales (Meta: Facebook + Instagram) ──────────────────

create table if not exists social_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  external_account_id text not null,        -- page_id o ig_business_account_id
  external_account_name text,
  linked_page_id text,                      -- para IG: la FB Page que lo respalda
  access_token_enc text not null,           -- page token cifrado AES-256-GCM 'v1:<iv>:<tag>:<ct>'
  token_expires_at timestamptz,             -- null = page token sin vencimiento
  scopes text[] not null default '{}',
  status text not null default 'connected'
    check (status in ('connected', 'expired', 'error', 'revoked')),
  last_validated_at timestamptz,
  last_error text,
  connected_by uuid,                        -- auth.users id del CRM
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, platform, external_account_id)
);

create table if not exists meta_user_tokens (
  org_id uuid primary key references organizations(id) on delete cascade,
  fb_user_id text,
  token_enc text not null,                  -- user token long-lived (~60d) cifrado
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ── 2. Publicaciones ──────────────────────────────────────────────────────

create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  kind text not null check (kind in ('single_image', 'carousel', 'story')),
  status text not null default 'draft' check (status in
    ('draft', 'approved', 'scheduled', 'publishing', 'published',
     'partially_published', 'failed', 'archived')),
  style_variant text check (style_variant in
    ('lujo', 'familiar', 'inversionista', 'premium', 'corporativo')),
  copy_facebook text,
  copy_instagram text,
  titulo_comercial text,
  descripcion_comercial text,
  meta_title text,
  meta_description text,
  hashtags text[],
  cta text,
  scheduled_at timestamptz,
  timezone text not null default 'America/Bogota',
  template_id uuid,
  brand_profile_id uuid,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists publication_targets (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references publications(id) on delete cascade,
  social_connection_id uuid not null references social_connections(id),
  platform text not null,
  status text not null default 'pending'
    check (status in ('pending', 'publishing', 'published', 'failed')),
  external_post_id text,
  permalink text,
  ig_creation_ids jsonb,                    -- containers IG guardados ANTES del publish (idempotencia)
  attempts int not null default 0,
  last_error text,
  published_at timestamptz
);

create table if not exists publication_assets (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references publications(id) on delete cascade,
  role text not null check (role in ('cover', 'carousel', 'story', 'fb_cover', 'thumbnail')),
  position int not null default 0,
  source_image_url text,                    -- foto original (CDN Wasi)
  storage_path text,
  public_url text,                          -- creative renderizado en bucket dmap-creatives
  width int,
  height int,
  format text,
  alt_text text,
  selected_by text not null default 'ai' check (selected_by in ('ai', 'user'))
);

create table if not exists publication_events (
  id bigint generated always as identity primary key,
  publication_id uuid not null references publications(id) on delete cascade,
  org_id uuid not null,
  from_status text,
  to_status text,
  actor text not null,                      -- 'system:<worker>' | 'user:<uuid>'
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ── 3. IA ─────────────────────────────────────────────────────────────────

create table if not exists content_generations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid,
  publication_id uuid,
  kind text not null check (kind in ('copy', 'image_analysis')),
  style_variant text,
  model text,
  prompt_version text,
  input jsonb,
  output jsonb,
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now()
);

create table if not exists image_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  property_id uuid not null,
  image_url text not null,
  image_hash text,
  analysis jsonb not null,   -- {room_type, brightness_score, quality_score, is_dark, duplicate_group}
  analyzed_at timestamptz not null default now(),
  unique (property_id, image_url)
);

-- ── 4. Sincronizacion de inventario (Wasi) ───────────────────────────────

create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source text not null check (source in ('wasi_api', 'wasi_public')),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}',        -- {seen, created, updated, removed, errors}
  error text
);

create table if not exists property_sync_state (
  property_id uuid primary key references properties(id) on delete cascade,
  org_id uuid not null,
  wasi_id text,
  content_hash text,
  images_hash text,
  raw jsonb,
  last_seen_at timestamptz not null default now()
);

create table if not exists property_change_events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  property_id uuid references properties(id) on delete cascade,
  sync_run_id uuid references sync_runs(id),
  change_type text not null check (change_type in
    ('created', 'price_changed', 'status_changed', 'photos_changed',
     'description_changed', 'removed')),
  old_value jsonb,
  new_value jsonb,
  processed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── 5. Plantillas y marca (base de Brand Studio, F2) ─────────────────────

create table if not exists content_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  kind text not null check (kind in ('copy', 'creative_layout')),
  body jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists brand_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  name text not null,
  is_default boolean not null default false,
  logo_url text,
  colors jsonb not null,        -- {"primary":"#0b1526","accent":"#c9a24b","text":"#ffffff"}
  fonts jsonb not null,         -- {"heading":"PlayfairDisplay","body":"Inter"}
  layout_style text not null default 'premium_strip',
  overlays jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Postgres no soporta "ADD CONSTRAINT IF NOT EXISTS"; se chequea pg_constraint.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_publications_template') then
    alter table publications
      add constraint fk_publications_template
        foreign key (template_id) references content_templates(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_publications_brand_profile') then
    alter table publications
      add constraint fk_publications_brand_profile
        foreign key (brand_profile_id) references brand_profiles(id);
  end if;
end $$;

-- ── 6. Analytics y operacion ──────────────────────────────────────────────

create table if not exists post_metrics (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  publication_target_id uuid not null references publication_targets(id) on delete cascade,
  collected_at timestamptz not null default now(),
  impressions int,
  reach int,
  likes int,
  comments int,
  shares int,
  clicks int,
  saved int,
  raw jsonb
);

create table if not exists dmap_audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor text,
  action text not null,
  entity_type text,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create table if not exists org_marketing_settings (
  org_id uuid primary key references organizations(id) on delete cascade,
  auto_generate_on_new_property boolean not null default true,
  auto_generate_on_photo_change boolean not null default false,
  publish_window jsonb not null default '{"days":[1,2,3,4,5,6],"from":"08:00","to":"20:00"}',
  timezone text not null default 'America/Bogota',
  sync_source text not null default 'wasi_public' check (sync_source in ('wasi_api', 'wasi_public')),
  sync_interval_minutes int not null default 60,
  wasi_id_company_enc text,
  wasi_token_enc text
);

-- ── Indices ────────────────────────────────────────────────────────────────

create index if not exists idx_social_connections_org on social_connections(org_id);
create index if not exists idx_publications_org_status on publications(org_id, status);
create index if not exists idx_publications_property on publications(property_id);
create index if not exists idx_publication_targets_publication on publication_targets(publication_id);
create index if not exists idx_publication_targets_status on publication_targets(status);
create index if not exists idx_publication_assets_publication on publication_assets(publication_id);
create index if not exists idx_publication_events_publication on publication_events(publication_id, created_at);
create index if not exists idx_publication_events_org on publication_events(org_id, created_at);
create index if not exists idx_content_generations_property on content_generations(property_id);
create index if not exists idx_image_analysis_property on image_analysis_cache(property_id);
create index if not exists idx_sync_runs_org on sync_runs(org_id, started_at desc);
create index if not exists idx_property_change_events_unprocessed
  on property_change_events(org_id, processed) where not processed;
create index if not exists idx_post_metrics_target on post_metrics(publication_target_id, collected_at desc);
create index if not exists idx_dmap_audit_log_org on dmap_audit_log(org_id, created_at desc);

-- ── Seed: brand profile por defecto de Diamond ────────────────────────────

insert into brand_profiles (org_id, name, is_default, colors, fonts, layout_style)
select o.id, 'Diamond', true,
  '{"primary":"#0b1526","accent":"#c9a24b","text":"#ffffff"}'::jsonb,
  '{"heading":"Playfair Display","body":"Inter"}'::jsonb,
  'premium_strip'
from organizations o
where o.whatsapp_phone_id = 'DEMO_PHONE_ID'
  and not exists (
    select 1 from brand_profiles b where b.org_id = o.id and b.is_default
  );

insert into org_marketing_settings (org_id)
select o.id from organizations o
where o.whatsapp_phone_id = 'DEMO_PHONE_ID'
on conflict (org_id) do nothing;

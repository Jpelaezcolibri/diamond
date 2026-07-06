-- Migracion: Diamond Cognitive Engine (DCE) — Fase 1: Property Context.
-- Ejecutar en Supabase SQL Editor.
--
-- DCE infiere el contexto estrategico de marketing de cada propiedad
-- (buyer personas, emociones, beneficios, historia, tonos por canal,
-- direccion visual, recomendaciones) en una fila jsonb que consumen los
-- demas modulos (creativos DMAP hoy; landing, Sofi, SEO y email en fases
-- posteriores). Los consumidores leen esta tabla — nunca llaman a DMAP
-- en runtime (ver dmap/ARCHITECTURE.md).

create table if not exists property_contexts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  property_ref text not null,
  -- Version del shape del JSON `context` — los consumidores declaran la
  -- minima que entienden. Una fila viva por (org, propiedad, version).
  schema_version int not null,
  -- Version de los prompts que lo generaron (permite regenerar "todo lo < vN").
  prompt_version text not null,
  -- Hash del contenido semantico de la propiedad al momento de generar
  -- (content_hash + images_hash del sync). Si difiere del actual, el
  -- contexto esta desactualizado.
  source_hash text not null,
  status text not null default 'ready'
    check (status in ('pending', 'ready', 'stale', 'failed')),
  context jsonb not null default '{}'::jsonb,
  -- Ultimo error cuando status='failed' (el batch nocturno lo reintenta).
  error text,
  model text,
  input_tokens int,
  output_tokens int,
  cost_usd numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, property_id, schema_version)
);

create index if not exists idx_property_contexts_org_ref
  on property_contexts(org_id, property_ref);
create index if not exists idx_property_contexts_stale
  on property_contexts(org_id, status) where status in ('stale', 'failed');

-- Historial/costos de cada generacion de contexto (igual que copy e imagenes).
alter table content_generations drop constraint if exists content_generations_kind_check;
alter table content_generations add constraint content_generations_kind_check
  check (kind in ('copy', 'image_analysis', 'image_generation', 'property_context'));

-- RLS: mismo modelo que las tablas DMAP — el CRM (rol authenticated) lee,
-- solo el service_role (DMAP) escribe.
alter table property_contexts enable row level security;

drop policy if exists "team read" on property_contexts;
create policy "team read" on property_contexts for select to authenticated using (true);

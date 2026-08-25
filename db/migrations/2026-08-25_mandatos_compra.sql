-- Mandatos de compra: los clientes que Diamond tiene BUSCANDO, contra los que se
-- cruza cada oferta que un colega publica en un grupo gremial.
--
-- POR QUE ESTE SHAPE. Es una copia deliberada del shape de un pedido del radar
-- (group_signals): un mandato ES un pedido, solo que nuestro. Asi lo consume
-- evaluarCandidata (src/groups/match.js) sin traducir nada — y traducir es
-- exactamente el bug que documenta filtrosInventario cuando dos modulos le ponen
-- nombres distintos a lo mismo (precio_max vs precioMax: el filtro se ignoraba en
-- silencio y TODO parecia matchear).
--
-- Correr a mano en Supabase. Idempotente.

create table if not exists mandatos_compra (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  cliente_nombre text not null,
  cliente_telefono text,

  -- A QUIEN se le avisa. Explicito y no derivado de quien lo cargo: un mandato
  -- puede pasar a otro asesor sin reescribir quien lo registro.
  advisor_id uuid references advisors(id) on delete set null,
  registrado_por uuid references auth.users(id) on delete set null,

  operacion text,                       -- venta | arriendo
  tipo text,                            -- apartamento | casa | consultorio | ...
  zonas jsonb not null default '[]'::jsonb,
  zonas_excluidas jsonb not null default '[]'::jsonb,
  ciudad text,
  precio_min bigint,
  precio_max bigint,
  habitaciones int,
  flexible_habitaciones boolean not null default false,
  area_min int,
  banos int,
  garajes int,
  estrato int,

  -- Exigencias que ningun campo numerico captura: "balcon", "gym", "lavadora y
  -- secadora", "moderna", "zonas sociales". No filtran (no se pueden verificar
  -- contra un texto de WhatsApp): salen listadas en el aviso como lo que el
  -- asesor tiene que preguntarle al colega.
  exigencias jsonb not null default '[]'::jsonb,
  plazo text,                           -- "3 a 6 meses" (arriendo temporal)

  -- El brief tal como llego. NO es adorno: es lo que permitio detectar el
  -- 2026-08-24 que el clasificador venia recortando pedidos (migracion
  -- group_signals_exigencias). Un mandato mal leido filtra mal para siempre y
  -- no se queja.
  texto_original text,
  notas text,

  estado text not null default 'activo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mandatos_compra_estado_valido') then
    alter table mandatos_compra add constraint mandatos_compra_estado_valido
      check (estado in ('activo', 'pausado', 'cerrado'));
  end if;
end $$;

create index if not exists idx_mandatos_org_estado on mandatos_compra(org_id, estado);

-- Dedup + auditoria del aviso. Mismo patron que ally_property_alerts: un aviso
-- por (mandato, propiedad) y nunca mas. Hace falta de verdad — el 2026-08-25 la
-- casa del Mall Tesoro aparecia DOS veces en la captura, publicada dos veces por
-- la misma persona.
create table if not exists mandato_match_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  mandato_id uuid not null references mandatos_compra(id) on delete cascade,
  ally_property_id uuid not null references ally_properties(id) on delete cascade,

  advisor_id uuid references advisors(id) on delete set null,
  puntaje int,
  entregado boolean not null default false,
  entregado_at timestamptz,
  via text,                             -- texto_libre | plantilla
  error text,
  escalado_a text,                      -- telefono al que se escalo, si aplico
  escalado_at timestamptz,
  created_at timestamptz not null default now(),

  unique (mandato_id, ally_property_id)
);

create index if not exists idx_mandato_alerts_org on mandato_match_alerts(org_id, entregado);

-- RLS: mismo patron que ally_properties — lectura para el equipo autenticado, las
-- escrituras (bot) pasan por service_role.
alter table mandatos_compra enable row level security;
drop policy if exists "team read" on mandatos_compra;
create policy "team read" on mandatos_compra for select to authenticated using (true);

alter table mandato_match_alerts enable row level security;
drop policy if exists "team read" on mandato_match_alerts;
create policy "team read" on mandato_match_alerts for select to authenticated using (true);

comment on table mandatos_compra is
  'Clientes compradores de Diamond, contra los que el radar cruza cada oferta de colega. Un mandato es un pedido, con el mismo shape que group_signals.';
comment on column mandatos_compra.exigencias is
  'Requisitos de texto libre que no se pueden verificar contra la publicacion del colega. No filtran: se listan en el aviso como lo que hay que preguntar.';
comment on column mandato_match_alerts.escalado_a is
  'Telefono al que se escalo el aviso cuando no se pudo entregar al dueño del mandato. Null = nunca hizo falta.';

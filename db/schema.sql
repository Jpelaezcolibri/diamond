-- Schema Supabase — Agente Inmobiliario WhatsApp
-- Ejecutar en el SQL Editor de Supabase (o via supabase db push)

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  whatsapp_phone_id text unique,
  whatsapp_token text,
  verify_token text,
  advisor_phone text not null,
  advisor_name text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists advisors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  phone text not null,
  especialidad text not null default 'venta', -- venta | arriendo | vehiculos | otro
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  ref text not null,
  titulo text not null,
  tipo text,
  precio text,
  area text,
  habitaciones int,
  banos int,
  garaje int,
  estrato int,
  administracion text,
  zona text,
  ciudad text,
  descripcion text,
  caracteristicas text,
  link text,
  disponible boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, ref)
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  phone text not null,
  nombre text,
  presupuesto text,
  zona_interes text,
  tipo_interes text,
  urgencia text,
  forma_pago text,
  score int not null default 0,
  estado text not null default 'nuevo', -- nuevo | en_conversacion | calificado | transferido | descartado
  property_ref_origen text,
  source text not null default 'whatsapp',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, phone)
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  estado text not null default 'activa',
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_properties_org on properties(org_id) where disponible;
create index if not exists idx_advisors_org on advisors(org_id) where activo;
create index if not exists idx_leads_org_phone on leads(org_id, phone);
create index if not exists idx_conversations_lead on conversations(lead_id);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at);

-- ── Seed demo: Paraiso Inmobiliario ──────────────────────────────
insert into organizations (name, whatsapp_phone_id, advisor_phone, advisor_name)
values ('Diamond', 'DEMO_PHONE_ID', '573028536489', 'Asesor Diamond')
on conflict (whatsapp_phone_id) do nothing;

insert into advisors (org_id, name, phone, especialidad)
select o.id, a.*
from organizations o,
(values
  ('Asesor de Ventas Diamond', '573028536489', 'venta'),
  ('Asesora de Arriendos Diamond', '573000000002', 'arriendo'),
  ('Asesor de Vehiculos Diamond', '573000000003', 'vehiculos')
) as a(name, phone, especialidad)
where o.whatsapp_phone_id = 'DEMO_PHONE_ID'
  and not exists (select 1 from advisors x where x.org_id = o.id);

insert into properties (org_id, ref, titulo, tipo, precio, area, habitaciones, banos, garaje, estrato, administracion, zona, ciudad, descripcion, caracteristicas, link, disponible)
select o.id, p.*
from organizations o,
(values
  ('AP001', 'Apartamento moderno El Poblado', 'Apartamento', '$1.200.000', '80m2', 3, 2, 1, 5, '$350.000', 'El Poblado', 'Medellin', 'Apartamento remodelado con cocina integral y balcon con vista a la ciudad.', 'Conjunto cerrado, piscina, gimnasio', 'https://paraiso.com/ap001', true),
  ('AP002', 'Apartaestudio Laureles amoblado', 'Apartaestudio', '$850.000', '45m2', 1, 1, 0, 4, '$200.000', 'Laureles', 'Medellin', 'Apartaestudio totalmente amoblado ideal para ejecutivos o estudiantes.', 'Amoblado, internet incluido, vigilancia 24h', 'https://paraiso.com/ap002', true),
  ('CA001', 'Casa campestre El Retiro', 'Casa', '$3.500.000', '250m2', 4, 3, 2, 6, '$600.000', 'El Retiro', 'Antioquia', 'Hermosa casa campestre con jardin privado y vista a las montanas.', 'Jardin, chimenea, cuarto de servicio, BBQ', 'https://paraiso.com/ca001', true),
  ('AP003', 'Apto Envigado cerca metro', 'Apartamento', '$980.000', '65m2', 2, 2, 1, 4, '$280.000', 'Envigado', 'Antioquia', 'Apartamento bien ubicado a 5 minutos del metro de Envigado.', 'Parqueadero cubierto, conjunto cerrado', 'https://paraiso.com/ap003', false)
) as p(ref, titulo, tipo, precio, area, habitaciones, banos, garaje, estrato, administracion, zona, ciudad, descripcion, caracteristicas, link, disponible)
where o.whatsapp_phone_id = 'DEMO_PHONE_ID'
on conflict (org_id, ref) do nothing;

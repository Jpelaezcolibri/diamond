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
  operacion text default 'Venta', -- Venta | Arriendo
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

insert into properties (org_id, ref, titulo, tipo, operacion, precio, area, habitaciones, banos, garaje, estrato, administracion, zona, ciudad, descripcion, caracteristicas, link, disponible)
select o.id, p.*
from organizations o,
(values
  ('AP001', 'Apartamento Moderno en Sabaneta - Iluminado con Vista Verde', 'Apartamento', 'Venta', '$460.000.000', '65m2', 2, 2, 1, 4, '$290.000', 'El Carmelo, Sabaneta', 'Antioquia', 'Apartamento muy iluminado con vista a zona verde, ubicado cerca del parque principal de Sabaneta, con facil acceso a transporte publico y centros comerciales.', 'Porteria 24 horas, gimnasio, piscina, zona humeda, parque infantil', 'https://info.wasi.co/apartamento-venta-el-carmelo-sabaneta/9755676', true),
  ('AP002', 'Apartamento con Balcon en Envigado - Loma del Esmeraldal', 'Apartamento', 'Venta', '$520.000.000', '82m2', 3, 2, 1, 5, '$380.000', 'Loma del Esmeraldal, Envigado', 'Antioquia', 'Apartamento con balcon y vista panoramica al valle, cocina integral y espacios amplios, a minutos de la Via Las Palmas y centros comerciales de Envigado.', 'Porteria 24 horas, piscina, turco, salon social, sendero ecologico', 'https://info.wasi.co/apartamento-venta-esmeraldal-envigado/9761234', true),
  ('AP003', 'Apartamento en Arriendo Sabaneta - Cerca al Parque', 'Apartamento', 'Arriendo', '$2.200.000', '70m2', 3, 2, 1, 4, '$310.000 (incluida en el canon)', 'Calle del Banco, Sabaneta', 'Antioquia', 'Apartamento comodo y bien distribuido a tres cuadras del parque principal de Sabaneta, rodeado de restaurantes, comercio y transporte publico.', 'Porteria 24 horas, gimnasio, salon social, juegos infantiles', 'https://info.wasi.co/apartamento-arriendo-sabaneta/9748821', true),
  ('AE001', 'Apartaestudio Amoblado en Laureles - Ideal Ejecutivos', 'Apartaestudio', 'Arriendo', '$1.850.000', '45m2', 1, 1, 0, 4, '$220.000', 'Laureles, Medellin', 'Antioquia', 'Apartaestudio totalmente amoblado en el corazon de Laureles, a pasos de la Segunda Avenida, con internet incluido y listo para estrenar.', 'Amoblado, internet incluido, porteria 24 horas, lavanderia comunal', 'https://info.wasi.co/apartaestudio-arriendo-laureles-medellin/9752210', true),
  ('CA001', 'Casa Campestre en La Estrella - Sector Suramerica', 'Casa', 'Venta', '$780.000.000', '210m2', 4, 3, 2, 5, '$450.000', 'Suramerica, La Estrella', 'Antioquia', 'Casa campestre en unidad cerrada con jardin privado, chimenea y vista a las montanas, a 10 minutos de la estacion La Estrella del metro.', 'Unidad cerrada, jardin privado, chimenea, BBQ, cuarto de servicio', 'https://info.wasi.co/casa-venta-la-estrella-antioquia/9739987', true),
  ('AP004', 'Apartamento en Venta Envigado - Cerca al Metro', 'Apartamento', 'Venta', '$395.000.000', '62m2', 2, 2, 1, 4, '$265.000', 'Centro, Envigado', 'Antioquia', 'Apartamento bien ubicado a 5 minutos de la estacion Envigado del metro, sector tradicional con todo el comercio a la mano.', 'Parqueadero cubierto, porteria 24 horas, conjunto cerrado', 'https://info.wasi.co/apartamento-venta-envigado-centro/9744456', false)
) as p(ref, titulo, tipo, operacion, precio, area, habitaciones, banos, garaje, estrato, administracion, zona, ciudad, descripcion, caracteristicas, link, disponible)
where o.whatsapp_phone_id = 'DEMO_PHONE_ID'
on conflict (org_id, ref) do nothing;

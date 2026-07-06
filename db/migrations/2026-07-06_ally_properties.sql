-- Migracion: propiedades de aliados (colegas de otras inmobiliarias que
-- comparten/ofrecen un inmueble a la red, NO son inventario propio ni un
-- dueno pidiendo consignar con nosotros). Ejecutar en Supabase SQL Editor.
--
-- El bot ya funciona sin esta migracion (Sofi sigue respondiendo como hoy si
-- la tabla no existe: la persistencia de la tool nueva es best-effort, mismo
-- patron que leads.intencion/leads.cita en 2026-07-05_agenda.sql).

create table if not exists ally_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- Datos de la propiedad, extraidos por Claude de lenguaje libre (todo
  -- nullable: el mensaje puede traer datos parciales).
  ref text,
  titulo text,
  tipo text,
  operacion text check (operacion in ('Venta', 'Arriendo')),
  precio text,
  zona text,
  ciudad text,
  descripcion text,

  -- De quien vino y por que canal.
  inmobiliaria_origen text,
  contacto_nombre text,
  contacto_telefono text,
  lead_id uuid references leads(id) on delete set null,

  -- Texto crudo del mensaje: red de seguridad si la extraccion fallo.
  mensaje_original text,

  -- Ciclo de vida: nace 'pendiente', el asesor la confirma o descarta desde el CRM.
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'no_disponible', 'expirada')),
  confirmada_por uuid references auth.users(id) on delete set null,
  confirmada_at timestamptz,
  notas text,
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dedup: el mismo aliado reenviando la misma ref no duplica el registro.
-- ref puede ser null (aliado no dio referencia), el indice solo aplica si hay ref.
create unique index if not exists idx_ally_properties_dedupe
  on ally_properties(org_id, contacto_telefono, ref)
  where ref is not null;

create index if not exists idx_ally_properties_org_estado
  on ally_properties(org_id, estado);
create index if not exists idx_ally_properties_zona
  on ally_properties(org_id, zona);

-- RLS: mismo patron que las demas tablas de negocio (leads/properties/publications) —
-- solo lectura para el equipo autenticado; las escrituras (bot y CRM) pasan por
-- el service_role, que bypassea RLS.
alter table ally_properties enable row level security;

drop policy if exists "team read" on ally_properties;
create policy "team read" on ally_properties for select to authenticated using (true);

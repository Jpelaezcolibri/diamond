-- Publicador automatico de amoblados en grupos (spec
-- docs/superpowers/specs/2026-10-19-publicador-grupos-design.md). Solo agrega.

-- 1. Que se publica en cada grupo: amoblados | fincas | null (nada).
alter table whatsapp_groups add column if not exists publica text;
alter table whatsapp_groups drop constraint if exists whatsapp_groups_publica_check;
alter table whatsapp_groups add constraint whatsapp_groups_publica_check
  check (publica is null or publica in ('amoblados', 'fincas'));

-- 2. Cada post enviado (o fallido). Sin esta tabla el publicador no arranca.
create table if not exists grupo_publicaciones (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  group_id uuid references whatsapp_groups(id) on delete set null,
  group_jid text not null,
  property_ref text not null,
  estado text not null check (estado in ('enviado', 'fallo')),
  wamid text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists grupo_publicaciones_org_fecha_idx
  on grupo_publicaciones (org_id, created_at desc);
alter table grupo_publicaciones enable row level security;

-- 3. Grupos donde esta la linea de Daiana (confirmado con WAHA 2026-10-19).
update whatsapp_groups set publica = 'amoblados'
where org_id = (select id from organizations where name = 'Diamond')
  and jid in (
    '573122385336-1535385747@g.us', -- RENTA AMOBLADOS/FINCAS
    '573003371490-1530756015@g.us', -- Arriendos F y A amoblados
    '573192987173-1525116262@g.us', -- Renta y Venta Amoblados y Airbnb
    '573003371490-1496864741@g.us', -- ARRIENDOS 7AM 8PM
    '573003371490-1503058650@g.us', -- OFERTAS SUR POB ENV SAB
    '573006167957-1494531534@g.us', -- OFERTAS 7:00 A.M.8:00P.M.
    '573003371490-1503059132@g.us'  -- OFERTAS 2 7am 8pm
  );
update whatsapp_groups set publica = 'fincas'
where org_id = (select id from organizations where name = 'Diamond')
  and jid in (
    '573003371490-1493426736@g.us', -- Fincas 7AM 8PM
    '573003371490-1504025666@g.us', -- FINCAS 2 7:00AM-8PM
    '573003371490-1535817776@g.us'  -- FINCAS NORTE ANT 7AM 8PM
  );

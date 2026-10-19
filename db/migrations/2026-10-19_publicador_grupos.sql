-- Publicador automatico de amoblados en grupos (spec
-- docs/superpowers/specs/2026-10-19-publicador-grupos-design.md). Solo agrega.

-- 1. Que se publica en cada grupo: amoblados | fincas | null (nada).
-- El check va en la misma columna: se crea una sola vez con ella y la
-- migracion se puede correr dos veces sin borrar nada.
alter table whatsapp_groups add column if not exists publica text
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

-- 4. Los 7 posts publicados a mano el 2026-10-19 (Claude outputs/
-- publicaciones-grupos-2026-10-19.json), para que el candado de 7 dias y el
-- "un post por grupo por dia" los cuenten. Idempotente por wamid.
insert into grupo_publicaciones (org_id, group_id, group_jid, property_ref, estado, wamid, created_at)
select g.org_id, g.id, v.jid, v.ref, 'enviado', v.wamid, v.at::timestamptz
from (values
  ('573122385336-1535385747@g.us', '10383517', '3EB0FA76315AA2BC4F61AB', '2026-10-19T17:06:05Z'),
  ('573003371490-1530756015@g.us', '10383636', '3EB0C8A33079A37BFA9B09', '2026-10-19T17:28:24Z'),
  ('573003371490-1496864741@g.us', '10459832', '3EB05D62A03BC6B60098BE', '2026-10-19T17:52:35Z'),
  ('573003371490-1503058650@g.us', '10440972', '3EB02B1B9E08F1592029DC', '2026-10-19T18:32:37Z'),
  ('573192987173-1525116262@g.us', '10319436', '3EB077B5B3FFD503B63FBF', '2026-10-19T19:09:06Z'),
  ('573006167957-1494531534@g.us', '10488342', '3EB0638F59EAA97D8B9224', '2026-10-19T19:48:34Z'),
  ('573003371490-1503059132@g.us', '10383577', '3EB08CD72CE821192DB4B6', '2026-10-19T20:22:05Z')
) as v(jid, ref, wamid, at)
join whatsapp_groups g
  on g.jid = v.jid and g.org_id = (select id from organizations where name = 'Diamond')
where not exists (select 1 from grupo_publicaciones p where p.wamid = v.wamid);

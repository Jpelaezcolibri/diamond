-- Propiedades que publica Sofi a pedido de un asesor (spec
-- docs/superpowers/specs/2026-10-19-sofi-publica-propiedad-asesor-design.md).
-- Solo agrega. El check de publica se reemplaza para admitir 'ofertas'
-- (no toca datos: los valores existentes siguen siendo validos).

alter table properties add column if not exists origen text not null default 'wasi'
  check (origen in ('wasi', 'asesor'));
alter table properties add column if not exists vence_at timestamptz;
alter table properties add column if not exists vigencia_preguntada_at timestamptz;

alter table whatsapp_groups drop constraint if exists whatsapp_groups_publica_check;
alter table whatsapp_groups add constraint whatsapp_groups_publica_check
  check (publica is null or publica in ('amoblados', 'fincas', 'ofertas'));

update whatsapp_groups set publica = 'ofertas'
where org_id = (select id from organizations where name = 'Diamond')
  and jid in (
    '573003371490-1503058650@g.us', -- OFERTAS SUR POB ENV SAB
    '573006167957-1494531534@g.us', -- OFERTAS 7:00 A.M.8:00P.M.
    '573003371490-1503059132@g.us'  -- OFERTAS 2 7am 8pm
  );

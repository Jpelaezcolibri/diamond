-- Identidad publica del asesor, rotacion de citas y puente colega -> Sofi.
--
-- POR QUE (2026-10-07): Juan pidio que hacia afuera los asesores no se
-- identifiquen por nombre sino como "Asesor 1", "Asesor 2"... y que todo salga
-- firmado por Sofi; que las citas roten entre 2-3 asesores que las confirman;
-- y que el colega que toca el link del DM caiga en Sofi ya reconocido.
-- Spec: docs/superpowers/specs/2026-10-07-sofi-vendedora-y-agenda-design.md
--
-- Solo agrega columnas e indice; no borra ni modifica datos. Idempotente:
-- se puede correr dos veces sin efecto. El codigo actual no lee ninguna de
-- estas columnas, asi que correrla antes del deploy no cambia nada.

-- ── advisors: alias publico y rotacion de citas (spec §2.1, §4.2) ──────────
alter table advisors add column if not exists alias_publico text;
alter table advisors add column if not exists recibe_citas boolean not null default false;
alter table advisors add column if not exists orden_citas integer;

comment on column advisors.alias_publico is
  'Como se nombra al asesor hacia colegas y clientes ("Asesor 1"). Nunca se usa el nombre real hacia afuera; null = "un asesor de Diamond".';
comment on column advisors.recibe_citas is
  'Entra en la rotacion de citas por confirmar. Mientras ningun asesor la tenga en true, las citas siguen el camino anterior.';
comment on column advisors.orden_citas is
  'Orden dentro de la rotacion de citas (menor primero).';

-- ── group_signals: codigo del DM y seguimiento (spec §3.1, §5.3) ───────────
alter table group_signals add column if not exists codigo_colega text;
alter table group_signals add column if not exists colega_escribio_at timestamptz;
alter table group_signals add column if not exists seguimiento_dm_at timestamptz;
alter table group_signals add column if not exists seguimiento_dm_canal text;

comment on column group_signals.codigo_colega is
  'Codigo corto (ej. D7K2) que viaja en los links wa.me del DM; con el Sofi reconoce al colega y amarra su telefono.';
comment on column group_signals.colega_escribio_at is
  'Primera vez que el colega le escribio a Sofi con el codigo de este pedido.';
comment on column group_signals.seguimiento_dm_at is
  'Cuando salio el seguimiento unico de +4 h del DM.';
comment on column group_signals.seguimiento_dm_canal is
  'Por donde salio ese seguimiento: plantilla (linea oficial) | linea_grupos.';

create unique index if not exists uq_group_signals_codigo
  on group_signals (org_id, codigo_colega)
  where codigo_colega is not null;

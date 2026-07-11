-- Migracion: cierre de negocios (Sprint "Cero Leads Perdidos").
-- Ejecutar en el SQL Editor de Supabase.
--
-- Decision de diseno (diamond-os/sofi-centro-comando.md, aprobada 2026-07-10):
-- las ventas cerradas son ESTADOS nuevos del lead (cerrado_ganado |
-- cerrado_perdido), NO un objeto Oportunidad aparte. La columna estado no
-- tiene CHECK, asi que solo hacen falta las columnas de cierre.

alter table leads add column if not exists closed_at timestamptz;
alter table leads add column if not exists valor_cierre bigint; -- pesos COP
alter table leads add column if not exists motivo_perdida text;

comment on column leads.estado is
  'nuevo | en_conversacion | calificado | transferido | descartado | cerrado_ganado | cerrado_perdido';

-- El embudo consulta cohortes por fecha de creacion y cierres por fecha de cierre.
create index if not exists idx_leads_org_closed_at on leads (org_id, closed_at)
  where closed_at is not null;

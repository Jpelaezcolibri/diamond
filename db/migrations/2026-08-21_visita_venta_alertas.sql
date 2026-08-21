-- Dedup del cruce diario visitas -> ventas (Juan, 2026-08-21): "que todos
-- los dias se haga el barrido con wasi y se cruce que propiedades se
-- vendieron de esas visitas agendadas... quiero tener el control de las
-- visitas y ventas".
--
-- Una vez que una propiedad con visita agendada se marca no disponible, se
-- queda asi para siempre (no vuelve a estar disponible salvo error de
-- carga) — sin este registro, src/scheduler/visitas-venta.js le mandaria a
-- Juan la MISMA alerta todos los dias, indefinidamente.
--
-- Correr a mano en Supabase. Idempotente.

create table if not exists visita_venta_alertas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  ref text not null,
  alertado_at timestamptz not null default now(),
  unique (org_id, ref)
);

comment on table visita_venta_alertas is
  'Registro de que ref ya se le aviso a Juan como "posible venta" (visita agendada + propiedad ya no disponible) — evita repetir la misma alerta cada dia.';

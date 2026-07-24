-- Migracion: captador de propiedades del inventario propio. Ejecutar en el
-- SQL Editor de Supabase.
--
-- captador_id: asesor "dueño" de la propiedad (quien la capto). Se asigna
-- via Sofi-Comando ("marca la propiedad X a nombre de Natalia"). Cuando un
-- cliente muestra interes en la propiedad, el captador recibe un aviso
-- inmediato por WhatsApp y, si el lead se transfiere, se transfiere a el
-- (salvo intencion vender/vehiculos). Referencia advisors(id), no
-- auth.users: el aviso viaja al telefono del asesor y no todos tienen login.
-- El sync de Wasi/DMAP solo actualiza sus propios campos: la asignacion
-- sobrevive a cada sync.
alter table properties add column if not exists captador_id uuid references advisors(id) on delete set null;

-- Dedup + auditoria del aviso de interes: evita mandarle varios WhatsApp al
-- captador si el mismo cliente insiste sobre la misma propiedad. Espejo de
-- ally_property_alerts (migracion 2026-07-22_ally_properties_asesor.sql).
create table if not exists property_owner_alerts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (property_id, lead_id)
);

create index if not exists idx_property_owner_alerts_org on property_owner_alerts(org_id);

-- RLS: solo lectura para el equipo autenticado; escrituras via service_role.
alter table property_owner_alerts enable row level security;

drop policy if exists "team read" on property_owner_alerts;
create policy "team read" on property_owner_alerts for select to authenticated using (true);

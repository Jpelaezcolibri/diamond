-- Preguntas que Sofi le hace al asesor por un colega o cliente (spec
-- 2026-10-25-sofi-pregunta-al-asesor). La escalera le insiste al asesor de
-- turno hasta que alguien conteste (CRM o WhatsApp) y Sofi se lo pasa al colega.
create table if not exists preguntas_asesor (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  ref text,
  tipo text not null default 'otro' check (tipo in ('precio','unidad','administracion','otro')),
  pregunta text not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','respondida','entregada','descartada')),
  asesor_id uuid references advisors(id),
  asignada_at timestamptz not null default now(),
  reaviso_at timestamptz,
  wamid_aviso text,
  respuesta text,
  respondida_por text,
  respondida_via text check (respondida_via is null or respondida_via in ('crm','whatsapp')),
  respondida_at timestamptz,
  entregada_at timestamptz,
  entrega_error text,
  descartada_por text,
  created_at timestamptz not null default now()
);
create index if not exists preguntas_asesor_pendientes on preguntas_asesor (org_id, estado);
create index if not exists preguntas_asesor_wamid on preguntas_asesor (wamid_aviso);
create index if not exists preguntas_asesor_lead on preguntas_asesor (lead_id, estado);
alter table preguntas_asesor enable row level security;
drop policy if exists "team read" on preguntas_asesor;
create policy "team read" on preguntas_asesor for select to authenticated using (true);

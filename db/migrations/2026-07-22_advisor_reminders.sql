-- Migracion: recordatorios personales del asesor en Sofi-Comando. Ejecutar
-- en el SQL Editor de Supabase.
--
-- Son notas del asesor para si mismo (via chat con Sofi-Comando): "recuerdame
-- la cita de manana", "que tengo pendiente". Siempre se filtran por user_id,
-- incluso para el admin — no son datos del negocio como los leads (que el
-- admin si ve todos), son personales.

create table if not exists advisor_reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  descripcion text not null,
  fecha_hora timestamptz,
  completado boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_advisor_reminders_user
  on advisor_reminders(org_id, user_id, completado);

-- RLS: mismo patron que command_sessions — cada quien solo lee lo suyo; las
-- escrituras pasan por el bot (service_role, que bypassea RLS).
alter table advisor_reminders enable row level security;

drop policy if exists "own reminders" on advisor_reminders;
create policy "own reminders" on advisor_reminders for select to authenticated
  using (user_id = auth.uid());

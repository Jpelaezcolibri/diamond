-- Migracion: sesiones del Centro de Comando (Sofi-Comando).
-- Ejecutar en el SQL Editor de Supabase.
--
-- Tablas separadas de conversations/messages a proposito: el inbox es la
-- bandeja de conversaciones con CLIENTES; estas son las sesiones internas del
-- asesor/admin conversando con SOFI. Mezclarlas contaminaria el inbox, su
-- Realtime y sus contadores.
--
-- active_context: foco de la sesion (propiedad/lead en discusion) para resolver
--   referencias como "resume esta propiedad" sin repetir la ref.
-- tomorrow_queue: la "cola de manana" que siembra el cierre del dia (EXP-006) y
--   que el briefing del dia siguiente (EXP-001) usa como arranque.

create table if not exists command_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active_context jsonb,
  tomorrow_queue jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists idx_command_sessions_user
  on command_sessions(org_id, user_id, opened_at desc);

create table if not exists command_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references command_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_command_messages_session
  on command_messages(session_id, created_at);

-- RLS: las escrituras pasan por el bot (service_role, que bypassea RLS). La
-- lectura directa (si algun dia el CRM lee via sesion/Realtime) queda limitada
-- a las sesiones y mensajes del propio usuario.
alter table command_sessions enable row level security;
alter table command_messages enable row level security;

drop policy if exists "own sessions" on command_sessions;
create policy "own sessions" on command_sessions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own session messages" on command_messages;
create policy "own session messages" on command_messages for select to authenticated
  using (exists (
    select 1 from command_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));

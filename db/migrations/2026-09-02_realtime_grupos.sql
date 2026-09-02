-- Migracion: `group_signals` y `mandato_match_alerts` emiten eventos de
-- Realtime. Correr a mano en el SQL Editor de Supabase. Idempotente.
--
-- Por que: el dashboard de matches de /grupos (CRM) usa Supabase Realtime
-- (GruposLiveWatcher) para refrescarse solo cuando entra un pedido nuevo o
-- aparece un match nuevo. La publicacion de Realtime creada en
-- 2026-07-02_crm.sql solo incluye `messages` y `conversations`, y
-- 2026-08-14_realtime_leads.sql agrego `leads` -- ninguna de las dos
-- incluye las tablas que este dashboard necesita.
--
-- Sin esta migracion la suscripcion del dashboard se conecta (el badge
-- muestra "en vivo" en verde) pero no recibe un solo evento -- falla en
-- silencio, exactamente el mismo caso ya documentado en
-- 2026-08-14_realtime_leads.sql para el kanban.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'group_signals'
  ) then
    alter publication supabase_realtime add table group_signals;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'mandato_match_alerts'
  ) then
    alter publication supabase_realtime add table mandato_match_alerts;
  end if;
end $$;

-- Verificacion: debe listar conversations, messages, leads, group_signals y
-- mandato_match_alerts.
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime';

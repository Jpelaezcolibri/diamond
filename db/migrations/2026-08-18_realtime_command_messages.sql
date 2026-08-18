-- Migracion: la tabla `command_messages` emite eventos de Realtime. Correr a
-- mano en el SQL Editor de Supabase. Idempotente.
--
-- Por que: el feed en vivo del radar (src/groups/feed-comando.js) le escribe
-- mensajes al admin desde un proceso de fondo — no desde su propia pestaña
-- del navegador. Sin Realtime en esta tabla, esos mensajes (y cualquier otro
-- turno de Sofi-Comando) solo aparecen recargando la pagina a mano.
--
-- Sin esta migracion la suscripcion de crm/components/sofi-command-chat.tsx
-- se conecta pero no recibe un solo evento — falla en silencio, la parte cara
-- de depurar (mismo patron que 2026-08-14_realtime_leads.sql).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'command_messages'
  ) then
    alter publication supabase_realtime add table command_messages;
  end if;
end $$;

-- Verificacion: debe listar conversations, messages, leads y command_messages.
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime';

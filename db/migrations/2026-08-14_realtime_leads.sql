-- Migracion: la tabla `leads` emite eventos de Realtime. Correr a mano en el
-- SQL Editor de Supabase. Idempotente.
--
-- Por que: el kanban pinta LEADS (una tarjeta por lead, agrupadas por estado),
-- no conversaciones. La publicacion de Realtime creada en 2026-07-02_crm.sql
-- solo incluye `messages` y `conversations`, que son lo que consume el inbox.
-- Resultado: el tablero no se enteraba de un lead nuevo ni de un cambio de
-- estado hasta que alguien recargaba la pagina a mano.
--
-- Sin esta migracion la suscripcion del kanban se conecta pero no recibe un
-- solo evento — falla en silencio, que es la parte cara de depurar.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table leads;
  end if;
end $$;

-- Verificacion: debe listar conversations, messages y leads.
-- select tablename from pg_publication_tables where pubname = 'supabase_realtime';

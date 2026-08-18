-- El modo de respuesta del radar (sombra | asistido | auto) pasa de variable
-- de entorno a columna en `organizations`. Correr a mano en el SQL Editor de
-- Supabase. Idempotente.
--
-- Por que: GRUPOS_RESPUESTA_MODO en Railway funciona, pero cambiarlo implica
-- editar el servicio y esperar un redeploy (varios minutos, medido varias
-- veces hoy mismo) — no es un interruptor real. Juan pidio poder prender o
-- apagar las respuestas automaticas al grupo con un toque desde el CRM.
--
-- Default 'asistido': preserva el comportamiento actual en produccion (Sofi
-- revalida y avisa por privado, no publica nada) para que correr esta
-- migracion no cambie nada por si sola — el salto a 'auto' es una decision
-- aparte, tomada a mano desde el toggle.

alter table organizations
  add column if not exists grupos_respuesta_modo text not null default 'asistido';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_grupos_respuesta_modo_check'
  ) then
    alter table organizations
      add constraint organizations_grupos_respuesta_modo_check
      check (grupos_respuesta_modo in ('sombra', 'asistido', 'auto'));
  end if;
end $$;

-- Verificacion: debe mostrar 'asistido' para las orgs existentes.
-- select id, name, grupos_respuesta_modo from organizations;

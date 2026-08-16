-- Radar en vivo — respuesta automatica dentro del grupo.
--
-- Hasta hoy Radar solo OBSERVABA: las senales entraban por export o reenvio y
-- el asesor decidia que hacer. Esta migracion agrega lo que hace falta para que
-- el sistema PUBLIQUE una respuesta en el grupo, que es una operacion de otra
-- naturaleza: un mensaje en un grupo de 80 inmobiliarias competidoras se ve una
-- vez y no se puede editar ni borrar.
--
-- Por eso todo lo que se agrega aca esta pensado para dos cosas: poder
-- reconstruir exactamente que se dijo, y poder frenarlo.
--
-- Correr a mano en el SQL Editor de Supabase. Idempotente.

-- ── 1. Que se respondio, cuando y por que via ────────────────────────────
--
-- El texto se guarda entero, no un resumen ni un id de plantilla. Si manana un
-- colega reclama "ustedes publicaron un precio que no era", la unica respuesta
-- honesta posible es mostrar el mensaje tal como salio. Reconstruirlo desde los
-- matches no sirve: el inventario ya habra cambiado.
alter table group_signals
  add column if not exists respondida_at timestamptz;

alter table group_signals
  add column if not exists respuesta_texto text;

-- El id que devuelve el transporte al publicar. Sirve para rastrear el mensaje
-- real en el grupo y para no publicar dos veces la misma senal si un reintento
-- se cruza con una respuesta que ya habia salido.
alter table group_signals
  add column if not exists respuesta_wamid text;

-- 'sombra'  el sistema redacto la respuesta y NO la publico (prueba de humo)
-- 'auto'    el sistema la publico solo
-- 'humano'  un asesor la aprobo o la escribio
--
-- Guardar el modo es lo que permite comparar, con datos y no con intuicion, que
-- habria dicho el bot contra lo que dijo una persona.
alter table group_signals
  add column if not exists respuesta_modo text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'group_signals_respuesta_modo_valido'
  ) then
    alter table group_signals
      add constraint group_signals_respuesta_modo_valido
      check (respuesta_modo is null or respuesta_modo in ('sombra', 'auto', 'humano'));
  end if;
end $$;

-- El limite de frecuencia se responde con esta consulta: cuantas veces hablo el
-- bot en ESTE grupo en las ultimas 24 horas. Tiene que ser barata porque se
-- evalua antes de cada publicacion.
create index if not exists idx_group_signals_respondidas
  on group_signals (org_id, group_id, respondida_at desc)
  where respondida_at is not null;

-- ── 2. Escuchar un grupo y responder en el son permisos distintos ────────
--
-- Es la decision de seguridad mas importante de la migracion. Importar una
-- linea trae de golpe TODOS sus grupos (la asesora de julio tenia 80). Si
-- escuchar implicara responder, un solo clic pondria al bot a hablar en 80
-- grupos gremiales a la vez.
--
-- Por eso son dos permisos y este arranca en false: un grupo recien importado
-- NUNCA responde hasta que alguien lo habilite a proposito, de a uno.
alter table whatsapp_groups
  add column if not exists responde boolean not null default false;

-- ── 3. La linea vinculada tiene que ser identificable ────────────────────
--
-- Regla que costo una cuenta el 2026-07-30: nunca se conecta la linea de una
-- persona ni la que atiende clientes. Anotar el rol de la linea en la propia
-- fila evita que la regla viva solo en la cabeza de alguien.
--
-- 'dedicada'  linea secundaria de la empresa, sacrificable  <- la unica valida
-- 'asesor'    linea personal de trabajo de alguien          <- prohibida
alter table whatsapp_sessions
  add column if not exists rol text not null default 'dedicada';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_sessions_rol_valido'
  ) then
    alter table whatsapp_sessions
      add constraint whatsapp_sessions_rol_valido
      check (rol in ('dedicada', 'asesor'));
  end if;
end $$;

-- Verificacion: ningun grupo deberia poder responder todavia.
--   select count(*) from whatsapp_groups where responde;   -- debe dar 0

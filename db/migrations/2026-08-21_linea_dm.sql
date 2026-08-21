-- Inbox de los mensajes DIRECTOS (no de grupo) que le llegan a la linea
-- vinculada del radar (Juan, 2026-08-21).
--
-- "nosotros tenemos acceso a todos los chats de la linea de Natalia... necesito
-- hacer un cruce de datos de cuales mensajes respondio el bot y cuales el
-- colega de regreso le respondio al numero de natalia y de ahi sacar las
-- citas que se agendaron... que me alerte cuando se concreta una fecha y una
-- hora de visita".
--
-- Hasta hoy esto era imposible por diseno: src/channels/whatsapp-group.js
-- descarta CUALQUIER chat que no sea de grupo en su primera linea, ANTES de
-- cualquier log o escritura (invariante de privacidad #1, con su propio test).
-- Esa invariante protegia los chats PERSONALES de quien tuviera la linea
-- vinculada, en caso de que los tuviera. Confirmado por Juan (2026-08-21): esta
-- linea es 100% dedicada al radar, sin uso personal — por eso se habilita esta
-- tabla, y solo por eso. Si el dia de manana la linea cambia de uso, esto hay
-- que revisarlo de nuevo.
--
-- Solo lectura desde el punto de vista del negocio: nadie responde por aca
-- (ver la nota de diseno en src/groups/dm.js). Es un inbox pasivo con alerta,
-- no un canal de conversacion.
--
-- Correr a mano en Supabase. Idempotente.

create table if not exists linea_dm (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  sesion text,
  wa_message_id text not null,
  remitente_telefono text,
  remitente_nombre text,
  texto text,
  fecha_mensaje timestamptz,
  -- El pedido de grupo que este remitente publico, si el motor lo encuentra
  -- por telefono (src/data/group-signals.js ya guarda autor_telefono en vivo).
  -- Nullable: puede escribir alguien que nunca publico un pedido, o cuyo
  -- pedido es anterior a que esto empezara a resolverse.
  senal_id uuid references group_signals(id) on delete set null,
  -- Veredicto de src/groups/dm.js#clasificarAvance sobre el HILO completo de
  -- este remitente hasta este mensaje (Haiku, barato) — null si aun no corrio
  -- o si fallo (falla cerrada: sin veredicto no se alerta nada).
  tiene_cita boolean,
  -- 'cita_confirmada' | 'agendando' | 'interes_avanzado' | 'ninguno'. Sirve
  -- de CLAVE de dedup del aviso cuando no hay fecha_hora (un "a mi cliente
  -- le encanto" no tiene fecha que comparar, pero tampoco hay que re-avisarlo
  -- en cada mensaje siguiente del mismo hilo).
  avance_tipo text,
  cita_fecha_hora_iso timestamptz,
  cita_confianza numeric,
  -- Cuando se le aviso a Juan por este avance. Null = pendiente o no aplica.
  -- Se re-alerta si `cita_fecha_hora_iso` (o, sin fecha, `avance_tipo`)
  -- cambia de valor respecto al ultimo mensaje alertado de este remitente —
  -- nunca dos veces el MISMO avance.
  alertado_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, wa_message_id)
);

comment on table linea_dm is
  'Mensajes directos (no de grupo) recibidos en la linea vinculada del radar. Existe SOLO porque esa linea es 100% dedicada al radar (confirmado 2026-08-21) — nunca extender a una linea con uso personal sin repetir esa confirmacion.';
comment on column linea_dm.senal_id is
  'El pedido de group_signals que este remitente publico en un grupo, resuelto por telefono. Null si no se encontro.';
comment on column linea_dm.tiene_cita is
  'Veredicto de Haiku sobre el hilo completo de este remitente: ¿ya se confirmo fecha Y hora de una visita? Null = sin clasificar o clasificacion fallida.';

-- La consulta que define el modulo: "que dijo este remitente, en orden" —
-- para armar el contexto del hilo antes de clasificar, y para el cruce con
-- el pedido de grupo.
create index if not exists idx_linea_dm_remitente
  on linea_dm (org_id, remitente_telefono, created_at);

-- Lo que el watchdog de alertas recorre: citas detectadas que todavia no se
-- avisaron.
create index if not exists idx_linea_dm_pendientes_alerta
  on linea_dm (org_id, created_at)
  where tiene_cita = true and alertado_at is null;

alter table linea_dm enable row level security;

drop policy if exists "team read" on linea_dm;
create policy "team read" on linea_dm for select to authenticated using (true);

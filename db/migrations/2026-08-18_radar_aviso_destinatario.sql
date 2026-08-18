-- El aviso a la asesora se manda por WhatsApp y se olvida: hoy no queda
-- registro de A QUIEN se le mando ni con que wamid. Eso tiene dos costos:
--
--   1. trazabilidad_radar no puede DECIR quien recibio cada aviso — solo que
--      "salio". Se probo el 2026-08-18: al preguntarle a Sofi el detalle,
--      rellenó el hueco inventando un asesor ("Catherine Cano", que no
--      existe) y confundiendo `advisor_id` (quien OBSERVO la señal, el dueño
--      de la linea vinculada) con quien de verdad recibio el WhatsApp.
--   2. Cuando la asesora responde, Sofi no tiene forma de saber a cual
--      pedido esta respondiendo: el aviso no quedo enlazado a nada.
--
-- Estas columnas cierran ambos huecos. Correr a mano en el SQL Editor de
-- Supabase. Idempotente.

alter table group_signals
  add column if not exists aviso_advisor_id uuid references advisors(id),
  add column if not exists aviso_wamid text,
  add column if not exists recordatorio_enviado_at timestamptz;

comment on column group_signals.aviso_advisor_id is
  'A quien se le mando el aviso de verdad (rotacion de venta). Distinto de advisor_id: ese es quien OBSERVO la señal (dueño de la linea vinculada al grupo), no necesariamente quien recibe el WhatsApp.';
comment on column group_signals.aviso_wamid is
  'wamid del aviso enviado al asesor principal. Permite matchear una respuesta CITADA (swipe-to-reply) con esta señal exacta, sin que la asesora tenga que decir a cual pedido se refiere.';
comment on column group_signals.recordatorio_enviado_at is
  'Cuando se le mando el recordatorio por no responder al aviso. Evita que el scheduler lo repita en cada tick (ver src/scheduler/radar-recordatorio.js).';

-- Encontrar rapido la señal de una respuesta citada.
create index if not exists idx_group_signals_aviso_wamid
  on group_signals (aviso_wamid) where aviso_wamid is not null;

-- Encontrar rapido los avisos pendientes de respuesta (para el recordatorio y
-- para desambiguar cuando la asesora responde sin citar el mensaje).
create index if not exists idx_group_signals_aviso_sin_recordatorio
  on group_signals (org_id, aviso_advisor_id, enviado_at)
  where enviado_at is not null and recordatorio_enviado_at is null;

-- Verificacion: al correrla no deberia haber ninguna con destinatario todavia.
--   select count(*) from group_signals where aviso_advisor_id is not null;  -- 0

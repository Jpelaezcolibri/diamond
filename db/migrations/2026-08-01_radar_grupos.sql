-- Migracion: Radar de Grupos — captura segura por export e reenvio.
-- Ejecutar en el SQL Editor de Supabase DESPUES de 2026-07-28_grupos_fase2.sql.
--
-- Contexto. El 2026-07-30 WhatsApp baneo la linea de una asesora por usar un
-- cliente no oficial (WAHA/Baileys). La escucha en vivo se desmantelo. El
-- motor de valor —prefiltro, clasificacion, cruce— sobrevive intacto: lo que
-- cambia es COMO entran los mensajes. Ahora entran por dos vias que no tocan
-- el protocolo de WhatsApp y por lo tanto no son baneables:
--
--   'export'  — el asesor exporta el chat del grupo (funcion nativa de
--               WhatsApp) y sube el .txt al CRM.
--   'reenvio' — el asesor reenvia un mensaje suelto a Sofi, por la Cloud API
--               oficial, la misma que ya usa el bot.
--
-- 'vivo' queda como default por compatibilidad: las señales historicas se
-- capturaron asi y no hay que reescribirlas.

-- ── Origen de la señal ───────────────────────────────────────────────────
alter table group_signals
  add column if not exists origen text not null default 'vivo'
    check (origen in ('vivo', 'export', 'reenvio'));

comment on column group_signals.origen is
  'Como entro la señal: vivo (WAHA, historico) | export (.txt subido al CRM) | reenvio (el asesor se la mando a Sofi).';

-- ── Fecha del mensaje original ───────────────────────────────────────────
--
-- created_at es cuando la fila se inserto; con exports eso es SIEMPRE hoy,
-- aunque el mensaje sea de hace tres semanas. Sin esta columna no se puede
-- distinguir una demanda de ayer de una de hace un mes, y una demanda vieja
-- ya no vale: el colega hace rato consiguio lo que buscaba.
alter table group_signals
  add column if not exists fecha_mensaje timestamptz;

comment on column group_signals.fecha_mensaje is
  'Fecha real del mensaje en el grupo (del export). Null en señales historicas de captura en vivo, donde created_at ya es la fecha real.';

-- ── Claim del digest diario ──────────────────────────────────────────────
--
-- Se marca ANTES de enviar, no despues: duplicarle el digest a un asesor es
-- peor que perderlo una vez. Mismo criterio que leads.claimFollowup.
alter table group_signals
  add column if not exists digest_enviado_at timestamptz;

comment on column group_signals.digest_enviado_at is
  'Cuando esta señal salio en un digest diario. Null = pendiente de contar.';

-- Indice parcial: el digest solo consulta lo pendiente, que es un puñado de
-- filas contra una tabla que crece sin techo.
create index if not exists group_signals_digest_pend
  on group_signals (org_id, created_at)
  where digest_enviado_at is null;
